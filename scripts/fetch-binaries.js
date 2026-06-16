const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const binDir = path.join(root, 'bin');
fs.mkdirSync(binDir, { recursive: true });

const platform = process.platform;
const fileName = platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const target = path.join(binDir, fileName);
const url = platform === 'win32'
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : platform === 'darwin'
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

function download(downloadUrl, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(downloadUrl, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (redirects > 5) return reject(new Error('Too many redirects'));
        return resolve(download(response.headers.location, dest, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function main() {
  if (fs.existsSync(target)) {
    if (platform !== 'win32') fs.chmodSync(target, 0o755);
    console.log(`yt-dlp already exists at ${target}`);
    return;
  }

  console.log(`Downloading yt-dlp from ${url}`);
  try {
    await download(url, target);
  } catch (error) {
    console.warn(`Node download failed (${error.message}); trying curl fallback...`);
    const result = spawnSync('curl', ['-L', '--fail', '--retry', '3', '-o', target, url], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }

  if (platform !== 'win32') fs.chmodSync(target, 0o755);
  console.log(`Installed yt-dlp at ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
