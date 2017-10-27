const _ = require('lodash');
const fs = require('fs-extra');
const path = require('path');
const request = require('axios');
const git = require('nodegit');
const yaml = require('js-yaml');
const nopy = require('nopy');
const child_process = require('child_process')


const MAGIC_FOLDER = '~st2';
const INTERNAL_MAGIC_FOLDER = `/var/task/${MAGIC_FOLDER}`;
const DEFAULT_PYTHON_PATH = [
  `${INTERNAL_MAGIC_FOLDER}`,
  `${INTERNAL_MAGIC_FOLDER}/deps/lib/python2.7/site-packages`,
  `${INTERNAL_MAGIC_FOLDER}/deps/lib64/python2.7/site-packages`
];

const INDEX_URL = 'https://index.stackstorm.org/v1/index.json';

class StackstormPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.hooks = {
      'before:package:createDeploymentArtifacts': () => this.beforeCreateDeploymentArtifacts(),
      'before:simulate:apigateway:initialize': () => this.beforeCreateDeploymentArtifacts(),
      'before:invoke:local:invoke': () => this.beforeCreateDeploymentArtifacts(true)
    };
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
        const actionMeta = await this.getAction(packName, actionName);

        func.handler = `${MAGIC_FOLDER}/handler.stackstorm`;
        func.environment = func.environment || {};
        func.environment.ST2_ACTION = func.st2_function;
        func.environment.PYTHONPATH = DEFAULT_PYTHON_PATH
          .concat([
            `${INTERNAL_MAGIC_FOLDER}/virtualenvs/${packName}/lib/python2.7/site-packages`,
            `${INTERNAL_MAGIC_FOLDER}/virtualenvs/${packName}/lib64/python2.7/site-packages`
          ])
          .join(':');
        needCommons = true;

        this.serverless.service.functions[key] = func;
      }
    };

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

  async getAction(packName, actionName) {
    const index = await this.getIndex();
    const packMeta = index.packs[packName];

    const localPath = `${MAGIC_FOLDER}/packs/${packMeta.ref || packMeta.name}`;
    try {
      await git.Clone(packMeta.repo_url, localPath)
    } catch (e) {
      const repo = await git.Repository.open(localPath);
      await repo.fetchAll();
      await repo.mergeBranches("master", "origin/master");
    }

    const actionContent = fs.readFileSync(`${localPath}/actions/${actionName}.yaml`);

    return yaml.safeLoad(actionContent);
  }

  async installCommonsLocally() {
    const depsExists = await fs.pathExists(`${MAGIC_FOLDER}/deps`);
    if (!depsExists) {
      this.serverless.cli.log('Ensure pip is installed');
      const code = await nopy.spawnPython([
        path.join(__dirname, "node_modules/nopy/src/get-pip.py"), "--user", "--quiet"
      ], {
        interop: "status",
        spawn: {
          stdio: "inherit",
        }
      })

      this.serverless.cli.log('Installing StackStorm adapter dependencies');
      await nopy.spawnPython([
        '-m', 'pip', 'install',
        'git+https://github.com/stackstorm/st2.git@more_st2common_changes#egg=st2common&subdirectory=st2common',
        '-I',
        '--prefix', `${MAGIC_FOLDER}/deps`
      ], {
        interop: 'buffer'
      });
    }
  }

  async startDocker(dockerImage) {
    const args = ['run']
      .concat(['-d', '--rm', '-v', `${path.resolve('./')}/${MAGIC_FOLDER}:${INTERNAL_MAGIC_FOLDER}`, dockerImage])
      .concat(['tail', '-f', '/dev/null'])
      ;
    const spawnOptions = {
      encoding: 'utf8'
    };

    const run = child_process.spawn('docker', args, spawnOptions);

    return new Promise((resolve, reject) => {
      run.stdout.on('data', (data) => {
        const str = data.toString();
        resolve(str.replace(/\n$/, ''));
      });

      run.stderr.on('data', (data) => {
        const str = data.toString();
        reject(str.replace(/\n$/, ''));
      });
    });
  }

  async execDocker(dockerId, command) {
    const args = ['exec', dockerId]
      .concat(command)
      ;
    const spawnOptions = {
      encoding: 'utf8'
    };

    const run = child_process.spawn('docker', args, spawnOptions);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      run.stdout.on('data', (data) => {
        const str = data.toString();
        console.log(str.replace(/\n$/, ''));
        stdout += str;
      });

      run.stderr.on('data', (data) => {
        const str = data.toString();
        console.log(str.replace(/\n$/, ''));
        stderr += str;
      });

      run.on('close', (code) => {
        const result = {
          code,
          stdout,
          stderr,
        };

        if (code === 0) {
          resolve(result);
        } else {
          reject(result);
        }
      });
    });
  }

  async stopDocker(dockerId) {
    const args = ['stop', dockerId];
    const spawnOptions = {
      encoding: 'utf8'
    };

    const run = child_process.spawn('docker', args, spawnOptions);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      run.stdout.on('data', (data) => {
        const str = data.toString();
        console.log(str.replace(/\n$/, ''));
        stdout += str;
      });

      run.stderr.on('data', (data) => {
        const str = data.toString();
        console.log(str.replace(/\n$/, ''));
        stderr += str;
      });

      run.on('close', (code) => {
        const result = {
          code,
          stdout,
          stderr,
        };

        if (code === 0) {
          resolve(result);
        } else {
          reject(result);
        }
      });
    });
  }

  async installCommonsDockerized() {
    this.serverless.cli.log('Spin Docker container');
    const st2common_pkg = 'git+https://github.com/stackstorm/st2.git@more_st2common_changes#egg=st2common&subdirectory=st2common';
    const image = 'lambci/lambda:build-python2.7';
    const dockerId = await this.startDocker(image);

    const depsExists = await fs.pathExists(`${MAGIC_FOLDER}/deps`);
    if (!depsExists) {
      this.serverless.cli.log('Installing StackStorm adapter dependencies');
      const prefix = `${INTERNAL_MAGIC_FOLDER}/deps`;
      await this.execDocker(dockerId, ['pip', 'install', '-I', st2common_pkg, '--prefix', prefix])
    }

    this.serverless.cli.log('Creating pack venv');
    const packs = fs.readdirSync(`${MAGIC_FOLDER}/packs`);

    for (let pack in packs) {
      const prefix = `${INTERNAL_MAGIC_FOLDER}/virtualenvs/${packs[pack]}`;
      await this.execDocker(dockerId, ['virtualenv', prefix])

      const pip = `${INTERNAL_MAGIC_FOLDER}/virtualenvs/${packs[pack]}/bin/pip`;
      const requirements = `${INTERNAL_MAGIC_FOLDER}/packs/${packs[pack]}/requirements.txt`;
      await this.execDocker(dockerId, [pip, 'install', '-I',  '-r', requirements]);
    }

    this.serverless.cli.log('Stop Docker container');
    await this.stopDocker(dockerId);
  }

  async getIndex() {
    if (!this.index) {
      this.index = await request.get(INDEX_URL).then(res => res.data);
    }

    return this.index;
  }
}

module.exports = StackstormPlugin;
