const child_process = require('child_process');
const EventEmitter = require('events');

function factory(args) {
  const spawnOptions = {
    encoding: 'utf8'
  };

  const emitter = new EventEmitter();

  const run = child_process.spawn('docker', args, spawnOptions);

  run.stdout.on('data', (data) => {
    emitter.emit('stdout', data.toString().replace(/\n$/, ''));
  });

  run.stderr.on('data', (data) => {
    emitter.emit('stderr', data.toString().replace(/\n$/, ''));
  });

  return { run, emitter };
}

function bufferStreams(run) {
  const o = {
    stdout: '',
    stderr: ''
  };

  run.stdout.on('data', (data) => {
    o.stdout += data.toString();
  });

  run.stderr.on('data', (data) => {
    o.stderr += data.toString();
  });

  return o;
}

function mixin(promise, emitter) {
  promise.on = (...args) => {
    emitter.on(...args);

    return promise;
  };

  return promise;
}

module.exports.pullDockerImage = (dockerImage) => {
  const args = ['pull']
    .concat([dockerImage])
    ;

  const { run, emitter } = factory(args);

  const buf = bufferStreams(run);

  const promise = new Promise((resolve, reject) => {
    run.on('close', (code) => {
      if (code === 0) {
        resolve({ ...buf, code });
      } else {
        reject(new Error(buf.stderr));
      }
    });
  });

  return mixin(promise, emitter);
};

module.exports.startDocker = (dockerImage, volume) => {
  const args = ['run']
    .concat(['-d', '--rm', '-v', volume, dockerImage])
    .concat(['tail', '-f', '/dev/null'])
    ;

  const { run, emitter } = factory(args);

  const promise = Promise.all([
    new Promise((resolve, reject) => {
      run.stdout.on('data', (data) => {
        resolve(data.toString().replace(/\n$/, ''));
      });

      run.stderr.on('data', (data) => {
        reject(data.toString().replace(/\n$/, ''));
      });
    }),
    new Promise(resolve => run.on('close', resolve))
  ]).then(res => res[0]);

  return mixin(promise, emitter);
};

module.exports.runDocker = (dockerImage, volumes, envs, cmd) => {
  let args = ['run']
    .concat(['--rm'])
    ;

  for (const volume of volumes) {
    args = args.concat(['-v', volume]);
  }

  for (const env of envs) {
    args = args.concat(['-e', env]);
  }

  args = args
    .concat([dockerImage])
    .concat(cmd);

  const { run, emitter } = factory(args);

  const buf = bufferStreams(run);

  const promise = new Promise((resolve, reject) => {
    run.on('close', (code) => {
      const res = { ...buf, code };

      const lines = buf.stdout.split('\n');
      if (lines.length > 1 && lines[lines.length - 2]) {
        try {
          lines.pop(); // Remove empty element
          res.result = JSON.parse(lines.pop());
          lines.push(''); // Put empty element back
          res.stdout = lines.join('\n');
        } catch (e) {
          // If it didn't work, well, ¯\_(ツ)_/¯
        }
      }

      if (code === 0) {
        resolve(res);
      } else {
        reject(res);
      }
    });
  });

  return mixin(promise, emitter);
};

module.exports.execDocker = (dockerId, command) => {
  const args = ['exec', dockerId]
    .concat(command)
    ;

  const { run, emitter } = factory(args);

  const buf = bufferStreams(run);

  const promise = new Promise((resolve, reject) => {
    run.on('close', (code) => {
      if (code === 0) {
        resolve({ ...buf, code});
      } else {
        reject(new Error(buf.stderr));
      }
    });
  });

  return mixin(promise, emitter);
};

module.exports.stopDocker = (dockerId) => {
  const args = ['stop', dockerId];

  const { run, emitter } = factory(args);

  const promise = new Promise((resolve, reject) => {
    run.stdout.on('data', (data) => {
      resolve(data.toString().replace(/\n$/, ''));
    });

    run.stderr.on('data', (data) => {
      reject(data.toString().replace(/\n$/, ''));
    });
  });

  return mixin(promise, emitter);
};
