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
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Open settings window
  openSettings: () => ipcRenderer.invoke('open-settings-window'),

  // Global shortcut APIs
  registerGlobalShortcut: (accelerator, keyEvent) => ipcRenderer.invoke('register-global-shortcut', accelerator, keyEvent),
  unregisterGlobalShortcut: (accelerator) => ipcRenderer.invoke('unregister-global-shortcut', accelerator),
  unregisterAllGlobalShortcuts: () => ipcRenderer.invoke('unregister-all-global-shortcuts')
});

function injectPermanentSettingsButton() {
  try {
    const existing = document.getElementById('sharkord-settings-fab');
    if (existing) return;

    const button = document.createElement('sharkord-client-settings-button');
    button.id = 'sharkord-settings-fab';
    button.type = 'button';
    button.textContent = '⚙ Settings';
    button.setAttribute('aria-label', 'Open settings');

    Object.assign(button.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(17,18,20,0.94)',
      color: '#e6eef6',
      fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial",
      fontSize: '13px',
      padding: '8px 12px',
      cursor: 'pointer',
      boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
      backdropFilter: 'blur(4px)'
    });

    button.addEventListener('mouseenter', () => {
      button.style.borderColor = 'rgba(47,155,255,0.45)';
      button.style.background = 'rgba(23,23,23,0.98)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.borderColor = 'rgba(255,255,255,0.08)';
      button.style.background = 'rgba(17,18,20,0.94)';
    });

    button.addEventListener('click', async () => {
      try {
        await ipcRenderer.invoke('open-settings-window');
      } catch (err) {
        console.error('Failed to open settings window', err);
      }
    });

    document.body.appendChild(button);
  } catch (err) {
    console.error('Failed to inject permanent settings button', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectPermanentSettingsButton, { once: true });
} else {
  injectPermanentSettingsButton();
}