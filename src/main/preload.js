const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipMaker', {
  findVideos: (text, projectName) => ipcRenderer.invoke('find-videos', text, projectName),
  downloadVideo: (videoId, projectName) => ipcRenderer.invoke('download-video', videoId, projectName),
  createClips: (videoId, options) => ipcRenderer.invoke('create-clips', videoId, options),
  updateProjectName: (projectName) => ipcRenderer.invoke('update-project-name', projectName),
  openYoutube: (url) => ipcRenderer.invoke('open-youtube', url),
  chooseOutputFolder: () => ipcRenderer.invoke('choose-output-folder'),
  getRecentProjects: () => ipcRenderer.invoke('get-recent-projects'),
  newProject: () => ipcRenderer.invoke('new-project'),
  deleteProject: () => ipcRenderer.invoke('delete-project'),
  openProject: (projectId) => ipcRenderer.invoke('open-project', projectId),
  getOutputFolder: () => ipcRenderer.invoke('get-output-folder'),
  openOutputFolder: () => ipcRenderer.invoke('open-output-folder'),
  showLogWindow: () => ipcRenderer.invoke('show-log-window'),
  getLog: () => ipcRenderer.invoke('get-log'),
  clearLog: () => ipcRenderer.invoke('clear-log'),
  hideLogWindow: () => ipcRenderer.invoke('hide-log-window'),
  diagnostics: () => ipcRenderer.invoke('diagnostics'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  openUpdateDownload: (url) => ipcRenderer.invoke('open-update-download', url),
  onLog: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on('log', listener);
    return () => ipcRenderer.removeListener('log', listener);
  },
  onLogCleared: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('log-cleared', listener);
    return () => ipcRenderer.removeListener('log-cleared', listener);
  },
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('progress', listener);
    return () => ipcRenderer.removeListener('progress', listener);
  },
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu-action', listener);
    return () => ipcRenderer.removeListener('menu-action', listener);
  }
});
