const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petAPI", {
  getConfig: () => ipcRenderer.invoke("pet:get-config"),
  loadPhotoDataUrl: () => ipcRenderer.invoke("pet:load-photo"),
  loadSpriteSheetDataUrl: () => ipcRenderer.invoke("pet:load-sprite-sheet"),
  loadStateAssets: (appearanceMode) => ipcRenderer.invoke("pet:load-state-assets", appearanceMode),
  getCurrentStatus: () => ipcRenderer.invoke("pet:get-current-status"),
  getStartup: () => ipcRenderer.invoke("pet:get-startup"),
  openSettings: () => ipcRenderer.invoke("pet:open-settings"),
  setMode: (mode) => ipcRenderer.invoke("pet:set-mode", mode),
  setAppearanceMode: (mode) => ipcRenderer.invoke("pet:set-appearance-mode", mode),
  setIconScale: (scale) => ipcRenderer.invoke("pet:set-icon-scale", scale),
  setDisplayMode: (mode) => ipcRenderer.invoke("pet:set-display-mode", mode),
  setAutoHideFullscreen: (enabled) => ipcRenderer.invoke("pet:set-auto-hide-fullscreen", enabled),
  setDeviceEndpoint: (endpoint) => ipcRenderer.invoke("pet:set-device-endpoint", endpoint),
  setStartup: (enabled) => ipcRenderer.invoke("pet:set-startup", enabled),
  minimize: () => ipcRenderer.invoke("pet:minimize"),
  quit: () => ipcRenderer.invoke("pet:quit"),
  previewIconScale: (payload) => ipcRenderer.send("pet:preview-icon-scale", payload),
  startDragWindow: () => ipcRenderer.send("pet:start-drag-window"),
  stopDragWindow: () => ipcRenderer.send("pet:stop-drag-window"),
  ready: () => ipcRenderer.send("pet:renderer-ready"),
  onStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("pet:status", handler);
    return () => ipcRenderer.removeListener("pet:status", handler);
  },
  onDevice: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("pet:device", handler);
    return () => ipcRenderer.removeListener("pet:device", handler);
  },
  onConfig: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("pet:config", handler);
    return () => ipcRenderer.removeListener("pet:config", handler);
  }
});
