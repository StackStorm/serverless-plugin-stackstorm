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

      await expect(instance.copyPackDeps('dummypack')).to.eventually.rejectedWith(CustomError);
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
});
