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
  getCachedHotkeys: () => ipcRenderer.invoke('get-cached-hotkeys'),

  // Toggle loopback screen-share audio from renderer if needed
  enableLoopbackScreenAudio: () => window.postMessage({ source: 'sharkord-electron', type: 'sharkord:set-loopback-audio', enabled: true }, '*'),
  disableLoopbackScreenAudio: () => window.postMessage({ source: 'sharkord-electron', type: 'sharkord:set-loopback-audio', enabled: false }, '*')
});

function injectLoopbackScreenAudioPatch() {
  try {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.textContent = `(() => {
      if (!navigator || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.MediaStreamTrackGenerator || !window.AudioData) return;

      const SAMPLE_RATE = 48000;
      const CHANNELS = 2;
      const BYTES_PER_SAMPLE = 2; // s16le

      const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      let loopbackState = {
        enabled: true,
        generator: null,
        writer: null,
        timestamp: 0
      };

      const ensureGenerator = () => {
        if (loopbackState.generator && loopbackState.writer && loopbackState.generator.readyState === 'live') {
          return loopbackState.generator;
        }

        stopGenerator();
        loopbackState.generator = new MediaStreamTrackGenerator({ kind: 'audio' });
        loopbackState.writer = loopbackState.generator.writable.getWriter();
        loopbackState.timestamp = 0;

        loopbackState.generator.addEventListener('ended', () => {
          stopGenerator();
        }, { once: true });

        return loopbackState.generator;
      };

      const stopGenerator = () => {
        try { loopbackState.writer?.close(); } catch (e) { }
        try { loopbackState.generator?.stop?.(); } catch (e) { }
        loopbackState.generator = null;
        loopbackState.writer = null;
        loopbackState.timestamp = 0;
      };

      navigator.mediaDevices.getDisplayMedia = async (constraints = {}) => {
        const useCustomAudio = loopbackState.enabled === true;
        const baseConstraints = (constraints && typeof constraints === 'object') ? constraints : {};
        const adjustedConstraints = useCustomAudio ? { ...baseConstraints, audio: false } : baseConstraints;

        const stream = await originalGetDisplayMedia(adjustedConstraints);

        if (!useCustomAudio) return stream;

        const gen = ensureGenerator();
        if (!gen || gen.readyState !== 'live') return stream;

        const existingAudio = stream.getAudioTracks();
        for (const track of existingAudio) {
          try { stream.removeTrack(track); track.stop(); } catch (e) { }
        }

        stream.addTrack(gen);
        return stream;
      };

      const writePcmChunk = (uint8) => {
        if (!loopbackState.enabled) return;
        const gen = ensureGenerator();
        const writer = loopbackState.writer;
        if (!gen || !writer) return;

        const frames = Math.floor(uint8.byteLength / (CHANNELS * BYTES_PER_SAMPLE));
        if (frames <= 0) return;

        const audioData = new AudioData({
          format: 's16',
          sampleRate: SAMPLE_RATE,
          numberOfFrames: frames,
          numberOfChannels: CHANNELS,
          timestamp: loopbackState.timestamp,
          data: uint8
        });

        loopbackState.timestamp += (frames / SAMPLE_RATE) * 1_000_000; // microseconds

        writer.write(audioData).catch(() => {
          // If the writer is closed, reset state so we recreate on next chunk
          stopGenerator();
        });
      };

      window.addEventListener('message', (event) => {
        const data = event && event.data;
        if (!data || data.source !== 'sharkord-electron') return;

        if (data.type === 'sharkord:set-loopback-audio') {
          loopbackState.enabled = !!data.enabled;
          if (!loopbackState.enabled) stopGenerator();
          return;
        }

        if (data.type === 'sharkord:loopback-chunk' && data.payload instanceof Uint8Array) {
          writePcmChunk(data.payload);
        }
      });

      // Expose a simple hook so page scripts can route the chunks without re-checking source
      window.__sharkordHandleLoopbackChunk = (payload) => {
        if (payload && payload instanceof Uint8Array) writePcmChunk(payload);
      };

      window.sharkordLoopbackScreenAudio = {
        enable() { loopbackState.enabled = true; },
        disable() { loopbackState.enabled = false; stopGenerator(); },
        isEnabled() { return loopbackState.enabled; }
      };
    })();`;

    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch (err) {
    console.error('Failed to inject test screen audio patch', err);
  }
}

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
    injectLoopbackScreenAudioPatch();
  }, { once: true });
} else {
  injectPermanentSettingsButton();
  applySavedHotkeysFromStorage();
  injectLoopbackScreenAudioPatch();
}

// Forward loopback PCM chunks from main -> preload -> page
ipcRenderer.on('app-audio-chunk', (_event, chunk) => {
  try {
    if (chunk instanceof Uint8Array) {
      window.postMessage({ source: 'sharkord-electron', type: 'sharkord:loopback-chunk', payload: chunk }, '*');
    } else if (chunk?.data) {
      // In case Buffer is serialized differently
      window.postMessage({ source: 'sharkord-electron', type: 'sharkord:loopback-chunk', payload: new Uint8Array(chunk.data) }, '*');
    }
  } catch (err) {
    console.error('Failed to forward loopback chunk', err);
  }
});