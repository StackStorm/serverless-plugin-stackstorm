import os
import sys
import json
import yaml
import logging
import six
from oslo_config import cfg
from stevedore.driver import DriverManager

from st2common.bootstrap.actionsregistrar import ActionsRegistrar
from st2common.constants.pack import CONFIG_SCHEMA_FILE_NAME
from st2common.constants.runners import MANIFEST_FILE_NAME
from st2common.constants.system import VERSION_STRING
from st2common.content.loader import ContentPackLoader, RunnersLoader, MetaLoader
from st2common.content import utils as content_utils
from st2common.exceptions import actionrunner
from st2common.exceptions.param import ParamException
from st2common.models.api.action import ActionAPI, RunnerTypeAPI
from st2common.models.api.pack import ConfigSchemaAPI
from st2common.models.db.action import ActionDB
from st2common.models.db.runner import RunnerTypeDB
from st2common.runners.base import get_runner
from st2common.util.pack import validate_config_against_schema
from st2common.util import param as param_utils
import st2common.validators.api.action as action_validator

import config

LOG = logging.getLogger(__name__)

del sys.argv[1:]

cfg.CONF(args=('--config-file', '~st2/st2.conf'), version=VERSION_STRING)


def _load_actions():
    actions = {}
    action_dirs = ContentPackLoader().get_content(content_utils.get_packs_base_paths(), 'actions')

    for pack in action_dirs:
        for action_path in ActionsRegistrar().get_resources_from_pack(action_dirs[pack]):
            content = MetaLoader().load(action_path)
            ref = pack + "." + content['name']

            action_api = ActionAPI(pack=pack, **content)
            action_api.validate()
            # action_validator.validate_action(action_api)
            actions[ref] = ActionAPI.to_model(action_api)

    return actions


def _load_config_schemas():
    config_schemas = {}

    packs = ContentPackLoader().get_packs(content_utils.get_packs_base_paths())

    for pack_name, pack_dir in six.iteritems(packs):
        config_schema_path = os.path.join(pack_dir, CONFIG_SCHEMA_FILE_NAME)

        if not os.path.isfile(config_schema_path):
            # Note: Config schema is optional
            continue

        values = MetaLoader().load(config_schema_path)

        if not values:
            raise ValueError('Config schema "%s" is empty and invalid.' % (config_schema_path))

        content = {}
        content['pack'] = pack_name
        content['attributes'] = values

        config_schema_api = ConfigSchemaAPI(**content)
        config_schema_api = config_schema_api.validate()
        config_schemas[pack_name] = values

    return config_schemas


ACTIONS = _load_actions()
CONFIG_SCHEMAS = _load_config_schemas()


def stackstorm(event, context):
    action_db = ACTIONS[os.environ['ST2_ACTION']]

    manager = DriverManager(namespace='st2common.runners.runner', invoke_on_load=False,
                            name=action_db.runner_type['name'])
    runnertype_db = RunnerTypeAPI.to_model(RunnerTypeAPI(**manager.driver.get_metadata()[0]))
    runner = manager.driver.get_runner()

    runner._sandbox = False
    runner.runner_type_db = runnertype_db
    runner.action = action_db
    runner.action_name = action_db.name
    # runner.liveaction = liveaction_db
    # runner.liveaction_id = str(liveaction_db.id)
    # runner.execution = ActionExecution.get(liveaction__id=runner.liveaction_id)
    # runner.execution_id = str(runner.execution.id)
    runner.entry_point = content_utils.get_entry_point_abs_path(pack=action_db.pack,
        entry_point=action_db.entry_point)
    runner.context = {} # getattr(liveaction_db, 'context', dict())
    # runner.callback = getattr(liveaction_db, 'callback', dict())
    runner.libs_dir_path = content_utils.get_action_libs_abs_path(pack=action_db.pack,
        entry_point=action_db.entry_point)

    # For re-run, get the ActionExecutionDB in which the re-run is based on.
    rerun_ref_id = runner.context.get('re-run', {}).get('ref')
    runner.rerun_ex_ref = ActionExecution.get(id=rerun_ref_id) if rerun_ref_id else None

    config_schema = CONFIG_SCHEMAS.get(action_db.pack, None)
    config_values = os.environ.get('ST2_CONFIG', None)
    if config_schema and config_values:
        runner._config = validate_config_against_schema(config_schema=config_schema,
                                                        config_object=json.loads(config_values),
                                                        config_path=None,
                                                        pack_name=action_db.pack)

    # Finalized parameters are resolved and then rendered. This process could
    # fail. Handle the exception and report the error correctly.
    try:
        runner_params, action_params = param_utils.render_final_params(
            runnertype_db.runner_parameters, action_db.parameters, {}, {})
        runner.runner_parameters = runner_params
    except ParamException as e:
        raise actionrunner.ActionRunnerException(str(e))

    LOG.debug('Performing pre-run for runner: %s', runner.runner_id)

    runner.pre_run()

    (status, result, context) = runner.run(event)

    return result
