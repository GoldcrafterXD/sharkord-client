const { app, BrowserWindow, ipcMain, dialog, Menu, globalShortcut, nativeImage, desktopCapturer, session } = require('electron');
const path = require('path');

let mainWindow;

app.on('ready', createWindow);

function createWindow() {
  const appIcon = getAppIcon();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false
    }
    
  });

  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], fetchWindowIcons: true });

        if (!sources || sources.length === 0) {
          console.warn('No capture sources available');
          return callback();
        }

        // Prepare serializable sources (send dataURL thumbnails to renderer)
        const serializable = sources.map(s => ({
          id: s.id,
          name: s.name || s.id,
          thumbnailDataUrl: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null
        }));

        // Create a modal chooser BrowserWindow that shows thumbnails
        const chooser = new BrowserWindow({
          parent: mainWindow,
          modal: true,
          show: false,
          width: 900,
          height: 600,
          resizable: false,
          webPreferences: {
            preload: path.join(__dirname, 'chooser-preload.js'),
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false
          }
        });

        // Clean up listeners if chooser closed without selection
        let handled = false;

        const selectionHandler = (event, selectedId) => {
          try {
            handled = true;
            const selected = sources.find(s => s.id === selectedId);
            if (!selected) {
              console.warn('Selected source not found:', selectedId);
              callback();
            } else {
              callback({ video: selected, audio: 'loopback' });
            }
          } catch (err) {
            console.error('Error forwarding selected source', err);
            callback();
          } finally {
            if (!chooser.isDestroyed()) chooser.close();
          }
        };

        const cancelHandler = () => {
          handled = true;
          callback();
          if (!chooser.isDestroyed()) chooser.close();
        };

        ipcMain.once('capture-source-selected', selectionHandler);
        ipcMain.once('capture-source-canceled', cancelHandler);

        chooser.loadFile(path.join(__dirname, 'capture-chooser.html'))
          .then(() => {
            chooser.webContents.send('capture-sources', serializable);
            chooser.show();
          })
          .catch(err => {
            console.error('Failed to load chooser UI', err);
            ipcMain.removeListener('capture-source-selected', selectionHandler);
            ipcMain.removeListener('capture-source-canceled', cancelHandler);
            callback();
          });

        chooser.on('closed', () => {
          // If the window closed without selection, ensure request is cancelled
          if (!handled) callback();
          ipcMain.removeListener('capture-source-selected', selectionHandler);
          ipcMain.removeListener('capture-source-canceled', cancelHandler);
        });
      } catch (err) {
        console.error('Error handling display media request', err);
        callback();
      }
    },
    { useSystemPicker: false }
  );

  // Remove default application menu (hides the top "File/Edit/View/Window" menu)
  Menu.setApplicationMenu(null);
  // Load your Sharkord instance (local or remote)
  mainWindow.loadURL(`file://${__dirname}/index.html`); // Change to your Sharkord URL
  
  // Open DevTools in development
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.platform === 'darwin' && appIcon && app.dock) {
    try {
      app.dock.setIcon(appIcon);
    } catch (err) {
      console.error('Failed to set dock icon', err);
    }
  }

  // Setup drag & drop handler
  setupDragDrop();
  // Setup global shortcut handlers (renderer can register/unregister shortcuts)
  setupGlobalShortcuts();
}

function getAppIcon() {
  try {
    if (process.platform === 'win32') {
      return nativeImage.createFromPath(path.join(__dirname, 'build', 'icons', 'win', 'icon.ico'));
    }
    if (process.platform === 'darwin') {
      return nativeImage.createFromPath(path.join(__dirname, 'build', 'icons', 'mac', 'icon.icns'));
    }
    // linux and fallback
    return nativeImage.createFromPath(path.join(__dirname, 'build', 'icons', 'png', 'icon.png'));
  } catch (err) {
    console.error('Error loading app icon', err);
    return null;
  }
}

// Ensure global shortcuts are unregistered when the app quits
app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll();
  } catch (err) {
    console.error('Error unregistering global shortcuts on quit', err);
  }
});

function setupDragDrop() {
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Handle custom keyboard shortcuts if needed
    if (input.control && input.key.toLowerCase() === 'q') {
      app.quit();
    }
  });

  // Handle IPC events from renderer
  ipcMain.on('drop-files', async (event, files) => {
    console.log('Files dropped:', files);
    // Process files here
  });

  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections']
    });
    return result.filePaths;
  });
}

function setupGlobalShortcuts() {
  // Register/unregister shortcuts on demand from the renderer process.
  // Renderer should call `ipcRenderer.invoke('register-global-shortcut', accelerator, keyEvent)`
  // where `keyEvent` is optional and can be { key: 'a', keyCode: 'a', modifiers: ['control'] }.
  ipcMain.handle('register-global-shortcut', (event, accelerator, keyEvent) => {
    try {
      const registered = globalShortcut.register(accelerator, () => {
        if (!mainWindow || !mainWindow.webContents) return;
        const down = { type: 'keyDown', keyCode: keyEvent?.key || keyEvent?.keyCode || accelerator };
        const up = { type: 'keyUp', keyCode: keyEvent?.key || keyEvent?.keyCode || accelerator };
        if (keyEvent?.modifiers) {
          down.modifiers = keyEvent.modifiers;
          up.modifiers = keyEvent.modifiers;
        }
        mainWindow.webContents.sendInputEvent(down);
        mainWindow.webContents.sendInputEvent(up);
      });
      return registered;
    } catch (err) {
      console.error('register-global-shortcut error', err);
      return false;
    }
  });

  ipcMain.handle('unregister-global-shortcut', (event, accelerator) => {
    try {
      globalShortcut.unregister(accelerator);
      return true;
    } catch (err) {
      console.error('unregister-global-shortcut error', err);
      return false;
    }
  });

  ipcMain.handle('unregister-all-global-shortcuts', () => {
    try {
      globalShortcut.unregisterAll();
      return true;
    } catch (err) {
      console.error('unregister-all-global-shortcuts error', err);
      return false;
    }
  });

  // Auto-register the specific hotkeys requested: Ctrl+Shift+M and Ctrl+Shift+D
  try {
    const registerAndForward = (accelerators, key) => {
      if (!Array.isArray(accelerators)) accelerators = [accelerators];
      console.log('Attempting to register global shortcut variants:', accelerators.join(' | '));

      // debounce map to avoid repeated triggers while key is held
      const lastTriggered = new Map();
      const minInterval = 300; // ms

      let registeredAccel = null;
      for (const accel of accelerators) {
        try {
          if (globalShortcut.isRegistered(accel)) {
            console.log('Already registered by another process or earlier:', accel);
            registeredAccel = accel;
            break;
          }
          const ok = globalShortcut.register(accel, () => {
            try {
              const now = Date.now();
              const last = lastTriggered.get(accel) || 0;
              if (now - last < minInterval) return; // ignore repeats
              lastTriggered.set(accel, now);

              if (!mainWindow || !mainWindow.webContents) return;
              const upDownKey = (typeof key === 'string' ? key : String(key)).toUpperCase();
              const down = {
                type: 'keyDown',
                key: upDownKey,
                keyCode: upDownKey,
                modifiers: ['control']
              };
              const up = {
                type: 'keyUp',
                key: upDownKey,
                keyCode: upDownKey,
                modifiers: ['control']
              };
              mainWindow.webContents.sendInputEvent(down);
              mainWindow.webContents.sendInputEvent(up);
            } catch (err) {
              console.error('Error forwarding shortcut', accel, err);
            }
          });
          console.log('Tried registering', accel, 'result:', ok);
          if (ok) { registeredAccel = accel; break; }
        } catch (err) {
          console.error('Failed to register variant', accel, err);
        }
      }

      if (!registeredAccel) console.warn('Failed to register any variant for', accelerators.join(', '));
      else console.log('Registered accelerator:', registeredAccel);
    };

    // Try multiple accelerator variants for M (some systems/apps capture certain variants).
    // Add Alt/Alt+Ctrl fallbacks in case Ctrl+Shift+M is reserved by the OS or another app.
    registerAndForward([
      'Control+M',
      'Ctrl+M',
      'CommandOrControl+M'
    ], 'M');
    registerAndForward(['Control+D', 'Ctrl+D', 'CommandOrControl+D'], 'D');
  } catch (err) {
    console.error('Error auto-registering hotkeys', err);
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});