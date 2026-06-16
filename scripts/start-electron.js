const { spawn } = require('child_process');
const electron = require('electron');

const child = spawn(electron, ['.'], { stdio: 'inherit' });

child.on('exit', (code, signal) => {
  if (signal === 'SIGTERM' || signal === 'SIGINT') process.exit(0);
  process.exit(code ?? 0);
});

process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
