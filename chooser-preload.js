const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chooserAPI', {
  onSources: (callback) => {
    ipcRenderer.on('capture-sources', (event, sources) => callback(sources));
  },
  select: (id) => ipcRenderer.send('capture-source-selected', id),
  cancel: () => ipcRenderer.send('capture-source-canceled')
});
