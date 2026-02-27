const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chooserAPI', {
  onSources: (callback) => {
    ipcRenderer.on('capture-sources', (event, payload) => {
      const sources = payload?.sources || payload || [];
      const processes = payload?.processes || [];
      callback(sources, processes);
    });
  },
  select: (sourceId, audioProcessId) => ipcRenderer.send('capture-source-selected', { sourceId, audioProcessId }),
  cancel: () => ipcRenderer.send('capture-source-canceled')
});
