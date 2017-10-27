const child_process = require('child_process')

module.exports.startDocker = async (dockerImage, volume) => {
  const args = ['run']
    .concat(['-d', '--rm', '-v', volume, dockerImage])
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

module.exports.execDocker = async (dockerId, command) => {
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

module.exports.stopDocker = async (dockerId) => {
  const args = ['stop', dockerId];
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
