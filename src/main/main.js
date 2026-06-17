const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const {
  buildClipArgs,
  parseFfmpegProgress,
  selectAccurateVideoEncoder
} = require('./clip-args');

let mainWindow;
let logWindow;
let isQuitting = false;
let server;
let serverUrl;
const oldAppName = 'YouTube Clip Maker';
const appName = 'YT Clip Maker';
let outputFolder = path.join(os.homedir(), 'YouTubeClipMakerDownloads');
let projectName = '';
let videos = [];
let logs = [];
let currentProjectId = null;
const activeChildren = new Set();
let cachedFfmpegEncoders = null;
const editorFriendlyDownloadFormat = 'bv*[vcodec^=avc][ext=mp4]+ba[ext=m4a]/bv*[vcodec^=avc]+ba/b[ext=mp4]/bv*+ba/b';
const releaseApiUrl = 'https://api.github.com/repos/vpfintech/youtube-clip-maker/releases/latest';
const latestReleaseUrl = 'https://github.com/vpfintech/youtube-clip-maker/releases/latest';

app.setName(appName);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function projectsPath() {
  return path.join(app.getPath('userData'), 'recent-projects.json');
}

function legacySettingsPath() {
  return path.join(app.getPath('appData'), oldAppName, 'settings.json');
}

function loadSettings() {
  try {
    const currentPath = settingsPath();
    const fallbackPath = legacySettingsPath();
    const sourcePath = fs.existsSync(currentPath) ? currentPath : fallbackPath;
    const data = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    if (data.outputFolder) outputFolder = data.outputFolder;
    if (sourcePath === fallbackPath) saveSettings();
  } catch {}
}

function saveSettings() {
  ensureDir(app.getPath('userData'));
  fs.writeFileSync(settingsPath(), JSON.stringify({ outputFolder }, null, 2));
}

function projectTimestamp(project) {
  const timestamp = Date.parse(project?.updatedAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortProjectsNewestFirst(projects) {
  return [...projects].sort((a, b) => projectTimestamp(b) - projectTimestamp(a));
}

function readProjects() {
  try {
    const data = JSON.parse(fs.readFileSync(projectsPath(), 'utf8'));
    return Array.isArray(data.projects) ? sortProjectsNewestFirst(data.projects) : [];
  } catch {
    return [];
  }
}

function writeProjects(projects) {
  ensureDir(app.getPath('userData'));
  fs.writeFileSync(projectsPath(), JSON.stringify({ projects: sortProjectsNewestFirst(projects).slice(0, 12) }, null, 2));
}

function projectTitle(items = videos) {
  if (projectName) return projectName;
  const first = items[0];
  if (!first) return 'Untitled project';
  if (items.length === 1) return first.title || 'Untitled project';
  return `${first.title || 'Untitled project'} + ${items.length - 1} more`;
}

function publicProject(project) {
  return {
    id: project.id,
    title: project.title,
    updatedAt: project.updatedAt,
    videoCount: Array.isArray(project.videos) ? project.videos.length : 0
  };
}

function saveCurrentProject() {
  if (!videos.length) return null;
  const now = new Date().toISOString();
  if (!currentProjectId) currentProjectId = `project-${Date.now()}`;
  const project = {
    id: currentProjectId,
    title: projectTitle(),
    updatedAt: now,
    outputFolder,
    projectName,
    selectedId: videos[0]?.id || null,
    videos
  };
  const remaining = readProjects().filter((item) => item.id !== project.id);
  writeProjects([project, ...remaining]);
  return publicProject(project);
}

function isPathInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function appendLog(message) {
  const text = String(message || '').trim();
  if (!text) return;
  const line = `[${new Date().toLocaleTimeString()}] ${text}`;
  logs.push(line);
  if (logs.length > 500) logs = logs.slice(-500);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('log', line);
  if (logWindow && !logWindow.isDestroyed()) logWindow.webContents.send('log', line);
}

function clearLogs() {
  logs = [];
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('log-cleared');
  if (logWindow && !logWindow.isDestroyed()) logWindow.webContents.send('log-cleared');
}

function emitProgress(videoId, stage, percent, label, active = true) {
  const payload = {
    videoId,
    stage,
    percent: Math.max(0, Math.min(100, Math.round(Number(percent || 0)))),
    label,
    active
  };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('progress', payload);
}

function secondsFromTimestamp(value) {
  const match = String(value || '').match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
}

function parseDownloadProgress(text) {
  const matches = [...String(text || '').matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

function ytDlpPath() {
  const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin', name);
  return path.join(app.getAppPath(), 'bin', name);
}

function ffmpegPath() {
  const p = ffmpegInstaller.path;
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

async function getAvailableFfmpegEncoders() {
  if (cachedFfmpegEncoders) return cachedFfmpegEncoders;
  const { stdout, stderr } = await run(ffmpegPath(), ['-hide_banner', '-encoders']);
  cachedFfmpegEncoders = `${stdout || ''}\n${stderr || ''}`;
  return cachedFfmpegEncoders;
}

function killProcessTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  appendLog(`Stopping active process ${child.pid}...`);
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    // Children are spawned as their own process group on macOS/Linux so this
    // also stops nested ffmpeg processes started by yt-dlp.
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => {
    if (child.exitCode === null && !child.killed) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {
        try { child.kill('SIGKILL'); } catch {}
      }
    }
  }, 1500).unref();
}

function killActiveProcesses() {
  if (!activeChildren.size) return;
  appendLog(`Stopping ${activeChildren.size} active download/clip process(es) because the app is closing.`);
  for (const child of activeChildren) killProcessTree(child);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    appendLog(`${path.basename(command)} ${args.join(' ')}`);
    const child = spawn(command, args, {
      ...options,
      windowsHide: true,
      detached: process.platform !== 'win32'
    });
    activeChildren.add(child);
    let stdout = '';
    let stderr = '';
    let stoppingForQuit = false;
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.stream === true || options.stream === 'stdout') appendLog(text.trim());
      if (options.onOutput) options.onOutput(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.stream === true || options.stream === 'stderr') appendLog(text.trim());
      if (options.onOutput) options.onOutput(text);
    });
    child.on('error', (error) => {
      activeChildren.delete(child);
      reject(error);
    });
    child.on('spawn', () => {
      if (isQuitting) {
        stoppingForQuit = true;
        killProcessTree(child);
      }
    });
    child.on('close', (code) => {
      activeChildren.delete(child);
      if (isQuitting || stoppingForQuit) {
        reject(new Error('Operation cancelled because the app closed.'));
        return;
      }
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `${command} exited ${code}`));
    });
  });
}

function parseUrls(text) {
  return String(text || '')
    .split(/\r?\n|\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(value));
}

function safeFileName(name) {
  return String(name || 'video').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'video';
}

function normalizeProjectName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function setProjectName(value) {
  projectName = normalizeProjectName(value);
  return projectName;
}

function requireProjectName(value = projectName) {
  const normalized = setProjectName(value);
  if (!normalized) throw new Error('Add a project name before downloading or generating clips.');
  return normalized;
}

function projectFolder(requireName = false) {
  const name = requireName ? requireProjectName() : projectName;
  return name ? path.join(outputFolder, safeFileName(name)) : outputFolder;
}

function videoIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || null;
    if (!host.endsWith('youtube.com')) return null;
    if (parsed.searchParams.get('v')) return parsed.searchParams.get('v');
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (['shorts', 'embed', 'live'].includes(parts[0])) return parts[1] || null;
    return null;
  } catch {
    return null;
  }
}

function thumbnailUrl(videoId) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').split('-')[0];
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    if ((left[i] || 0) > (right[i] || 0)) return 1;
    if ((left[i] || 0) < (right[i] || 0)) return -1;
  }
  return 0;
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `${appName}/${app.getVersion()}`
      }
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub release check returned ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(10000, () => {
      request.destroy(new Error('GitHub release check timed out'));
    });
    request.on('error', reject);
  });
}

function selectInstallerAsset(assets = []) {
  const preferred = process.platform === 'win32'
    ? [/setup.*\.exe$/i, /\.exe$/i]
    : [/arm64\.dmg$/i, /\.dmg$/i, /\.zip$/i];
  for (const pattern of preferred) {
    const asset = assets.find((item) => pattern.test(item?.name || ''));
    if (asset?.browser_download_url) return asset;
  }
  return null;
}

async function checkForUpdates() {
  const currentVersion = app.getVersion();
  try {
    const release = await requestJson(releaseApiUrl);
    const latestVersion = normalizeVersion(release.tag_name || release.name);
    const installer = selectInstallerAsset(Array.isArray(release.assets) ? release.assets : []);
    const available = latestVersion && compareVersions(latestVersion, currentVersion) > 0;
    return {
      available: Boolean(available),
      currentVersion,
      latestVersion: latestVersion || currentVersion,
      releaseUrl: release.html_url || latestReleaseUrl,
      downloadUrl: installer?.browser_download_url || release.html_url || latestReleaseUrl,
      assetName: installer?.name || '',
      publishedAt: release.published_at || '',
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    appendLog(`Update check failed: ${error.message}`);
    return {
      available: false,
      currentVersion,
      latestVersion: currentVersion,
      releaseUrl: latestReleaseUrl,
      downloadUrl: latestReleaseUrl,
      assetName: '',
      error: error.message,
      checkedAt: new Date().toISOString()
    };
  }
}

function openSafeUpdateUrl(url) {
  const target = url || latestReleaseUrl;
  try {
    const parsed = new URL(target);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') throw new Error('Update URL must be a GitHub HTTPS link.');
    return shell.openExternal(parsed.toString());
  } catch {
    return shell.openExternal(latestReleaseUrl);
  }
}

function mediaUrl(filePath) {
  return `${serverUrl}/media?path=${encodeURIComponent(filePath)}`;
}

function publicVideo(video) {
  return { ...video, fileUrl: video.filePath && fs.existsSync(video.filePath) ? mediaUrl(video.filePath) : null };
}

function videoFolder(video) {
  return path.join(projectFolder(false), safeFileName(video.id));
}

function clipsFolder(video) {
  if (video.filePath && fs.existsSync(video.filePath) && isPathInside(video.filePath, videoFolder(video))) {
    return path.join(path.dirname(video.filePath), 'clips');
  }
  return path.join(videoFolder(video), 'clips');
}

function findInfo(url) {
  const id = videoIdFromUrl(url);
  if (!id) throw new Error(`Could not read a YouTube video ID from: ${url}`);
  return {
    id,
    url,
    title: `YouTube Video ${id}`,
    duration: 0,
    durationLabel: 'Preview ready',
    thumbnail: thumbnailUrl(id),
    resolution: 'best',
    ext: 'MP4',
    sizeLabel: 'Size after download',
    status: 'ready',
    downloadedAtLabel: 'Ready to preview',
    filePath: null,
    clips: []
  };
}

async function downloadVideo(videoId, requestedProjectName) {
  requireProjectName(requestedProjectName);
  const video = videos.find((item) => item.id === videoId);
  if (!video) throw new Error('Video not found');
  emitProgress(video.id, 'download', 0, 'Starting download...');
  const folder = videoFolder(video);
  ensureDir(folder);
  ensureDir(path.join(folder, 'clips'));
  const template = path.join(folder, '%(title).120s [%(id)s].%(ext)s');
  await run(ytDlpPath(), [
    '--no-playlist',
    '--ffmpeg-location', ffmpegPath(),
    '-f', editorFriendlyDownloadFormat,
    '--merge-output-format', 'mp4',
    '--newline',
    '-o', template,
    video.url
  ], {
    stream: true,
    onOutput: (text) => {
      const percent = parseDownloadProgress(text);
      if (percent !== null) emitProgress(video.id, 'download', percent, `Downloading ${Math.round(percent)}%...`);
    }
  });

  const found = fs.readdirSync(folder)
    .map((file) => path.join(folder, file))
    .filter((file) => file.includes(`[${video.id}]`) && /\.(mp4|mkv|webm|mov)$/i.test(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!found) throw new Error('Download finished but output file was not found');
  video.filePath = found;
  const downloadedName = path.basename(found, path.extname(found)).replace(new RegExp(`\\s*\\[${escapeRegExp(video.id)}\\]$`), '').trim();
  if (downloadedName) video.title = downloadedName;
  video.status = 'downloaded';
  video.sizeLabel = formatBytes(fs.statSync(found).size);
  video.downloadedAtLabel = 'Downloaded just now';
  emitProgress(video.id, 'download', 100, 'Download complete.');
  saveCurrentProject();
  return publicVideo(video);
}

async function createClips(videoId, options) {
  requireProjectName(options.projectName);
  const video = videos.find((item) => item.id === videoId);
  if (!video) throw new Error('Video not found');
  if (!video.filePath || !fs.existsSync(video.filePath) || !isPathInside(video.filePath, videoFolder(video))) await downloadVideo(videoId);

  const clipSeconds = Math.max(1, Math.floor(Number(options.clipSeconds || 30)));
  const includeAudio = Boolean(options.includeAudio);
  const clipMode = options.clipMode === 'accurate' ? 'accurate' : 'fast';
  const clipDir = clipsFolder(video);
  ensureDir(clipDir);
  for (const file of fs.readdirSync(clipDir)) {
    if (/^clip-\d+\.mp4$/i.test(file)) fs.unlinkSync(path.join(clipDir, file));
  }
  emitProgress(video.id, 'clips', 0, 'Starting clip generation...');
  const outputPattern = path.join(clipDir, 'clip-%03d.mp4');
  let accurateEncoder = null;
  if (clipMode === 'accurate') {
    const encodersText = await getAvailableFfmpegEncoders();
    accurateEncoder = selectAccurateVideoEncoder(encodersText);
  }
  const modeLabel = clipMode === 'accurate' ? `accurate re-encode (${accurateEncoder})` : 'fast stream-copy';
  appendLog(`Download complete. Starting ${modeLabel} clip generation every ${clipSeconds} second(s)...`);

  const createArgs = (encoder) => buildClipArgs({
    inputPath: video.filePath,
    outputPattern,
    clipSeconds,
    includeAudio,
    clipMode,
    accurateEncoder: encoder
  });

  let durationSeconds = 0;
  let lastClipPercent = 0;
  let lastSpeedText = '';
  const updateClipProgress = (percent, speedText = lastSpeedText) => {
    if (speedText) lastSpeedText = speedText;
    const nextPercent = Math.max(lastClipPercent, Math.min(99, percent));
    lastClipPercent = nextPercent;
    const suffix = lastSpeedText ? ` (${lastSpeedText})` : '';
    emitProgress(video.id, 'clips', nextPercent, `Generating clips ${Math.round(nextPercent)}%${suffix}...`);
  };
  const onOutput = (text) => {
    const progress = parseFfmpegProgress(text);
    const durationMatch = String(text).match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);
    if (durationMatch) durationSeconds = secondsFromTimestamp(durationMatch[1]);
    if (durationSeconds && progress.out_time_ms) {
      const seconds = Number(progress.out_time_ms) / 1000000;
      updateClipProgress((seconds / durationSeconds) * 100, progress.speed || lastSpeedText);
      return;
    }
    const timeMatches = [...String(text).matchAll(/time=(\d+:\d+:\d+(?:\.\d+)?)/g)];
    if (durationSeconds && timeMatches.length) {
      const seconds = secondsFromTimestamp(timeMatches[timeMatches.length - 1][1]);
      updateClipProgress((seconds / durationSeconds) * 100);
    }
  };

  try {
    await run(ffmpegPath(), createArgs(accurateEncoder), { onOutput });
  } catch (error) {
    if (clipMode !== 'accurate' || accurateEncoder === 'libx264') throw error;
    appendLog(`Hardware encoder ${accurateEncoder} failed. Retrying Accurate mode with CPU fallback (libx264).`);
    for (const file of fs.readdirSync(clipDir)) {
      if (/^clip-\d+\.mp4$/i.test(file)) fs.unlinkSync(path.join(clipDir, file));
    }
    accurateEncoder = 'libx264';
    durationSeconds = 0;
    lastClipPercent = 0;
    lastSpeedText = '';
    await run(ffmpegPath(), createArgs(accurateEncoder), { onOutput });
  }
  const clips = fs.readdirSync(clipDir)
    .filter((file) => file.endsWith('.mp4'))
    .map((file) => path.join(clipDir, file))
    .sort();
  video.clips = clips;
  appendLog(`Generated ${clips.length} clips in ${clipDir}`);
  emitProgress(video.id, 'clips', 100, `Generated ${clips.length} clips.`, false);
  saveCurrentProject();
  return { video: publicVideo(video), clipDir, count: clips.length };
}

function startServer() {
  const rendererDir = path.join(__dirname, '..', 'renderer');
  server = http.createServer((req, res) => {
    const parsed = new URL(req.url, 'http://127.0.0.1');
    if (parsed.pathname === '/media') {
      const filePath = parsed.searchParams.get('path');
      if (!filePath || !fs.existsSync(filePath)) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const stat = fs.statSync(filePath);
      const range = req.headers.range;
      const ext = path.extname(filePath).toLowerCase();
      const type = ext === '.webm' ? 'video/webm' : 'video/mp4';
      if (range) {
        const [startText, endText] = range.replace(/bytes=/, '').split('-');
        const start = parseInt(startText, 10);
        const end = endText ? parseInt(endText, 10) : stat.size - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': type
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': type, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }

    if (parsed.pathname === '/feather.min.js') {
      const featherPath = path.join(app.getAppPath(), 'node_modules', 'feather-icons', 'dist', 'feather.min.js');
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      fs.createReadStream(featherPath).pipe(res);
      return;
    }

    const requested = parsed.pathname === '/' ? 'index.html' : parsed.pathname.slice(1);
    const filePath = path.join(rendererDir, requested);
    if (!filePath.startsWith(rendererDir) || !fs.existsSync(filePath)) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(filePath);
    const type = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      serverUrl = `http://127.0.0.1:${port}`;
      resolve(serverUrl);
    });
  });
}

async function createWindow() {
  loadSettings();
  await startServer();
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: appName,
    backgroundColor: '#f7f9fc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  mainWindow.loadURL(serverUrl);
  mainWindow.on('close', () => {
    isQuitting = true;
    killActiveProcesses();
    if (logWindow && !logWindow.isDestroyed()) logWindow.destroy();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
}

function createLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) return logWindow;
  logWindow = new BrowserWindow({
    width: 860,
    height: 560,
    minWidth: 620,
    minHeight: 380,
    title: `${appName} Activity Log`,
    backgroundColor: '#f6f9fd',
    show: false,
    autoHideMenuBar: true,
    parent: mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  logWindow.setMenu(null);
  logWindow.setMenuBarVisibility(false);
  logWindow.loadURL(`${serverUrl}/log.html`);
  logWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      logWindow.hide();
    }
  });
  return logWindow;
}

function showLogWindow() {
  const win = createLogWindow();
  if (win.webContents.isLoading()) {
    win.once('ready-to-show', () => win.show());
    return;
  }
  win.show();
  win.focus();
}

function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu-action', action);
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: appName,
      submenu: [
        { role: 'about', label: `About ${appName}` },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${appName}` }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('new-project') },
        { label: 'Change Output Folder', click: () => sendMenuAction('change-output-folder') },
        { label: 'View Log', accelerator: 'CmdOrCtrl+L', click: () => showLogWindow() },
        { label: 'Check for Updates', click: () => sendMenuAction('check-updates') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        { type: 'separator' },
        { label: 'Activity Log', accelerator: 'CmdOrCtrl+L', click: () => showLogWindow() }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'YouTube Automation Tools', click: () => shell.openExternal('http://ytatools.co') },
        { label: 'View License', click: () => shell.openExternal('https://github.com/vpfintech/youtube-clip-maker?tab=License-1-ov-file') },
        { label: 'Check for Updates', click: () => sendMenuAction('check-updates') },
        { label: 'View Activity Log', click: () => showLogWindow() },
        { type: 'separator' },
        { label: `About ${appName}`, click: () => shell.openExternal('http://ytatools.co') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function markVideosForSelectedOutput() {
  videos = videos.map((video) => {
    if (!video.filePath || isPathInside(video.filePath, videoFolder(video))) return video;
    return {
      ...video,
      status: 'ready',
      filePath: null,
      clips: [],
      sizeLabel: 'Size after download',
      downloadedAtLabel: 'Ready to download to selected folder'
    };
  });
}

function deleteCurrentProject() {
  const projects = readProjects();
  const project = currentProjectId ? projects.find((item) => item.id === currentProjectId) : null;
  const deleteOutputFolder = project?.outputFolder || outputFolder;
  const deleteProjectName = normalizeProjectName(project?.projectName || projectName || project?.title || '');
  let deletedPath = null;

  if (deleteProjectName) {
    const candidate = path.join(deleteOutputFolder, safeFileName(deleteProjectName));
    if (fs.existsSync(candidate) && isPathInside(candidate, deleteOutputFolder) && path.resolve(candidate) !== path.resolve(deleteOutputFolder)) {
      fs.rmSync(candidate, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      deletedPath = candidate;
    }
  }

  const removedId = currentProjectId;
  writeProjects(removedId ? projects.filter((item) => item.id !== removedId) : projects);
  currentProjectId = null;
  projectName = '';
  videos = [];
  appendLog(deletedPath ? `Deleted project folder: ${deletedPath}` : 'Removed current project.');
  return {
    outputFolder,
    projectName,
    selectedId: null,
    videos: [],
    projects: readProjects().map(publicProject),
    deletedPath
  };
}

ipcMain.handle('find-videos', async (_event, text, requestedProjectName) => {
  setProjectName(requestedProjectName);
  const urls = parseUrls(text);
  if (!urls.length) throw new Error('Add at least one valid YouTube URL.');
  appendLog(`Preparing instant previews for ${urls.length} URL(s)`);
  const seen = new Set();
  currentProjectId = `project-${Date.now()}`;
  videos = [];
  for (const url of urls) {
    const info = findInfo(url);
    if (seen.has(info.id)) continue;
    seen.add(info.id);
    videos.push(info);
  }
  saveCurrentProject();
  return videos.map(publicVideo);
});

ipcMain.handle('download-video', async (_event, videoId, requestedProjectName) => downloadVideo(videoId, requestedProjectName));
ipcMain.handle('create-clips', async (_event, videoId, options) => createClips(videoId, options || {}));
ipcMain.handle('update-project-name', async (_event, requestedProjectName) => {
  setProjectName(requestedProjectName);
  saveCurrentProject();
  return projectName;
});
ipcMain.handle('open-youtube', async (_event, url) => shell.openExternal(url));
ipcMain.handle('check-for-updates', async () => checkForUpdates());
ipcMain.handle('open-update-download', async (_event, url) => openSafeUpdateUrl(url));
ipcMain.handle('choose-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (!result.canceled && result.filePaths[0]) {
    outputFolder = result.filePaths[0];
    ensureDir(outputFolder);
    saveSettings();
    markVideosForSelectedOutput();
    saveCurrentProject();
    appendLog(`Output folder changed to ${outputFolder}`);
  }
  return { outputFolder, videos: videos.map(publicVideo) };
});
ipcMain.handle('get-recent-projects', async () => readProjects().map(publicProject));
ipcMain.handle('delete-project', async () => deleteCurrentProject());
ipcMain.handle('new-project', async () => {
  currentProjectId = null;
  projectName = '';
  videos = [];
  appendLog('Started a new blank project.');
  return {
    outputFolder,
    projectName,
    selectedId: null,
    videos: [],
    projects: readProjects().map(publicProject)
  };
});
ipcMain.handle('open-project', async (_event, projectId) => {
  const project = readProjects().find((item) => item.id === projectId);
  if (!project) throw new Error('Project not found');
  currentProjectId = project.id;
  outputFolder = project.outputFolder || outputFolder;
  projectName = normalizeProjectName(project.projectName || project.title || '');
  videos = Array.isArray(project.videos) ? project.videos : [];
  markVideosForSelectedOutput();
  saveSettings();
  saveCurrentProject();
  appendLog(`Opened recent project: ${project.title}`);
  return {
    project: publicProject(project),
    outputFolder,
    projectName,
    selectedId: project.selectedId || videos[0]?.id || null,
    videos: videos.map(publicVideo),
    projects: readProjects().map(publicProject)
  };
});
ipcMain.handle('get-output-folder', async () => outputFolder);
ipcMain.handle('open-output-folder', async () => {
  ensureDir(outputFolder);
  await shell.openPath(outputFolder);
});
ipcMain.handle('show-log-window', async () => showLogWindow());
ipcMain.handle('get-log', async () => logs);
ipcMain.handle('clear-log', async () => clearLogs());
ipcMain.handle('hide-log-window', async () => {
  if (logWindow && !logWindow.isDestroyed()) logWindow.hide();
});
ipcMain.handle('diagnostics', async () => ({ ytDlpPath: ytDlpPath(), ffmpegPath: ffmpegPath(), outputFolder, projectName, logs }));

app.whenReady().then(async () => {
  await createWindow();
  buildAppMenu();
});
app.on('before-quit', () => {
  isQuitting = true;
  killActiveProcesses();
});
app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});
app.on('activate', () => {
  if (!isQuitting && BrowserWindow.getAllWindows().length === 0) createWindow();
});
