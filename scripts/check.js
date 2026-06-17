const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const files = [
  'src/main/clip-args.js',
  'src/main/main.js',
  'src/main/preload.js',
  'src/renderer/app.js',
  'src/renderer/log-window.js',
  'scripts/fetch-binaries.js',
  'scripts/start-electron.js',
  'scripts/check-clip-args.js',
  'scripts/check-clip-durations.js'
];

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(__dirname, '..', file)], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    console.error(`\n${file}`);
    console.error(result.stderr || result.stdout);
  } else {
    console.log(`ok ${file}`);
  }
}

function assertSource(file, pattern, message) {
  const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  if (!pattern.test(content)) {
    failed = true;
    console.error(`\n${file}`);
    console.error(message);
  } else {
    console.log(`ok ${message}`);
  }
}

function assertNoSource(file, pattern, message) {
  const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  if (pattern.test(content)) {
    failed = true;
    console.error(`\n${file}`);
    console.error(message);
  } else {
    console.log(`ok ${message}`);
  }
}

assertSource('src/renderer/styles.css', /\.video-list\s*\{[^}]*flex:\s*1;[^}]*max-height:\s*none;/s, 'videos list fills available card height');
assertSource('src/renderer/index.html', /id="mediaActionHint"[^>]*>Add a project name to enable Download and Generate Clips\./, 'disabled media action hint exists');
assertSource('src/renderer/styles.css', /\.action-hint\s*\{(?=[^}]*background:\s*#2b1712;)(?=[^}]*color:\s*#fff7ed;)(?=[^}]*border-left:\s*4px\s+solid\s+var\(--brand\);)/s, 'disabled media action hint uses high-contrast warning colors');
assertSource('src/renderer/app.js', /onMenuAction\(\(action\) =>[\s\S]*new-project[\s\S]*change-output-folder[\s\S]*view-log[\s\S]*check-updates/, 'renderer handles native menu actions');
assertSource('src/renderer/index.html', /id="updateBanner"[\s\S]*Download installer/, 'renderer has inline update banner');
assertSource('src/renderer/app.js', /function checkForUpdates[\s\S]*window\.clipMaker\.checkForUpdates[\s\S]*openUpdateDownload/, 'renderer checks GitHub Releases for updates');
assertSource('src/main/preload.js', /checkForUpdates:\s*\(\) => ipcRenderer\.invoke\('check-for-updates'\)[\s\S]*openUpdateDownload/, 'preload exposes update check bridge');
assertSource('src/main/main.js', /api\.github\.com\/repos\/vpfintech\/youtube-clip-maker\/releases\/latest[\s\S]*selectInstallerAsset[\s\S]*openSafeUpdateUrl/, 'main process checks GitHub Releases and opens installer links');
assertNoSource('src/renderer/app.js', new RegExp('to' + 'ast', 'i'), 'renderer does not trigger popup notifications');
assertNoSource('src/renderer/index.html', new RegExp('id="to' + 'ast"|class="to' + 'ast', 'i'), 'renderer HTML has no popup notification element');
assertNoSource('src/renderer/styles.css', new RegExp('\\.to' + 'ast\\b', 'i'), 'renderer CSS has no popup notification styles');
assertSource('src/main/preload.js', /onMenuAction:\s*\(callback\) =>[\s\S]*ipcRenderer\.on\('menu-action'/, 'preload exposes native menu action bridge');
assertSource('src/main/main.js', /Menu\.setApplicationMenu\(Menu\.buildFromTemplate\(template\)\)/, 'native app menu is explicitly configured');
assertSource('src/main/main.js', /label:\s*'File'[\s\S]*New Project[\s\S]*Change Output Folder[\s\S]*View Log/, 'native File menu contains app actions');
assertSource('src/main/main.js', /label:\s*'Edit'[\s\S]*role:\s*'undo'[\s\S]*role:\s*'paste'[\s\S]*role:\s*'selectAll'/, 'native Edit menu keeps text editing roles');
assertSource('src/main/main.js', /label:\s*'Help'[\s\S]*YouTube Automation Tools[\s\S]*http:\/\/ytatools\.co[\s\S]*View License[\s\S]*github\.com\/vpfintech\/youtube-clip-maker\?tab=License-1-ov-file/, 'native Help menu links to ytatools.co and license');
assertSource('README.md', /YT Clip Maker is \*\*source-available\*\* \(not open source\)/, 'README clearly says source-available, not open source');
assertSource('README.md', /### macOS[\s\S]*npm run dist:mac[\s\S]*### Windows[\s\S]*npm run dist:win/, 'README includes macOS and Windows build instructions');
assertNoSource('src/main/main.js', /^const\s+ffmpegInstaller\s*=\s*require\('@ffmpeg-installer\/ffmpeg'\);/m, 'main process does not require ffmpeg at startup');
assertSource('src/main/main.js', /function ffmpegPath\(\)[\s\S]*require\('@ffmpeg-installer\/ffmpeg'\)[\s\S]*FFmpeg is missing from this app build/, 'main process lazily resolves ffmpeg with a useful runtime error');
assertSource('package.json', /"optionalDependencies"\s*:\s*\{[\s\S]*"@ffmpeg-installer\/win32-x64"\s*:\s*"\^4\.1\.0"/, 'Windows ffmpeg package is declared for Windows installs/builds');
process.exit(failed ? 1 : 0);
