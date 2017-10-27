import os
import json
import yaml
import logging
from oslo_config import cfg

from st2common.bootstrap.actionsregistrar import ActionsRegistrar
from st2common.constants.runners import MANIFEST_FILE_NAME
from st2common.constants.system import VERSION_STRING
from st2common.content.loader import ContentPackLoader, RunnersLoader, MetaLoader
from st2common.content import utils as content_utils
from st2common.exceptions import actionrunner
from st2common.exceptions.param import ParamException
from st2common.models.api.action import ActionAPI, RunnerTypeAPI
from st2common.models.db.action import ActionDB
from st2common.models.db.runner import RunnerTypeDB
from st2common.runners.base import get_runner
from st2common.util import param as param_utils
import st2common.validators.api.action as action_validator

import config

LOG = logging.getLogger(__name__)

cfg.CONF(args=('--config-file', '~st2/st2.conf'), version=VERSION_STRING)


def _load_runnertypes():
    runners = {}
    runner_types = RunnersLoader().get_runners(content_utils.get_runners_base_paths())

    for runner_name in runner_types:
        runner_type = MetaLoader().load(os.path.join(runner_types[runner_name], MANIFEST_FILE_NAME))[0]

        aliases = runner_type.get('aliases', [])

        # Remove additional, non db-model attributes
        non_db_attributes = ['experimental', 'aliases']
        for attribute in non_db_attributes:
            if attribute in runner_type:
                del runner_type[attribute]

        runnertype_api = RunnerTypeAPI(**runner_type)
        runnertype_api.validate()
        runners[runnertype_api.name] = RunnerTypeAPI.to_model(runnertype_api)

        for alias in aliases:
            runners[alias] = runners[runnertype_api.name]

    return runners


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


RUNNERS = _load_runnertypes()
ACTIONS = _load_actions()


def _get_runner(runnertype_db, action_db):
    runner = get_runner(runnertype_db.runner_module)

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

    return runner


def stackstorm(event, context):
    action_db = ACTIONS[os.environ['ST2_ACTION']]
    runnertype_db = RUNNERS[action_db.runner_type['name']]

    runner = _get_runner(runnertype_db, action_db)

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
