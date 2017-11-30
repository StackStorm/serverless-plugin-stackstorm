const child_process = require('child_process');
const chalk = require('chalk');

module.exports.pullDockerImage = async (dockerImage) => {
  const args = ['pull']
    .concat([dockerImage])
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
      console.log(chalk.dim(str.replace(/\n$/, '')));
      stdout += str;
    });

    run.stderr.on('data', (data) => {
      const str = data.toString();
      console.log(chalk.dim(str.replace(/\n$/, '')));
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
};

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
      console.log(chalk.dim(str.replace(/\n$/, '')));
      resolve(str.replace(/\n$/, ''));
    });

    run.stderr.on('data', (data) => {
      const str = data.toString();
      console.log(chalk.dim(str.replace(/\n$/, '')));
      reject(str.replace(/\n$/, ''));
    });
  });
};

module.exports.runDocker = async (dockerImage, volumes, envs, cmd) => {
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

  const spawnOptions = {
    encoding: 'utf8'
  };

  const run = child_process.spawn('docker', args, spawnOptions);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    run.stdout.on('data', (data) => {
      const str = data.toString();
      console.log(chalk.dim(str.replace(/\n$/, '')));
      stdout += str;
    });

    run.stderr.on('data', (data) => {
      const str = data.toString();
      console.log(chalk.dim(str.replace(/\n$/, '')));
      stderr += str;
    });

    run.on('close', (code) => {
      const res = {
        code,
        stdout,
        stderr,
      };

      const lines = stdout.split('\n');
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
};

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
      console.log(chalk.dim(str.replace(/\n$/, '')));
      stdout += str;
    });

    run.stderr.on('data', (data) => {
      const str = data.toString();
      console.log(chalk.dim(str.replace(/\n$/, '')));
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
};

module.exports.stopDocker = async (dockerId) => {
  const args = ['stop', dockerId];
  const spawnOptions = {
    encoding: 'utf8'
  };

  const run = child_process.spawn('docker', args, spawnOptions);

  return new Promise((resolve, reject) => {
    run.stdout.on('data', (data) => {
      const str = data.toString();
      console.log(chalk.dim(str.replace(/\n$/, '')));
      resolve(str.replace(/\n$/, ''));
    });

    run.stderr.on('data', (data) => {
      const str = data.toString();
      console.log(chalk.dim(str.replace(/\n$/, '')));
      reject(str.replace(/\n$/, ''));
    });
  });
};
