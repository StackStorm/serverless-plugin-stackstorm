const fs = require('fs-extra');
const path = require('path');
const git = require('nodegit');
const yaml = require('js-yaml');
const nopy = require('nopy');
const request = require('axios');

const { pullDockerImage, startDocker, execDocker, stopDocker } = require('./lib/docker');


const MAGIC_FOLDER = '~st2';
const INTERNAL_MAGIC_FOLDER = `/var/task/${MAGIC_FOLDER}`;
const DEFAULT_PYTHON_PATH = [
  `${INTERNAL_MAGIC_FOLDER}`,
  `${INTERNAL_MAGIC_FOLDER}/deps/lib/python2.7/site-packages`,
  `${INTERNAL_MAGIC_FOLDER}/deps/lib64/python2.7/site-packages`
];

class StackstormPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.hooks = {
      'stackstorm:package': () => this.serverless.pluginManager.spawn('package'),
      'stackstorm:clean:clean': () => this.clean(),
      'before:package:createDeploymentArtifacts': () => this.beforeCreateDeploymentArtifacts(),
      'before:simulate:apigateway:initialize': () => this.beforeCreateDeploymentArtifacts(),
      'before:invoke:local:invoke': () => this.beforeCreateDeploymentArtifacts(true)
    };

    this.commands = {
      stackstorm: {
        usage: 'Build λ with StackStorm',
        lifecycleEvents: [
          'package',
        ],
        commands: {
          clean: {
            usage: 'Clean stackstorm code',
            lifecycleEvents: [
              'clean',
            ]
          }
        }
      }
    };

    this.dockerId = null;
    this.dockerImage = 'lambci/lambda:build-python2.7';

    this.index_url = 'https://index.stackstorm.org/v1/index.json';
  }

  async getIndex() {
    if (!this._index) {
      this._index = await request.get(this.index_url).then(res => res.data);
    }

    return this._index;
  }

  async clean() {
    await fs.remove(MAGIC_FOLDER);
  }

  async copyDeps() {
    const st2common_pkg = 'git+https://github.com/stackstorm/st2.git#egg=st2common&subdirectory=st2common';

    this.serverless.cli.log('Installing StackStorm adapter dependencies');
    const prefix = `${INTERNAL_MAGIC_FOLDER}/deps`;
    await this.execDocker(['pip', 'install', '-I', st2common_pkg, '--prefix', prefix]);
  }

  async copyPackDeps(pack) {
    const prefix = `${INTERNAL_MAGIC_FOLDER}/virtualenvs/${pack}`;
    const pythonpath = `${prefix}/lib/python2.7/site-packages`;
    const requirements = `${INTERNAL_MAGIC_FOLDER}/packs/${pack}/requirements.txt`;
    await this.execDocker(['mkdir', '-p', pythonpath]);
    await this.execDocker([
      '/bin/bash', '-c',
      `PYTHONPATH=$PYTHONPATH:${pythonpath} ` +
      `pip --isolated install -r ${requirements} --prefix ${prefix} --src ${prefix}/src`
    ]);
  }

  async copyAllPacksDeps() {
    this.serverless.cli.log('Creating virtual environments for packs');
    const packs = fs.readdirSync(`${MAGIC_FOLDER}/packs`);

    for (let pack in packs) {
      await this.copyPackDeps(packs[pack]);
    }
  }

  async getAction(packName, actionName) {
    const index = await this.getIndex();
    const packMeta = index.packs[packName];

    const localPath = `${MAGIC_FOLDER}/packs/${packMeta.ref || packMeta.name}`;
    try {
      await git.Clone(packMeta.repo_url, localPath);
    } catch (e) {
      const repo = await git.Repository.open(localPath);
      await repo.fetchAll();
      await repo.mergeBranches('master', 'origin/master');
    }

    const actionContent = fs.readFileSync(`${localPath}/actions/${actionName}.yaml`);

    return yaml.safeLoad(actionContent);
  }

  async pullDockerImage() {
    return await pullDockerImage(this.dockerImage);
  }

  async startDocker() {
    if (!this.dockerId) {
      this.serverless.cli.log('Spin Docker container to build python dependencies');
      const volume = `${path.resolve('./')}/${MAGIC_FOLDER}:${INTERNAL_MAGIC_FOLDER}`;
      this.dockerId = await startDocker(this.dockerImage, volume);
      return this.dockerId;
    }

    throw new this.serverless.classes.Error('Docker container for this session is already set. Stop it before creating a new one.');
  }

  async stopDocker() {
    if (this.dockerId) {
      this.serverless.cli.log('Stop Docker container');
      return await stopDocker(this.dockerId);
    }

    throw new this.serverless.classes.Error('No Docker container is set for this session. You need to start one first.');
  }

  async execDocker(command) {
    if (this.dockerId) {
      return await execDocker(this.dockerId, command);
    }

    throw new this.serverless.classes.Error('No Docker container is set for this session. You need to start one first.');
  }

  async beforeCreateDeploymentArtifacts(local) {
    let needCommons = false;

    this.serverless.service.package.exclude = (this.serverless.service.package.exclude || [])
      .concat(['.st2/**/.git/**']);

    for (let key of Object.keys(this.serverless.service.functions)) {
      const func = this.serverless.service.functions[key];

      if (func.st2_function) {
        if (func.handler) {
          throw new this.serverless.classes.Error('properties st2_function and handler are mutually exclusive');
        }

        const [ packName, actionName ] = func.st2_function.split('.');
        await this.getAction(packName, actionName);

        func.handler = `${MAGIC_FOLDER}/handler.stackstorm`;
        func.environment = func.environment || {};
        func.environment.ST2_ACTION = func.st2_function;
        if (func.st2_config) {
          func.environment.ST2_CONFIG = JSON.stringify(func.st2_config);
        }
        func.environment.PYTHONPATH = DEFAULT_PYTHON_PATH
          .concat([
            `${INTERNAL_MAGIC_FOLDER}/virtualenvs/${packName}/lib/python2.7/site-packages`,
            `${INTERNAL_MAGIC_FOLDER}/virtualenvs/${packName}/lib64/python2.7/site-packages`
          ])
          .join(':');
        needCommons = true;

        this.serverless.service.functions[key] = func;
      }
    }

    if (needCommons) {
      this.serverless.cli.log('Copying StackStorm adapter code');
      await fs.copy(__dirname + '/stackstorm', MAGIC_FOLDER);

      if (local) {
        await this.installCommonsLocally();
      } else {
        await this.installCommonsDockerized();
      }
    }
  }

  async installCommonsLocally() {
    const depsExists = await fs.pathExists(`${MAGIC_FOLDER}/deps`);
    if (!depsExists) {
      this.serverless.cli.log('Ensure pip is installed');
      await nopy.spawnPython([
        path.join(__dirname, 'node_modules/nopy/src/get-pip.py'), '--user', '--quiet'
      ], {
        interop: 'status',
        spawn: {
          stdio: 'inherit',
        }
      });

      this.serverless.cli.log('Installing StackStorm adapter dependencies');
      await nopy.spawnPython([
        '-m', 'pip', 'install',
        'git+https://github.com/stackstorm/st2.git#egg=st2common&subdirectory=st2common',
        '-I',
        '--prefix', `${MAGIC_FOLDER}/deps`
      ], {
        interop: 'buffer'
      });
    }
  }

  async installCommonsDockerized() {
    await this.pullDockerImage();

    await this.startDocker();

    const depsExists = await fs.pathExists(`${MAGIC_FOLDER}/deps`);
    if (!depsExists) {
      await this.copyDeps();
    }

    await this.copyAllPacksDeps();

    await this.stopDocker();
  }
}

module.exports = StackstormPlugin;
