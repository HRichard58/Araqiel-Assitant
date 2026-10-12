const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('araqielWindow', {
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close')
});

contextBridge.exposeInMainWorld('araqielSystem', {
  createFolder: (folderPath) => ipcRenderer.invoke('create-folder', folderPath),
  createFile: (filePath, content) => ipcRenderer.invoke('create-file', filePath, content),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  chooseFilePath: (suggestedName) => ipcRenderer.invoke('choose-file-path', suggestedName),
  onMobileMessage: (callback) => ipcRenderer.on('mobile-message', (event, payload) => callback(payload)),
  replyToMobile: (text, phoneId) => ipcRenderer.send('reply-to-mobile', { text, phoneId }),
  getMobileConnectInfo: () => ipcRenderer.invoke('get-mobile-connect-info'),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  getAccessPin: () => ipcRenderer.invoke('get-access-pin'),
  regenerateAccessPin: () => ipcRenderer.invoke('regenerate-access-pin'),
  startRemoteAccess: () => ipcRenderer.invoke('start-remote-access'),
  stopRemoteAccess: () => ipcRenderer.invoke('stop-remote-access'),
  getRemoteAccessStatus: () => ipcRenderer.invoke('get-remote-access-status'),
  onRemoteAccessStatus: (callback) => ipcRenderer.on('remote-access-status', (event, payload) => callback(payload))
});