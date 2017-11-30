const _ = require('lodash');
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
      'stackstorm:docker:pull:pull': () => this.pullDockerImage(),
      'stackstorm:docker:start:start': () => this.startDocker(),
      'stackstorm:docker:stop:stop': () => this.stopDocker(this.options.dockerId),
      'stackstorm:docker:exec:exec': () => this.execDocker(this.options.cmd.split(' ')),
      'stackstorm:install:deps:copyDeps': () => this.copyDeps(),
      'stackstorm:install:packs:clonePacks': () => {
        if (this.options.pack) {
          return this.clonePack(this.options.pack);
        }

        return this.clonePacks();
      },
      'stackstorm:install:packDeps:copyPackDeps': () => {
        if (this.options.pack) {
          return this.copyPackDeps(this.options.pack);
        }

        return this.copyAllPacksDeps();
      },
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
            usage: 'Clean StackStorm code',
            lifecycleEvents: [
              'clean',
            ]
          },
          'docker': {
            commands: {
              pull: {
                usage: 'Pull λ docker image',
                lifecycleEvents: [
                  'pull'
                ]
              },
              start: {
                usage: 'Start λ docker container',
                lifecycleEvents: [
                  'start'
                ]
              },
              stop: {
                usage: 'Stop λ docker container',
                lifecycleEvents: [
                  'stop'
                ],
                options: {
                  dockerId: {
                    usage: 'λ docker container ID',
                    required: true
                  }
                }
              },
              exec: {
                usage: 'Execute a command in λ docker container',
                lifecycleEvents: [
                  'exec'
                ],
                options: {
                  dockerId: {
                    usage: 'λ docker container ID',
                    required: true
                  },
                  cmd: {
                    usage: 'command to execute',
                    shortcut: 'c',
                    required: true
                  }
                }
              }
            }
          },
          'install': {
            commands: {
              deps: {
                usage: 'Install StackStorm dependencies',
                lifecycleEvents: [
                  'copyDeps'
                ],
                options: {
                  dockerId: {
                    usage: 'λ docker container ID',
                    required: true
                  }
                }
              },
              packs: {
                usage: 'Install a pack',
                lifecycleEvents: [
                  'clonePacks'
                ],
                options: {
                  pack: {
                    usage: 'Install specific StackStorm pack',
                    shortcut: 'p'
                  }
                }
              },
              packDeps: {
                usage: 'Install dependencies for packs',
                lifecycleEvents: [
                  'copyPackDeps'
                ],
                options: {
                  dockerId: {
                    usage: 'λ docker container ID',
                    required: true
                  },
                  pack: {
                    usage: 'Install dependencies for specific pack.',
                    shortcut: 'p'
                  }
                }
              }
            }
          }
        }
      }
    };

    const { custom = {} } = this.serverless.service;
    const { stackstorm = {} } = custom;

    this.dockerId = null;
    this.dockerImage = stackstorm && stackstorm.image || 'lambci/lambda:build-python2.7';

    this.index_url = stackstorm && stackstorm.index || 'https://index.stackstorm.org/v1/index.json';
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
    const python_runner_pkg = 'git+https://github.com/StackStorm/st2#egg=python_runner&subdirectory=contrib/runners/python_runner';

    this.serverless.cli.log('Installing StackStorm adapter dependencies');
    const prefix = `${INTERNAL_MAGIC_FOLDER}/deps`;
    await this.execDocker(['pip', 'install', '-I', st2common_pkg, python_runner_pkg, '--prefix', prefix]);
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

  async clonePack(packName) {
    const index = await this.getIndex();
    const packMeta = index.packs[packName];

    const localPath = `${MAGIC_FOLDER}/packs/${packMeta.ref || packMeta.name}`;
    try {
      this.serverless.cli.log(`Cloning pack "${packMeta.ref || packMeta.name}"`);
      await git.Clone(packMeta.repo_url, localPath);
    } catch (e) {
      const repo = await git.Repository.open(localPath);
      await repo.fetchAll();
      await repo.mergeBranches('master', 'origin/master');
    }

    return localPath;
  }

  async clonePacks() {
    return Promise.all(_(this.getFunctions())
      .map(func => func.split('.')[0])
      .uniq()
      .map(packName => this.clonePack(packName))
    );
  }

  getFunctions() {
    return _.map(this.serverless.service.functions, func => {
      if (func.st2_function) {
        if (func.handler) {
          throw new this.serverless.classes.Error('properties st2_function and handler are mutually exclusive');
        }

        return func.st2_function;
      }
    }).filter(Boolean);
  }

  async getAction(packName, actionName) {
    const actionContent = fs.readFileSync(`${MAGIC_FOLDER}/packs/${packName}/actions/${actionName}.yaml`);

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

  async stopDocker(dockerId = this.dockerId) {
    if (dockerId) {
      this.serverless.cli.log('Stop Docker container');
      return await stopDocker(dockerId);
    }

    throw new this.serverless.classes.Error('No Docker container is set for this session. You need to start one first.');
  }

  async execDocker(cmd) {
    const dockerId = this.dockerId || this.options.dockerId;
    if (dockerId) {
      return await execDocker(dockerId, cmd);
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
        await this.clonePack(packName);
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
