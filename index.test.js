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
      log: sinon.stub(),
      consoleLog: sinon.stub()
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

  it('should have default initial value of dockerRunImage', () => {
    const instance = new StackStorm(sls, opts);

    expect(instance).to.have.property('dockerBuildImage').that.equal('lambci/lambda:build-python2.7');
  });

  it('should have default initial value of dockerRunImage', () => {
    const instance = new StackStorm(sls, opts);

    expect(instance).to.have.property('dockerBuildImage').that.equal('lambci/lambda:build-python2.7');
  });

  it('should allow redefine dockerBuildImage and dockerRunImage value with custom fields', () => {
    const serverless = {
      service: {
        custom: {
          stackstorm: {
            buildImage: 'custom/image',
            runImage: 'custom/otherimage'
          }
        }
      }
    };

    const instance = new StackStorm(serverless, opts);

    expect(instance).to.have.property('dockerBuildImage').that.equal('custom/image');
    expect(instance).to.have.property('dockerRunImage').that.equal('custom/otherimage');
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
        'git+https://github.com/StackStorm/st2.git#egg=python_runner&subdirectory=contrib/runners/python_runner',
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
      const startStub = sinon.stub().resolves(Promise.resolve('deadbeef'));
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          startDocker: startStub
        }
      });

      const instance = new StackStorm(sls, opts);

      await expect(instance.startDocker()).to.eventually.be.equal('deadbeef');
      expect(startStub).to.be.calledOnce;
      expect(startStub).to.be.calledWith();
    });

    it('should fail if docker container is already spinning', async () => {
      const startStub = sinon.stub().resolves(Promise.resolve('deadbeef'));
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          startDocker: startStub
        }
      });

      const instance = new StackStorm(sls, opts);
      await instance.startDocker();

      await expect(instance.startDocker()).to.eventually.be.rejected;
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

    it('should fail if no docker container is set', async () => {
      const startStub = sinon.stub().resolves(Promise.resolve('deadbeef'));
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          startDocker: startStub
        }
      });

      const instance = new StackStorm(sls, opts);

      await expect(instance.stopDocker()).to.eventually.be.rejected;
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

  describe('#runDocker', () => {
    it('should execute a function in the container', async () => {
      const runStub = sinon.stub().resolves({ result: 'some' });
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          runDocker: runStub
        }
      });

      const serverless = {
        ...sls,
        service: {
          package: {},
          functions: {
            somefunc: {
              st2_function: 'some.function'
            }
          }
        }
      };

      const instance = new StackStorm(serverless, opts);
      instance.clonePack = sinon.stub().resolves();
      instance.getAction = sinon.stub().resolves();
      instance.copyAdapter = sinon.stub().resolves();
      instance.installCommonsDockerized = sinon.stub().resolves();

      await expect(instance.runDocker('somefunc', '{"inputData": true}', {
        verbose: true
      })).to.eventually.be.fulfilled;
      expect(runStub).to.be.calledOnce;
      expect(runStub).to.be.calledWith(
        'lambci/lambda:python2.7',
        ['/Volumes/StackStorm/serverless-plugin-stackstorm/~st2:/var/task/~st2'],
        [
          'ST2_ACTION=some.function',
          [
            'PYTHONPATH=/var/task/~st2',
            '/var/task/~st2/deps/lib/python2.7/site-packages',
            '/var/task/~st2/deps/lib64/python2.7/site-packages',
            '/var/task/~st2/virtualenvs/some/lib/python2.7/site-packages',
            '/var/task/~st2/virtualenvs/some/lib64/python2.7/site-packages'
          ].join(':')
        ],
        ['~st2/handler.basic', '{"inputData": true}']
      );
    });

    it('should read input data from stdio', async () => {
      const runStub = sinon.stub().resolves({ result: 'some' });
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          runDocker: runStub
        },
        'get-stdin': sinon.stub().resolves('{"inputStream": false}')
      });

      const serverless = {
        ...sls,
        service: {
          package: {},
          functions: {
            somefunc: {
              st2_function: 'some.function'
            }
          }
        }
      };

      const instance = new StackStorm(serverless, opts);
      instance.clonePack = sinon.stub().resolves();
      instance.getAction = sinon.stub().resolves();
      instance.copyAdapter = sinon.stub().resolves();
      instance.installCommonsDockerized = sinon.stub().resolves();

      await expect(instance.runDocker('somefunc')).to.eventually.be.fulfilled;
      expect(runStub).to.be.calledOnce;
      expect(runStub).to.be.calledWith(
        'lambci/lambda:python2.7',
        ['/Volumes/StackStorm/serverless-plugin-stackstorm/~st2:/var/task/~st2'],
        [
          'ST2_ACTION=some.function',
          [
            'PYTHONPATH=/var/task/~st2',
            '/var/task/~st2/deps/lib/python2.7/site-packages',
            '/var/task/~st2/deps/lib64/python2.7/site-packages',
            '/var/task/~st2/virtualenvs/some/lib/python2.7/site-packages',
            '/var/task/~st2/virtualenvs/some/lib64/python2.7/site-packages'
          ].join(':')
        ],
        ['~st2/handler.basic', '{"inputStream": false}']
      );
    });

    it('should read input data from file', async () => {
      const runStub = sinon.stub().resolves({ result: 'some' });
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          runDocker: runStub
        }
      });

      const serverless = {
        ...sls,
        config: {
          servicePath: '~'
        },
        service: {
          package: {},
          functions: {
            somefunc: {
              st2_function: 'some.function'
            }
          }
        },
        utils: {
          fileExistsSync: sinon.stub().returns(true),
          readFileSync: sinon.stub().returns('{"inputFile": "some"}')
        }
      };

      const instance = new StackStorm(serverless, opts);
      instance.clonePack = sinon.stub().resolves();
      instance.getAction = sinon.stub().resolves();
      instance.copyAdapter = sinon.stub().resolves();
      instance.installCommonsDockerized = sinon.stub().resolves();

      await expect(instance.runDocker('somefunc', null, {
        path: 'some'
      })).to.eventually.be.fulfilled;
      expect(runStub).to.be.calledOnce;
      expect(runStub).to.be.calledWith(
        'lambci/lambda:python2.7',
        ['/Volumes/StackStorm/serverless-plugin-stackstorm/~st2:/var/task/~st2'],
        [
          'ST2_ACTION=some.function',
          [
            'PYTHONPATH=/var/task/~st2',
            '/var/task/~st2/deps/lib/python2.7/site-packages',
            '/var/task/~st2/deps/lib64/python2.7/site-packages',
            '/var/task/~st2/virtualenvs/some/lib/python2.7/site-packages',
            '/var/task/~st2/virtualenvs/some/lib64/python2.7/site-packages'
          ].join(':')
        ],
        ['~st2/handler.basic', '{"inputFile": "some"}']
      );
    });

    it('should reject if file does not exist', async () => {
      const runStub = sinon.stub().resolves({ result: 'some' });
      const StackStorm = mock('./index.js', {
        './lib/docker': {
          runDocker: runStub
        }
      });

      const serverless = {
        ...sls,
        config: {
          servicePath: '~'
        },
        service: {
          package: {},
          functions: {
            somefunc: {
              st2_function: 'some.function'
            }
          }
        },
        utils: {
          fileExistsSync: sinon.stub().returns(false),
          readFileSync: sinon.stub().returns('{"inputFile": "some"}')
        }
      };

      const instance = new StackStorm(serverless, opts);
      instance.clonePack = sinon.stub().resolves();
      instance.getAction = sinon.stub().resolves();
      instance.copyAdapter = sinon.stub().resolves();
      instance.installCommonsDockerized = sinon.stub().resolves();

      await expect(instance.runDocker('somefunc', null, {
        path: 'some'
      })).to.eventually.be.rejected;

    });
  });

  describe('#showActionInfo', () => {
    it('should display action help', async () => {
      const getStub = sinon.stub();

      getStub
        .withArgs('https://index.stackstorm.org/v1/packs/some/actions/action.with.dots.json')
        .resolves({
          data: {
            'description': 'register a server to the SLB',
            'enabled': true,
            'entry_point': 'ax_action_runner.py',
            'name': 'add_slb_server',
            'parameters': {
              'action': {
                'default': 'create',
                'immutable': true,
                'type': 'string'
              },
              'appliance': {
                'description': 'The appliance information to connect, which is specified at the "appliance" parameter in the configuration.',
                'required': true,
                'type': 'string'
              }
            },
            'runner_type': 'python-script'
          }
        });

      getStub
        .withArgs('https://index.stackstorm.org/v1/packs/some/config.schema.json')
        .resolves({
          data: {
            'appliance': {
              'description': 'Appliance parameters to connect',
              'type': 'array'
            }
          }
        });

      const StackStorm = mock('./index.js', {
        'axios': {
          get: getStub
        }
      });

      const serverless = {
        ...sls,
        cli: {
          consoleLog: sinon.spy()
        }
      };

      const instance = new StackStorm(serverless, opts);

      await expect(instance.showActionInfo('some.action.with.dots')).to.eventually.be.fulfilled;
      expect(serverless.cli.consoleLog).to.be.calledWith([
        '\u001b[33msome.action.with.dots\u001b[39m \u001b[2m.........\u001b[22m register a server to the SLB',
        '\u001b[33m\u001b[4mParameters\u001b[24m\u001b[39m',
        '  \u001b[33maction [string] \u001b[39m \u001b[2m............\u001b[22m \u001b[2mdescription is missing\u001b[22m',
        '  \u001b[33mappliance [string] (required)\u001b[39m  The appliance information to connect, which is specified at the "appliance" parameter in the configuration.',
        '\u001b[33m\u001b[4mConfig\u001b[24m\u001b[39m',
        '  \u001b[33mappliance [array] \u001b[39m \u001b[2m..........\u001b[22m Appliance parameters to connect'
      ].join('\n'));
    });
  });
});
