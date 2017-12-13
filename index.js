const _ = require('lodash');
const fs = require('fs-extra');
const path = require('path');
const git = require('simple-git/promise');
const yaml = require('js-yaml');
const nopy = require('nopy');
const request = require('axios');
const stdin = require('get-stdin');
const urljoin = require('url-join');
const chalk = require('chalk');

const { pullDockerImage, startDocker, runDocker, execDocker, stopDocker } = require('./lib/docker');


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
      'stackstorm:docker:run:run': () => {
        const { 'function': func, data, ...rest } = this.options;
        return this.runDocker(func, data, rest);
      },
      'stackstorm:install:adapter:copyAdapter': () => this.copyAdapter(),
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

        return this.copyAllPacksDeps({ force: true });
      },
      'stackstorm:info:info': () => this.showActionInfo(this.options.action),
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
          docker: {
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
              },
              run: {
                usage: 'Execute a function in λ docker container',
                lifecycleEvents: [
                  'run'
                ],
                options: {
                  function: {
                    usage: 'Name of the function',
                    shortcut: 'f',
                    required: true
                  },
                  path: {
                    usage: 'Path to JSON or YAML file holding input data',
                    shortcut: 'p',
                  },
                  data: {
                    usage: 'Input data',
                    shortcut: 'd',
                    required: true
                  },
                  passthrough: {
                    usage: 'Return incoming event as a result instead of running StackStorm action'
                  },
                  verbose: {
                    usage: 'Print all the transformation steps',
                    shortcut: 'v'
                  }
                }
              }
            }
          },
          install: {
            commands: {
              adapter: {
                usage: 'Install StackStorm adapter',
                lifecycleEvents: [
                  'copyAdapter'
                ]
              },
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
          },
          info: {
            usage: 'Print information on the action',
            lifecycleEvents: [
              'info',
            ],
            options: {
              action: {
                usage: 'Action name',
                required: true
              }
            }
          }
        }
      }
    };

    const { custom = {} } = this.serverless.service;
    const { stackstorm = {} } = custom;

    this.dockerId = null;
    this.dockerRunImage = stackstorm && stackstorm.runImage || 'lambci/lambda:python2.7';
    this.dockerBuildImage = stackstorm && stackstorm.buildImage
      || stackstorm.image
      || 'lambci/lambda:build-python2.7';

    this.index_root = stackstorm && stackstorm.indexRoot || 'https://index.stackstorm.org/v1/';
    this.index_url = stackstorm && stackstorm.index || urljoin(this.index_root, 'index.json');

    this.st2common_pkg = stackstorm && stackstorm.st2common_pkg
      || 'git+https://github.com/stackstorm/st2.git#egg=st2common&subdirectory=st2common';
    this.python_runner_pkg = stackstorm && stackstorm.python_runner_pkg
      || 'git+https://github.com/StackStorm/st2.git#egg=python_runner&subdirectory=contrib/runners/python_runner';
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

  async copyAdapter() {
    this.serverless.cli.log('Copying StackStorm adapter code...');
    await fs.copy(__dirname + '/stackstorm', MAGIC_FOLDER);
  }

  async copyDeps() {
    this.serverless.cli.log('Installing StackStorm adapter dependencies...');
    const prefix = `${INTERNAL_MAGIC_FOLDER}/deps`;
    await this.execDocker(['pip', 'install', '-I', this.st2common_pkg, this.python_runner_pkg, '--prefix', prefix]);
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

  async copyAllPacksDeps({ force } = {}) {
    this.serverless.cli.log('Ensuring virtual environments for packs...');
    const packs = fs.readdirSync(`${MAGIC_FOLDER}/packs`);

    for (let pack of packs) {
      const depsExists = await fs.pathExists(`${MAGIC_FOLDER}/virtualenvs/${pack}`);
      if (force || !depsExists) {
        await this.copyPackDeps(pack);
      }
    }
  }

  async clonePack(packName) {
    const index = await this.getIndex();
    const packMeta = index.packs[packName];
    const debug = (process.env['DEBUG'] !== undefined);

    const localPath = `${MAGIC_FOLDER}/packs/${packMeta.ref || packMeta.name}`;
    try {
      const silent = !debug;

      this.serverless.cli.log(`Cloning pack "${packMeta.ref || packMeta.name}"...`);
      await git().silent(silent).clone(packMeta.repo_url, localPath);
    } catch (e) {
      await git(localPath).fetch();
      await git(localPath).pull('origin', 'master');
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
      if (func.stackstorm) {
        if (func.handler) {
          throw new this.serverless.classes.Error('properties stackstorm and handler are mutually exclusive');
        }

        return func.stackstorm.action;
      }
    }).filter(Boolean);
  }

  async getAction(packName, actionName) {
    const actionContent = fs.readFileSync(`${MAGIC_FOLDER}/packs/${packName}/actions/${actionName}.yaml`);

    return yaml.safeLoad(actionContent);
  }

  async pullDockerImage() {
    return await pullDockerImage(this.dockerBuildImage);
  }

  async startDocker() {
    if (!this.dockerId) {
      await this.pullDockerImage();

      this.serverless.cli.log('Spinning Docker container to build python dependencies...');
      const volume = `${path.resolve('./')}/${MAGIC_FOLDER}:${INTERNAL_MAGIC_FOLDER}`;
      this.dockerId = await startDocker(this.dockerBuildImage, volume);
      return this.dockerId;
    }

    throw new this.serverless.classes.Error('Docker container for this session is already set. Stop it before creating a new one.');
  }

  async stopDocker(dockerId = this.dockerId) {
    if (dockerId) {
      this.serverless.cli.log('Stopping Docker container...');
      return await stopDocker(dockerId);
    }

    throw new this.serverless.classes.Error('No Docker container is set for this session. You need to start one first.');
  }

  async execDocker(cmd) {
    let dockerId = this.dockerId || this.options.dockerId;
    if (!dockerId) {
      console.log('startiong docker')
      dockerId = await this.startDocker();
    }

    console.log('started')
    console.log(cmd)

    return await execDocker(dockerId, cmd);
  }

  async runDocker(funcName, data, opts={}) {
    if (!data) {
      if (opts.path) {
        const absolutePath = path.isAbsolute(opts.path) ?
          opts.path :
          path.join(this.serverless.config.servicePath, opts.path);

        if (!this.serverless.utils.fileExistsSync(absolutePath)) {
          throw new this.serverless.classes.Error('The file you provided does not exist.');
        }

        data = this.serverless.utils.readFileSync(absolutePath);
      } else {
        try {
          data = await stdin();
        } catch (exception) {
          // resolve if no stdin was provided
        }
      }
    }

    await this.beforeCreateDeploymentArtifacts();

    const func = this.serverless.service.functions[funcName];

    const volumes = [`${path.resolve('./')}/${MAGIC_FOLDER}:${INTERNAL_MAGIC_FOLDER}`];
    const envs = _.map(func.environment, (value, key) => `${key}=${value}`);

    const cmd = [`${MAGIC_FOLDER}/handler.${opts.passthrough ? 'passthrough' : 'basic'}`, data];

    this.serverless.cli.log('Spinning Docker container to run a function locally...');
    const { result } = await runDocker(this.dockerRunImage, volumes, envs, cmd)
      .catch(e => {
        if (e.result && e.result.errorMessage) {
          throw new Error(`Function error: ${e.result.errorMessage}`);
        }
        throw e;
      });

    const msg = [];

    if (opts.verbose) {
      msg.push(`${chalk.yellow.underline('Incoming event ->')}`);
      msg.push(`${JSON.stringify(result.event, null, 2)}`);
      msg.push(`${chalk.yellow.underline('-> Parameter transformer ->')}`);
      msg.push(`${JSON.stringify(result.live_params, null, 2)}`);
      msg.push(`${chalk.yellow.underline(
        `-> Action call ${opts.passthrough ? '(passthrough) ' : ''}->`
      )}`);
      msg.push(`${JSON.stringify(result.output, null, 2)}`);
      msg.push(`${chalk.yellow.underline('-> Output transformer ->')}`);
    }

    msg.push(`${JSON.stringify(result.result, null, 2)}`);

    this.serverless.cli.consoleLog(msg.join('\n'));

    return result.result;
  }

  async showActionInfo(action) {
    const [ packName, ...actionNameRest ] = action.split('.');
    const actionName = actionNameRest.join('.');

    const metaUrl = urljoin(this.index_root, 'packs', packName, 'actions', `${actionName}.json`);
    const packRequest = request.get(metaUrl).then(res => res.data);

    const configUrl = urljoin(this.index_root, 'packs', packName, 'config.schema.json');
    const configRequest = request.get(configUrl).then(res => res.data);

    const dots = 30;
    const indent = '  ';

    const msg = [];

    try {
      const packMeta = await packRequest;
      const usage = packMeta.description || chalk.dim('action description is missing');

      msg.push(`${chalk.yellow(action)} ${chalk.dim(_.repeat('.', dots - action.length))} ${usage}`);
      msg.push(`${chalk.yellow.underline('Parameters')}`);
      for (let name in packMeta.parameters) {
        const param = packMeta.parameters[name];
        const title = `${name} [${param.type}] ${param.required ? '(required)' : ''}`;
        const dotsLength = dots - indent.length - title.length;
        const usage = param.description || chalk.dim('description is missing');
        msg.push(`${indent}${chalk.yellow(title)} ${chalk.dim(_.repeat('.', dotsLength))} ${usage}`);
      }
    } catch (e) {
      throw new Error(`No such action in the index: ${action}`);
    }

    try {
      const configMeta = await configRequest;
      msg.push(`${chalk.yellow.underline('Config')}`);
      for (let name in configMeta) {
        const param = configMeta[name];
        const title = `${name} [${param.type}] ${param.required ? '(required)' : ''}`;
        const dotsLength = dots - indent.length - title.length;
        const usage = param.description || chalk.dim('description is missing');
        msg.push(`${indent}${chalk.yellow(title)} ${chalk.dim(_.repeat('.', dotsLength))} ${usage}`);
      }
    } catch (e) {
      msg.push(chalk.dim('The action does not require config parameters'));
    }

    this.serverless.cli.consoleLog(msg.join('\n'));
  }

  async beforeCreateDeploymentArtifacts(local) {
    let needCommons = false;

    this.serverless.service.package.exclude = (this.serverless.service.package.exclude || [])
      .concat([`${MAGIC_FOLDER}/**/.git/**`]);

    for (let key of Object.keys(this.serverless.service.functions)) {
      const func = this.serverless.service.functions[key];

      if (func.stackstorm) {
        if (func.handler) {
          throw new this.serverless.classes.Error('properties stackstorm and handler are mutually exclusive');
        }

        const [ packName, ...actionNameRest ] = func.stackstorm.action.split('.');
        const actionName = actionNameRest.join('.');
        await this.clonePack(packName);
        await this.getAction(packName, actionName);

        func.handler = `${MAGIC_FOLDER}/handler.stackstorm`;
        func.environment = func.environment || {};
        func.environment.ST2_ACTION = func.stackstorm.action;
        if (func.stackstorm.config) {
          func.environment.ST2_CONFIG = JSON.stringify(func.stackstorm.config);
        }
        if (func.stackstorm.input) {
          func.environment.ST2_PARAMETERS = JSON.stringify(func.stackstorm.input);
        }
        if (func.stackstorm.output) {
          func.environment.ST2_OUTPUT = JSON.stringify(func.stackstorm.output);
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
      await this.copyAdapter();

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
      this.serverless.cli.log('Checking if pip is installed...');
      await nopy.spawnPython([
        path.join(__dirname, 'node_modules/nopy/src/get-pip.py'), '--user', '--quiet'
      ], {
        interop: 'status',
        spawn: {
          stdio: 'inherit',
        }
      });

      this.serverless.cli.log('Installing StackStorm adapter dependencies...');
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
    const depsExists = await fs.pathExists(`${MAGIC_FOLDER}/deps`);
    if (!depsExists) {
      await this.copyDeps();
    }

    await this.copyAllPacksDeps();

    try {
      await this.stopDocker();
    } catch (e) {
      // Do nothing
    }
  }
}

module.exports = StackstormPlugin;
