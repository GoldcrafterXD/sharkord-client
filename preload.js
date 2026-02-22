const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Send dropped files to main process
  onFileDrop: (callback) => {
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const files = Array.from(e.dataTransfer.files).map(file => ({
        name: file.name,
        path: file.path,
        size: file.size,
        type: file.type
      }));
      
      callback(files);
      ipcRenderer.send('drop-files', files);
    });

    // Prevent default drag behavior
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  },

  // Open file dialog
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  // Get app version
  getAppVersion: () => ipcRenderer.invoke('get-app-version')
});