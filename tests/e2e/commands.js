/* eslint-env mocha */
const path = require('path');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const serve = require('serve');
const tmp = require('tmp');
const fs = require('fs-extra');

chai.use(chaiAsPromised);
chai.use(sinonChai);
const expect = chai.expect;

const Serverless = require('serverless');

const containers = new Set();

function SLS(command, { servicePath } = {}) {
  const opts = {
    interactive: false
  };

  if (servicePath) {
    opts.servicePath = path.join(__dirname, servicePath);
  }

  const sls = new Serverless(opts);

  class CLI extends sls.classes.CLI {
    constructor(serverless) {
      super(serverless, command);

      this.consoleLog = sinon.stub().callsFake((str) => {
        const container_regex = /(\u001b\[2m)([0-9a-f]{64})(\u001b\[22m)/;
        const match = str.match(container_regex);
        if (match) {
          containers.add(match[2]);
        }
      });
    }
  }

  sls.classes.CLI = CLI;

  return sls;
}

function enterWorkspace() {
  const tmpdir = tmp.dirSync({ unsafeCleanup: true });
  fs.copySync(path.join(__dirname, './service/serverless.yml'), path.join(tmpdir.name, 'serverless.yml'));
  process.chdir(tmpdir.name);

  return tmpdir;
}

describe('StackStorm Serverless Plugin E2E', () => {
  let server, tmpdir, workdir;

  before(() => {
    workdir = process.cwd();
    server = serve(path.join(__dirname, './service'), { port: 45032, clipless: true, silent: true });
  });

  beforeEach(() => {
    tmpdir = enterWorkspace();
  });

  describe('sls stackstorm info', () => {
    it('should return action info', async () => {
      const sls = SLS(['stackstorm', 'info', '--action', 'test.list_vms'], { servicePath: './service' });

      await sls.init();
      await sls.run();

      expect(sls.cli.consoleLog).to.be.calledWith([
        '\u001b[33mtest.list_vms\u001b[39m \u001b[2m.................\u001b[22m List available VMs.',
        '\u001b[33m\u001b[4mParameters\u001b[24m\u001b[39m',
        '  \u001b[33mcredentials [string] (required)\u001b[39m  Name of the credentials set (as defined in the config) to use.',
        '\u001b[2mThe action does not require config parameters\u001b[22m'
      ].join('\n'));
    }).timeout(0);
  });

  describe('sls stackstorm install adapter', () => {
    it('should copy stackstorm files to working directory', async () => {
      const sls = SLS(['stackstorm', 'install', 'adapter']);

      await sls.init();
      await sls.run();

      expect(fs.readdirSync('.')).to.have.members(['serverless.yml', '~st2']);
      expect(fs.readdirSync('~st2')).to.have.members([
        '__init__.py',
        'config.py',
        'console.conf',
        'handler.py',
        'st2.conf'
      ]);
    });
  });

  describe('sls stackstorm install deps', () => {
    it('should copy stackstorm files to working directory', async () => {
      const sls = SLS(['stackstorm', 'install', 'deps', '--noPull']);

      await sls.init();
      await sls.run();

      expect(fs.readdirSync('~st2/deps')).to.have.members([
        'bin',
        'include',
        'lib',
        'lib64',
        'share'
      ]);
    }).timeout(0);
  });

  describe('sls stackstorm install pack', () => {
    it('should copy stackstorm files to working directory', async () => {
      const sls = SLS(['stackstorm', 'install', 'packs', '--pack', 'test']);

      await sls.init();
      await sls.run();

      expect(fs.readdirSync('~st2/packs')).to.have.members([
        'test'
      ]);
    }).timeout(0);
  });

  describe('sls stackstorm install packDeps', () => {
    it('should copy stackstorm files to working directory', async () => {
      const pack = SLS(['stackstorm', 'install', 'packs', '--pack', 'test']);

      await pack.init();
      await pack.run();

      const sls = SLS(['stackstorm', 'install', 'packDeps', '--pack', 'test', '--noPull']);

      await sls.init();
      await sls.run();

      expect(fs.readdirSync('~st2/virtualenvs')).to.have.members([
        'test'
      ]);
    }).timeout(0);
  });

  afterEach(() => {
    try {
      tmpdir.removeCallback();
    } catch (e) {
      // YOLO
    }
  });

  after(async function () {
    this.timeout(0);

    console.log('Cleaning up containers...');

    tmpdir = enterWorkspace();
    for (let id of containers) {
      try {
        const pack = SLS(['stackstorm', 'docker', 'stop', '--dockerId', id]);

        await pack.init();
        await pack.run();

        containers.delete(id);
      } catch (e) {
        // Do nothing
      }
    }
    tmpdir.removeCallback();

    if (containers.size) {
      console.log('Some containers have not been garbage collected:');
      for (let id of containers) {
        console.log(id);
      }
    }

    process.chdir(workdir);
    server.stop();
  });
});
