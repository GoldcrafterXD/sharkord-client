const { contextBridge, ipcRenderer } = require('electron');

const HOTKEY_STORAGE_KEYS = {
  mute: 'sharkord_hotkey_mute',
  deafen: 'sharkord_hotkey_deafen'
};

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
  unregisterAllGlobalShortcuts: () => ipcRenderer.invoke('unregister-all-global-shortcuts'),
  persistHotkeys: (mute, deafen) => ipcRenderer.invoke('persist-hotkeys', { mute, deafen }),
  getCachedHotkeys: () => ipcRenderer.invoke('get-cached-hotkeys')
});

async function applySavedHotkeysFromStorage() {
  try {
    let mute = localStorage.getItem(HOTKEY_STORAGE_KEYS.mute) || '';
    let deafen = localStorage.getItem(HOTKEY_STORAGE_KEYS.deafen) || '';

    // If localStorage is empty in this window, try the cached values from main.
    if (!mute && !deafen && window.electronAPI?.getCachedHotkeys) {
      const cached = await window.electronAPI.getCachedHotkeys();
      mute = cached?.mute || '';
      deafen = cached?.deafen || '';
      if (mute || deafen) {
        try {
          if (mute) localStorage.setItem(HOTKEY_STORAGE_KEYS.mute, mute);
          if (deafen) localStorage.setItem(HOTKEY_STORAGE_KEYS.deafen, deafen);
        } catch (e) { /* ignore */ }
      }
    }

    // Disk-backed cache is exposed via getCachedHotkeys; no further fallback needed.

    // Clear any existing registrations before applying user choices.
    await ipcRenderer.invoke('unregister-all-global-shortcuts');

    let success = true;
    if (mute) {
      success = await ipcRenderer.invoke('register-global-shortcut', mute, { key: 'm', keyCode: 'M', modifiers: ['control'] });
    }
    if (deafen && success) {
      success = await ipcRenderer.invoke('register-global-shortcut', deafen, { key: 'd', keyCode: 'D', modifiers: ['control'] }) && success;
    }

    if (!success) {
      console.warn('One or more saved hotkeys failed to register.');
    }
  } catch (err) {
    console.error('Failed to apply saved hotkeys from storage', err);
  }
}

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
  document.addEventListener('DOMContentLoaded', () => {
    injectPermanentSettingsButton();
    applySavedHotkeysFromStorage();
  }, { once: true });
} else {
  injectPermanentSettingsButton();
  applySavedHotkeysFromStorage();
}