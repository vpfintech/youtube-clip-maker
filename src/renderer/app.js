const state = {
  videos: [],
  selectedId: null,
  currentProjectId: null,
  projects: [],
  outputFolder: '',
  projectName: '',
  busy: false,
  progress: null,
  updateInfo: null
};

const $ = (id) => document.getElementById(id);

function icon() { window.feather?.replace(); }
function selectedVideo() { return state.videos.find((video) => video.id === state.selectedId); }
function currentProjectName() { return $('projectName')?.value.trim().replace(/\s+/g, ' ') || ''; }
function hasProjectName() { return Boolean(currentProjectName()); }
function reportError(error) {
  console.error(error?.message || String(error));
}
function updateMediaActionState(video = selectedVideo()) {
  const ready = hasProjectName();
  if ($('downloadBtn')) $('downloadBtn').disabled = state.busy || !video || !ready;
  if ($('clipsBtn')) $('clipsBtn').disabled = state.busy || !video || !ready;
  const hint = $('mediaActionHint');
  if (hint) hint.classList.toggle('hidden', !(video && !ready));
}
function setBusy(busy, label = 'Working...') {
  state.busy = busy;
  $('findBtn').disabled = busy;
  updateMediaActionState();
  updateDeleteProjectState();
}
function canDeleteProject() {
  return Boolean(state.currentProjectId || state.videos.length || state.projectName);
}
function updateDeleteProjectState() {
  if ($('deleteProjectBtn')) $('deleteProjectBtn').disabled = state.busy || !canDeleteProject();
}
function updateProjectNameState(value = currentProjectName()) {
  state.projectName = value;
  const ready = Boolean(value);
  const note = $('projectNameNote');
  if (note) note.textContent = ready ? `Downloads will be saved inside “${value}”.` : 'Required before downloading or generating clips.';
  updateMediaActionState();
  updateDeleteProjectState();
}
function setProgress(progress) {
  state.progress = progress;
  updateProgressUI();
}
function startProgress(stage, label) {
  const video = selectedVideo();
  if (!video) return;
  setProgress({ videoId: video.id, stage, percent: 0, label, active: true });
}
function finishProgress(label) {
  if (!state.progress) return;
  setProgress({ ...state.progress, percent: 100, label, active: false });
  clearTimeout(finishProgress.timer);
  finishProgress.timer = setTimeout(() => {
    if (state.progress && !state.progress.active) setProgress(null);
  }, 1200);
}
function updateProgressUI() {
  const panel = $('progressPanel');
  if (!panel) return;
  const progress = state.progress;
  const visible = progress && progress.videoId === state.selectedId;
  panel.classList.toggle('hidden', !visible);
  if (!visible) return;
  const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percent || 0))));
  const stage = progress.stage === 'clips' ? 'Clips' : 'Download';
  $('progressLabel').textContent = progress.label || `${stage} in progress...`;
  $('progressPercent').textContent = `${percent}%`;
  $('progressFill').style.width = `${percent}%`;
}
function updateOutput(folder) {
  state.outputFolder = folder;
  const storageText = $('storageText');
  if (storageText) storageText.textContent = folder;
}
function renderUpdateBanner(info) {
  const banner = $('updateBanner');
  if (!banner) return;
  const show = Boolean(info?.available);
  banner.classList.toggle('hidden', !show);
  if (!show) return;
  state.updateInfo = info;
  $('updateTitle').textContent = `Update available: v${info.latestVersion}`;
  const asset = info.assetName ? ` Installer: ${info.assetName}.` : '';
  $('updateMessage').textContent = `You are on v${info.currentVersion}. Download the latest installer from GitHub Releases and run it over your current install.${asset}`;
  icon();
}
async function checkForUpdates({ manual = false } = {}) {
  try {
    const info = await window.clipMaker.checkForUpdates();
    if (info.available) {
      renderUpdateBanner(info);
      return info;
    }
    if (manual) {
      state.updateInfo = info;
      renderUpdateBanner({ ...info, available: true, latestVersion: info.currentVersion, assetName: '', currentVersion: info.currentVersion });
      $('updateTitle').textContent = 'You are up to date';
      $('updateMessage').textContent = `YT Clip Maker v${info.currentVersion} is the latest version. You can still open GitHub Releases if needed.`;
    }
    return info;
  } catch (error) {
    reportError(error);
    return null;
  }
}
async function downloadUpdate() {
  const url = state.updateInfo?.downloadUrl || state.updateInfo?.releaseUrl;
  await window.clipMaker.openUpdateDownload(url);
}
function meta(video) {
  return `${video.durationLabel || '—'}  •  ${video.resolution || 'best'}  •  ${video.ext || 'MP4'}  •  ${video.sizeLabel || '—'}`;
}
function videoEmbed(video) {
  if (video.fileUrl) {
    return `<video controls src="${video.fileUrl}"></video>`;
  }
  const id = video.id;
  const origin = encodeURIComponent(window.location.origin);
  return `<iframe title="${escapeHtml(video.title)}" src="https://www.youtube.com/embed/${id}?origin=${origin}&rel=0&modestbranding=1" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
}
function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function formatProjectTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function renderProjects() {
  const list = $('recentProjectsList');
  if (!list) return;
  if (!state.projects.length) {
    list.className = 'recent-projects-list empty-recent';
    list.innerHTML = '<span>No recent projects yet.</span>';
    return;
  }
  list.className = 'recent-projects-list';
  list.innerHTML = state.projects.map((project) => `
    <button class="recent-project ${project.id === state.currentProjectId ? 'active' : ''}" data-project-id="${escapeHtml(project.id)}" title="${escapeHtml(project.title)}">
      <i data-feather="circle"></i>
      <span><strong>${escapeHtml(project.title)}</strong><span>${escapeHtml(formatProjectTime(project.updatedAt))}</span></span>
    </button>
  `).join('');
  list.querySelectorAll('.recent-project').forEach((button) => {
    button.addEventListener('click', () => openProject(button.dataset.projectId));
  });
  icon();
}
async function loadProjects() {
  state.projects = await window.clipMaker.getRecentProjects();
  renderProjects();
}
function renderVideos() {
  $('videoCount').textContent = state.videos.length;
  $('listCount').textContent = `${state.videos.length} video${state.videos.length === 1 ? '' : 's'}`;
  $('totalSize').textContent = state.videos.length ? 'Ready' : '—';

  const list = $('videoList');
  if (!state.videos.length) {
    list.className = 'video-list empty-state';
    list.innerHTML = '<i data-feather="video"></i><strong>No videos yet</strong><span>Add YouTube URLs and click Find videos.</span>';
    icon();
    return;
  }
  list.className = 'video-list';
  list.innerHTML = state.videos.map((video) => `
    <button class="video-card ${video.id === state.selectedId ? 'active' : ''}" data-id="${escapeHtml(video.id)}">
      <div class="thumb">${video.thumbnail ? `<img src="${video.thumbnail}" alt="" />` : ''}<span>${escapeHtml(video.durationLabel || '')}</span></div>
      <div class="video-info"><strong>${escapeHtml(video.title)}</strong><p>${escapeHtml(meta(video))}<br />${escapeHtml(video.downloadedAtLabel || video.status || '')}</p></div>
    </button>
  `).join('');
  list.querySelectorAll('.video-card').forEach((card) => {
    card.addEventListener('click', () => {
      state.selectedId = card.dataset.id;
      render();
    });
  });
}
function renderPreview() {
  const video = selectedVideo();
  updateMediaActionState(video);
  if (!video) {
    $('previewPanel').classList.add('hidden');
    $('previewEmpty').classList.remove('hidden');
    icon();
    return;
  }
  $('previewEmpty').classList.add('hidden');
  $('previewPanel').classList.remove('hidden');
  $('previewTitle').textContent = video.title;
  $('previewMeta').textContent = meta(video);
  $('videoFrame').innerHTML = videoEmbed(video);
  updateProgressUI();
  icon();
}
function render() {
  renderVideos();
  renderPreview();
  renderProjects();
  updateDeleteProjectState();
  icon();
}
function renderSkeleton() {
  const list = $('videoList');
  list.className = 'video-list';
  list.innerHTML = Array.from({ length: 4 }).map(() => `
    <div class="video-card"><div class="thumb skeleton"></div><div class="video-info"><strong class="skeleton">Loading video title</strong><p class="skeleton">Loading metadata</p></div></div>
  `).join('');
}
async function findVideos() {
  updateProjectNameState();
  setProgress(null);
  setBusy(true, 'Finding videos...');
  renderSkeleton();
  try {
    const videos = await window.clipMaker.findVideos($('urlInput').value, state.projectName);
    state.videos = videos;
    state.selectedId = videos[0]?.id || null;
    await loadProjects();
    state.currentProjectId = state.projects[0]?.id || null;
    render();
  } catch (error) {
    render();
    reportError(error);
  } finally {
    setBusy(false);
  }
}
async function downloadSelected() {
  const video = selectedVideo();
  if (!video) return;
  updateProjectNameState();
  if (!state.projectName) {
    $('projectName').focus();
    return;
  }
  startProgress('download', 'Starting download...');
  setBusy(true, 'Downloading video...');
  try {
    const updated = await window.clipMaker.downloadVideo(video.id, state.projectName);
    state.videos = state.videos.map((item) => item.id === updated.id ? updated : item);
    await loadProjects();
    render();
    finishProgress('Download complete.');
  } catch (error) {
    setProgress(null);
    reportError(error);
  } finally {
    setBusy(false);
  }
}
async function createClips() {
  const video = selectedVideo();
  if (!video) return;
  updateProjectNameState();
  if (!state.projectName) {
    $('projectName').focus();
    return;
  }
  startProgress('clips', 'Preparing clips...');
  setBusy(true, 'Generating clips...');
  try {
    const clipSeconds = Math.max(1, Math.floor(Number($('clipSeconds').value) || 30));
    $('clipSeconds').value = String(clipSeconds);
    const result = await window.clipMaker.createClips(video.id, {
      clipSeconds,
      includeAudio: $('includeAudio').checked,
      clipMode: document.querySelector('input[name="clipMode"]:checked')?.value || 'fast',
      projectName: state.projectName
    });
    state.videos = state.videos.map((item) => item.id === result.video.id ? result.video : item);
    await loadProjects();
    render();
    finishProgress(`Generated ${result.count} clips.`);
  } catch (error) {
    setProgress(null);
    reportError(error);
  } finally {
    setBusy(false);
  }
}
async function chooseOutput() {
  const result = await window.clipMaker.chooseOutputFolder();
  const folder = typeof result === 'string' ? result : result.outputFolder;
  if (Array.isArray(result?.videos)) {
    state.videos = result.videos;
    if (!state.videos.some((video) => video.id === state.selectedId)) state.selectedId = state.videos[0]?.id || null;
    await loadProjects();
    render();
  }
  updateOutput(folder);
}
async function startNewProject() {
  if (state.busy) return;
  setProgress(null);
  try {
    const result = await window.clipMaker.newProject();
    state.currentProjectId = null;
    state.projects = result.projects || state.projects;
    state.videos = [];
    state.selectedId = null;
    $('projectName').value = '';
    $('urlInput').value = '';
    updateProjectNameState('');
    updateOutput(result.outputFolder);
    render();
    $('projectName').focus();
  } catch (error) {
    reportError(error);
  }
}
async function deleteProject() {
  if (state.busy || !canDeleteProject()) return;
  const label = state.projectName || selectedVideo()?.title || 'this project';
  if (!window.confirm(`Delete “${label}”?\n\nThis removes it from Recent Projects and deletes downloaded videos/clips for this project.`)) return;
  setProgress(null);
  setBusy(true, 'Deleting project...');
  try {
    const result = await window.clipMaker.deleteProject();
    state.currentProjectId = null;
    state.projects = result.projects || [];
    state.videos = [];
    state.selectedId = null;
    $('projectName').value = '';
    $('urlInput').value = '';
    updateProjectNameState('');
    updateOutput(result.outputFolder);
    render();
  } catch (error) {
    reportError(error);
  } finally {
    setBusy(false);
  }
}
async function openProject(projectId) {
  if (!projectId || state.busy) return;
  setProgress(null);
  try {
    const result = await window.clipMaker.openProject(projectId);
    state.currentProjectId = result.project?.id || projectId;
    state.projects = result.projects || state.projects;
    state.videos = result.videos || [];
    state.selectedId = result.selectedId || state.videos[0]?.id || null;
    $('projectName').value = result.projectName || '';
    updateProjectNameState();
    updateOutput(result.outputFolder);
    render();
  } catch (error) {
    reportError(error);
  }
}
document.addEventListener('DOMContentLoaded', async () => {
  $('urlInput').value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  updateOutput(await window.clipMaker.getOutputFolder());
  await loadProjects();
  state.currentProjectId = state.projects[0]?.id || null;
  updateProjectNameState();
  $('newProjectBtn').addEventListener('click', startNewProject);
  $('projectName').addEventListener('input', () => {
    updateProjectNameState();
    clearTimeout(updateProjectNameState.timer);
    updateProjectNameState.timer = setTimeout(() => window.clipMaker.updateProjectName(state.projectName), 350);
  });
  $('findBtn').addEventListener('click', findVideos);
  $('downloadBtn').addEventListener('click', downloadSelected);
  $('clipsBtn').addEventListener('click', createClips);
  $('changeOutputBtn').addEventListener('click', chooseOutput);
  $('deleteProjectBtn').addEventListener('click', deleteProject);
  $('viewLogBtn').addEventListener('click', () => window.clipMaker.showLogWindow());
  $('dismissUpdateBtn').addEventListener('click', () => $('updateBanner').classList.add('hidden'));
  $('downloadUpdateBtn').addEventListener('click', downloadUpdate);
  $('openYoutubeBtn').addEventListener('click', () => {
    const video = selectedVideo();
    if (video) window.clipMaker.openYoutube(video.url);
  });
  $('creatorToolsLink').addEventListener('click', (event) => {
    event.preventDefault();
    window.clipMaker.openYoutube('http://ytatools.co');
  });
  window.clipMaker.onMenuAction((action) => {
    if (action === 'new-project') startNewProject();
    if (action === 'change-output-folder') chooseOutput();
    if (action === 'view-log') window.clipMaker.showLogWindow();
    if (action === 'check-updates') checkForUpdates({ manual: true });
  });
  window.clipMaker.onLog((line) => console.log(line));
  window.clipMaker.onProgress((progress) => {
    if (!progress || progress.videoId !== state.selectedId) return;
    setProgress(progress);
  });
  render();
  checkForUpdates();
});
