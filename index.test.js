/* eslint-env mocha */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const mock = require('proxyquire');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');

chai.use(chaiAsPromised);
chai.use(sinonChai);
const expect = chai.expect;

const StackStorm = require('./index.js');

class CustomError extends Error {}

describe('index', () => {
  const sls = {
    cli: {
      log: sinon.stub()
    },
    classes: {
      Error: CustomError
    },
    service: {}
  };
  const opts = {};

  it('should have falsy initial value of dockerId', () => {
    const instance = new StackStorm(sls, opts);

    expect(instance).to.have.property('dockerId').that.is.not.ok;
  });

  it('should have default initial value of dockerImage', () => {
    const instance = new StackStorm(sls, opts);

    expect(instance).to.have.property('dockerImage').that.equal('lambci/lambda:build-python2.7');
  });

  it('should allow redefine dockerImage value with custom field', () => {
    const serverless = {
      service: {
        custom: {
          stackstorm: {
            image: 'custom/image'
          }
        }
      }
    };

    const instance = new StackStorm(serverless, opts);

    expect(instance).to.have.property('dockerImage').that.equal('custom/image');
  });

  it('should have default initial value of index_url', () => {
    const instance = new StackStorm(sls, opts);

    expect(instance).to.have.property('index_url').that.equal('https://index.stackstorm.org/v1/index.json');
  });

  it('should allow redefine index_url value with custom field', () => {
    const serverless = {
      service: {
        custom: {
          stackstorm: {
            index: 'http://custom/url'
          }
        }
      }
    };

    const instance = new StackStorm(serverless, opts);

    expect(instance).to.have.property('index_url').that.equal('http://custom/url');
  });

  describe('#getIndex', () => {
    it('should retrieve and return StackStorm index', async () => {
      const getStub = sinon.stub().resolves({ data: 'some' });
      const StackStorm = mock('./index.js', {
        axios: {
          get: getStub
        }
      });

      const instance = new StackStorm(sls, opts);

      await expect(instance.getIndex()).to.eventually.equal('some');
      expect(getStub).to.be.calledOnce;
      expect(getStub).to.be.calledWith(instance.index_url);
    });
  });

  describe('#clean', () => {
    it('should remove MAGIC_FOLDER', async () => {
      const removeStub = sinon.stub().resolves();
      const StackStorm = mock('./index.js', {
        'fs-extra': {
          remove: removeStub
        }
      });

      const instance = new StackStorm(sls, opts);

      await expect(instance.clean()).to.eventually.be.fulfilled;
      expect(removeStub).to.be.calledOnce;
      expect(removeStub).to.be.calledWith('~st2');
    });
  });

  describe('#copyDeps', () => {
    it('should install StackStorm deps', async () => {
      const execStub = sinon.stub().resolves();
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          execDocker: execStub
        }
      });

      const instance = new StackStorm(sls, opts);
      instance.dockerId = 'some';

      await expect(instance.copyDeps()).to.eventually.be.fulfilled;
      expect(execStub).to.be.calledOnce;
      expect(execStub).to.be.calledWith(instance.dockerId, [
        'pip', 'install', '-I',
        'git+https://github.com/stackstorm/st2.git#egg=st2common&subdirectory=st2common',
        'git+https://github.com/StackStorm/st2#egg=python_runner&subdirectory=contrib/runners/python_runner',
        '--prefix', '/var/task/~st2/deps'
      ]);
    });

    it('should throw an error if no docker container has been started', async () => {
      const execStub = sinon.stub().resolves();
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          execDocker: execStub
        }
      });

      const instance = new StackStorm(sls, opts);

      await expect(instance.copyDeps()).to.eventually.rejectedWith(CustomError);
    });
  });

  describe('#copyPackDeps', () => {
    it('should install pack deps', async () => {
      const execStub = sinon.stub().resolves();
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          execDocker: execStub
        }
      });

      const instance = new StackStorm(sls, opts);
      instance.dockerId = 'some';

      await expect(instance.copyPackDeps('dummypack')).to.eventually.be.fulfilled;
      expect(execStub).to.be.calledTwice;
      expect(execStub).to.be.calledWith(instance.dockerId, [
        'mkdir', '-p', '/var/task/~st2/virtualenvs/dummypack/lib/python2.7/site-packages'
      ]);
      expect(execStub).to.be.calledWith(instance.dockerId, [
        '/bin/bash', '-c',
        'PYTHONPATH=$PYTHONPATH:/var/task/~st2/virtualenvs/dummypack/lib/python2.7/site-packages ' +
        'pip --isolated install -r /var/task/~st2/packs/dummypack/requirements.txt ' +
        '--prefix /var/task/~st2/virtualenvs/dummypack --src /var/task/~st2/virtualenvs/dummypack/src'
      ]);
    });

    it('should throw an error if no docker container has been started', async () => {
      const execStub = sinon.stub().resolves();
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          execDocker: execStub
        }
      });

      const instance = new StackStorm(sls, opts);

      await expect(instance.copyPackDeps('dummypack')).to.eventually.be.rejectedWith(CustomError);
    });
  });

  describe('#copyAllPacksDeps', () => {
    it('should install StackStorm deps', async () => {
      const StackStorm = mock('./index.js', {
        'fs-extra': {
          readdirSync: () => [1, 2, 3]
        }
      });

      const instance = new StackStorm(sls, opts);
      instance.copyPackDeps = sinon.stub().resolves();

      await expect(instance.copyAllPacksDeps()).to.eventually.be.fulfilled;
      expect(instance.copyPackDeps).to.be.calledThrice;
      expect(instance.copyPackDeps).to.be.calledWith(1);
      expect(instance.copyPackDeps).to.be.calledWith(2);
      expect(instance.copyPackDeps).to.be.calledWith(3);
    });
  });

  describe('#clonePack', () => {
    it('should clone StackStorm pack if it doesn\'t exist yet', async () => {
      const cloneStub = sinon.stub().resolves();
      const StackStorm = mock('./index.js', {
        'nodegit': {
          Clone: cloneStub
        }
      });

      const instance = new StackStorm(sls, opts);
      instance.getIndex = () => ({
        packs: {
          some: {
            ref: 'some',
            repo_url: 'http://thing/'
          }
        }
      });

      await expect(instance.clonePack('some')).to.eventually.be.fulfilled;
      expect(cloneStub).to.be.calledOnce;
      expect(cloneStub).to.be.calledWith('http://thing/', '~st2/packs/some');
    });

    it('should pull the latest master for StackStorm pack if it exists already', async () => {
      const fetchStub = sinon.stub().resolves();
      const mergeStub = sinon.stub().resolves();
      const openStub = sinon.stub().resolves({
        fetchAll: fetchStub,
        mergeBranches: mergeStub
      });
      const StackStorm = mock('./index.js', {
        'nodegit': {
          Repository: {
            open: openStub
          }
        }
      });

      const instance = new StackStorm(sls, opts);
      instance.getIndex = () => ({
        packs: {
          some: {
            ref: 'some',
            repo_url: 'http://thing/'
          }
        }
      });

      await expect(instance.clonePack('some')).to.eventually.be.fulfilled;
      expect(openStub).to.be.calledOnce;
      expect(openStub).to.be.calledWith('~st2/packs/some');
      expect(fetchStub).to.be.calledOnce;
      expect(fetchStub).to.be.calledWith();
      expect(mergeStub).to.be.calledOnce;
      expect(mergeStub).to.be.calledWith('master', 'origin/master');
    });
  });

  describe('#clonePacks', () => {
    it('should clone all stackstorm packs mentioned in the serverless.yml', async () => {
      const serverless = {
        service: {
          functions: {
            one: {
              st2_function: 'some.one'
            },
            two: {
              st2_function: 'some.two'
            },
            three: {
              st2_function: 'someother.three'
            },
            four: {
              handler: 'some'
            }
          }
        }
      };

      const instance = new StackStorm(serverless, opts);
      instance.clonePack = sinon.stub().resolves();

      await expect(instance.clonePacks()).to.eventually.be.fulfilled;
      expect(instance.clonePack).to.be.calledTwice;
      expect(instance.clonePack).to.be.calledWith('some');
      expect(instance.clonePack).to.be.calledWith('someother');
    });
  });

  describe('#getAction', () => {
    it('should return action\'s metadata', async () => {
      const actionMetaYaml = 'some: thing';
      const readStub = sinon.stub().returns(actionMetaYaml);
      const StackStorm = mock('./index.js', {
        'fs-extra': {
          readFileSync: readStub
        }
      });

      const instance = new StackStorm(sls, opts);

      await expect(instance.getAction('some', 'thing')).to.eventually.be.deep.equal({some: 'thing'});
      expect(readStub).to.be.calledOnce;
      expect(readStub).to.be.calledWith('~st2/packs/some/actions/thing.yaml');
    });
  });

  describe('#pullDockerImage', () => {
    it('should pull the image', async () => {
      const pullStub = sinon.stub().resolves();
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          pullDockerImage: pullStub
        }
      });

      const instance = new StackStorm(sls, opts);

      await expect(instance.pullDockerImage()).to.eventually.be.fulfilled;
      expect(pullStub).to.be.calledOnce;
      expect(pullStub).to.be.calledWith();
    });
  });

  describe('#startDocker', () => {
    it('should start the container', async () => {
      const startStub = sinon.stub().resolves();
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          startDocker: startStub
        }
      });

      const instance = new StackStorm(sls, opts);

      await expect(instance.startDocker()).to.eventually.be.fulfilled;
      expect(startStub).to.be.calledOnce;
      expect(startStub).to.be.calledWith();
    });
  });

  describe('#stopDocker', () => {
    it('should stop the container', async () => {
      const stopStub = sinon.stub().resolves();
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          stopDocker: stopStub
        }
      });

      const instance = new StackStorm(sls, opts);

      await expect(instance.stopDocker('someId')).to.eventually.be.fulfilled;
      expect(stopStub).to.be.calledOnce;
      expect(stopStub).to.be.calledWith('someId');
    });
  });

  describe('#execDocker', () => {
    it('should execute a command in the container', async () => {
      const execStub = sinon.stub().resolves();
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          execDocker: execStub
        }
      });

      const instance = new StackStorm(sls, opts);
      instance.dockerId = 'someId';

      await expect(instance.execDocker('some command')).to.eventually.be.fulfilled;
      expect(execStub).to.be.calledOnce;
      expect(execStub).to.be.calledWith('someId', 'some command');
    });
  });
});
