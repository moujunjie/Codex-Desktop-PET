const { app, BrowserWindow, ipcMain, Menu, Notification, Tray, nativeImage, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const { DeviceBridge } = require("./device-bridge");
const { SettingsStore, mergeDeep } = require("./settings-store");
const { StatusBridge } = require("./status-bridge");

const rootDir = path.resolve(__dirname, "..");
const configPath = path.join(rootDir, "pet.config.json");

const defaultConfig = loadDefaultConfig();
const ICON_SCALE_MIN = 0.15;
const ICON_SCALE_MAX = 3;
let userSettings = {};
let config = defaultConfig;
let mainWindow = null;
let settingsWindow = null;
let statusBridge = null;
let deviceBridge = null;
let settingsStore = null;
let lastDeviceState = null;
let lastStatus = null;
let tray = null;
let isQuitting = false;
let latestScalePreviewSequence = 0;
let activeScalePreviewSession = null;
let dragSession = null;

function loadDefaultConfig() {
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw);
}

function initializeSettings() {
  settingsStore = new SettingsStore(app.getPath("userData"));
  const migration = migrateSettings(settingsStore.readLatest());
  userSettings = migration.settings;
  if (migration.changed) {
    settingsStore.append(userSettings);
  }
  config = mergeDeep(defaultConfig, userSettings);
  syncStartupSetting();
}

function migrateSettings(settings) {
  const migrated = mergeDeep({}, settings || {});
  let changed = false;

  if (!migrated.source || migrated.source.mode === "mock") {
    migrated.source = {
      ...(migrated.source || {}),
      mode: "codex-exec"
    };
    changed = true;
  }

  const currentScale = Number(migrated.window?.sizeScale);
  if (Number.isFinite(currentScale)) {
    const safeScale = clamp(currentScale, ICON_SCALE_MIN, ICON_SCALE_MAX);
    if (safeScale !== currentScale) {
      migrated.window = {
        ...(migrated.window || {}),
        sizeScale: safeScale
      };
      changed = true;
    }
  }

  return {
    settings: migrated,
    changed
  };
}

function resolveImageDataUrl(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return null;
  }

  const extension = path.extname(imagePath).toLowerCase();
  const mimeType =
    extension === ".png"
      ? "image/png"
      : extension === ".webp"
        ? "image/webp"
        : "image/jpeg";

  const base64 = fs.readFileSync(imagePath).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

function resolvePackagedSpriteDataUrl() {
  if (!app.isPackaged) {
    return null;
  }

  return resolveImageDataUrl(path.join(process.resourcesPath, "assets", "pixel-pet-spritesheet.png"));
}

function assetRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "assets") : path.join(rootDir, "assets");
}

function resolveStateAssetDataUrls(appearanceMode) {
  const folders = appearanceMode === "character" ? ["pet-states-clean", "pet-states"] : ["pet-cards-cutout-v2", "pet-cards"];
  const states = ["idle", "thinking", "acting", "waiting", "approval", "done", "error", "offline"];
  const urls = {};

  for (const state of states) {
    const fileState = state === "offline" ? "waiting" : state;
    // 透明状态牌优先使用新抠图版本；如果用户手动移走它，再回退到旧素材。
    for (const folder of folders) {
      const candidateNames = fileState === "approval" ? ["approval-flash.png", "approval.png"] : [`${fileState}.png`];
      let url = null;
      for (const candidateName of candidateNames) {
        url = resolveImageDataUrl(path.join(assetRoot(), folder, candidateName));
        if (url) {
          break;
        }
      }
      if (url) {
        urls[state] = url;
        break;
      }
    }
  }

  return urls;
}

function createWindow() {
  const windowConfig = config.window || {};
  const size = getMainWindowSize();

  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    show: false,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: windowConfig.alwaysOnTop !== false,
    skipTaskbar: true,
    title: "",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      backgroundThrottling: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setResizable(false);
  mainWindow.setTitle("");
  mainWindow.setBackgroundColor("#00000000");

  try {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (error) {
    console.warn("设置跨桌面显示失败：", error.message);
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.showInactive();
  });
  mainWindow.loadFile(path.join(rootDir, "src", "desktop.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
    rebuildTrayMenu();
  });
  applyDisplayModeToWindow();
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 380,
    minHeight: 500,
    title: "Codex Pixel Pet 设置",
    resizable: true,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      backgroundThrottling: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(rootDir, "src", "settings.html"));
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function broadcastStatus(state) {
  const previousStatus = lastStatus?.status;
  lastStatus = state;
  updateTrayForStatus(state);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pet:status", state);
  }

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("pet:status", state);
  }

  if (isDeviceDisplayMode()) {
    deviceBridge?.setState(state);
  }

  if (state?.status === "approval" && previousStatus !== "approval") {
    showApprovalNotification(state);
  }
}

function broadcastDeviceState(state) {
  lastDeviceState = state;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pet:device", state);
  }

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("pet:device", state);
  }
}

function restartBridge() {
  if (statusBridge) {
    statusBridge.stop();
  }

  statusBridge = new StatusBridge({
    rootDir,
    getConfig: () => config,
    onState: broadcastStatus
  });

  statusBridge.start();
}

function restartDeviceBridge() {
  if (deviceBridge) {
    deviceBridge.stop();
  }

  deviceBridge = new DeviceBridge({
    getConfig: () => config,
    onDeviceState: broadcastDeviceState
  });

  if (isDeviceDisplayMode()) {
    deviceBridge.start();
    if (statusBridge?.currentState) {
      deviceBridge.setState(statusBridge.currentState);
    }
  }
}

function isDeviceDisplayMode() {
  return config.display?.mode === "device";
}

function updateConfig(patch) {
  userSettings = mergeDeep(userSettings, patch);
  config = mergeDeep(defaultConfig, userSettings);
  settingsStore?.append(userSettings);
  broadcastConfig();
  rebuildTrayMenu();
  return config;
}

function applyDisplayModeToWindow() {
  applyMainWindowSize();
}

function applyMainWindowSize(scaleOverride) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const size = getMainWindowSize(scaleOverride);
  const [x, y] = mainWindow.getPosition();
  unlockMainWindowSize();
  // 禁用系统尺寸动画，避免快速拖动滑杆时旧动画把窗口又放大。
  mainWindow.setBounds(
    {
      x,
      y,
      width: size.width,
      height: size.height
    },
    false
  );
  lockMainWindowSize(size);
}

function lockMainWindowSize(size) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setResizable(false);
  mainWindow.setMinimumSize(size.width, size.height);
  mainWindow.setMaximumSize(size.width, size.height);
}

function unlockMainWindowSize() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setMinimumSize(1, 1);
  mainWindow.setMaximumSize(10000, 10000);
}

function getMainWindowSize(scaleOverride) {
  const windowConfig = config.window || {};
  const isCharacter = config.appearance?.mode === "character";
  const scale = clamp(Number(scaleOverride ?? windowConfig.sizeScale ?? 1), ICON_SCALE_MIN, ICON_SCALE_MAX);
  const baseWidth = isCharacter ? windowConfig.characterWidth || 170 : windowConfig.cardWidth || 236;
  const baseHeight = isCharacter ? windowConfig.characterHeight || 178 : windowConfig.cardHeight || 214;

  return {
    width: Math.round(baseWidth * scale),
    height: Math.round(baseHeight * scale)
  };
}

function createTray() {
  if (tray) {
    return;
  }

  tray = new Tray(resolveTrayImage("idle"));
  tray.setToolTip("Codex Pixel Pet");
  tray.on("double-click", createSettingsWindow);
  tray.on("click", toggleDesktopWindow);
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) {
    return;
  }

  const desktopVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  const statusLabel = lastStatus?.title || "待命中";
  const menu = Menu.buildFromTemplate([
    {
      label: `当前状态：${statusLabel}`,
      enabled: false
    },
    { type: "separator" },
    {
      label: "打开设置",
      click: createSettingsWindow
    },
    {
      label: desktopVisible ? "隐藏桌面图标" : "显示桌面图标",
      click: toggleDesktopWindow
    },
    { type: "separator" },
    {
      label: "退出软件",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
}

function toggleDesktopWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.showInactive();
  }

  rebuildTrayMenu();
}

function updateTrayForStatus(state) {
  if (!tray) {
    return;
  }

  const status = state?.status || "idle";
  tray.setImage(resolveTrayImage(status));
  tray.setToolTip("Codex Pixel Pet");
  rebuildTrayMenu();
}

function resolveTrayImage(status) {
  const trayDir = path.join(assetRoot(), "tray");
  const iconPath = path.join(trayDir, `${status}.png`);
  const fallbackPath = path.join(trayDir, "idle.png");
  const imagePath = fs.existsSync(iconPath) ? iconPath : fallbackPath;

  if (!fs.existsSync(imagePath)) {
    return nativeImage.createEmpty();
  }

  // Windows 托盘图标通常显示为 16px，这里用 16x16 让系统缩放更稳定。
  return nativeImage.createFromPath(imagePath).resize({
    width: 16,
    height: 16
  });
}

function showApprovalNotification(state) {
  if (!Notification.isSupported()) {
    return;
  }

  new Notification({
    title: "Codex 等待权限审批",
    body: state?.detail || "需要你确认权限后才能继续。"
  }).show();
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function broadcastConfig() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pet:config", config);
  }

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("pet:config", config);
  }
}

function syncStartupSetting() {
  app.setLoginItemSettings({
    openAtLogin: Boolean(config.startup?.openAtLogin),
    path: process.execPath
  });
}

ipcMain.handle("pet:get-config", async () => config);
ipcMain.handle("pet:load-photo", async () => resolveImageDataUrl(config.photoPath));
ipcMain.handle("pet:load-sprite-sheet", async () => {
  return resolvePackagedSpriteDataUrl() || resolveImageDataUrl(config.spriteSheetPath);
});
ipcMain.handle("pet:load-state-assets", async (_event, appearanceMode) => {
  return resolveStateAssetDataUrls(appearanceMode || config.appearance?.mode || "card");
});
ipcMain.handle("pet:get-current-status", async () => statusBridge?.currentState ?? null);
ipcMain.handle("pet:get-startup", async () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle("pet:open-settings", async () => {
  createSettingsWindow();
});
ipcMain.handle("pet:set-mode", async (_event, mode) => {
  const nextMode = mode === "json-file" ? "json-file" : "codex-exec";
  updateConfig({
    source: {
      mode: nextMode
    }
  });
  restartBridge();
  return config.source.mode;
});
ipcMain.handle("pet:set-appearance-mode", async (_event, mode) => {
  updateConfig({
    appearance: {
      mode
    }
  });
  applyDisplayModeToWindow();
  return config.appearance.mode;
});
ipcMain.handle("pet:set-icon-scale", async (_event, scale) => {
  updateConfig({
    window: {
      sizeScale: clamp(Number(scale), ICON_SCALE_MIN, ICON_SCALE_MAX)
    }
  });
  applyDisplayModeToWindow();
  return config.window.sizeScale;
});
ipcMain.on("pet:preview-icon-scale", (_event, payload) => {
  const sessionId = String(payload?.sessionId || "default");
  const sequence = Number(payload?.sequence || 0);
  if (sessionId !== activeScalePreviewSession) {
    activeScalePreviewSession = sessionId;
    latestScalePreviewSequence = 0;
  }

  if (sequence < latestScalePreviewSequence) {
    return null;
  }

  latestScalePreviewSequence = sequence;
  const nextScale = clamp(Number(payload?.scale), ICON_SCALE_MIN, ICON_SCALE_MAX);
  // 预览缩放只改窗口尺寸，不写入配置、不广播配置，避免拖动时旧请求覆盖新请求。
  applyMainWindowSize(nextScale);
});
ipcMain.handle("pet:set-display-mode", async (_event, mode) => {
  updateConfig({
    display: {
      mode
    }
  });
  applyDisplayModeToWindow();
  restartDeviceBridge();
  return config.display.mode;
});
ipcMain.handle("pet:set-device-endpoint", async (_event, endpoint) => {
  updateConfig({
    device: {
      endpoint
    }
  });
  restartDeviceBridge();
  return config.device.endpoint;
});
ipcMain.handle("pet:set-startup", async (_event, enabled) => {
  updateConfig({
    startup: {
      openAtLogin: Boolean(enabled)
    }
  });
  syncStartupSetting();
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle("pet:minimize", async () => {
  mainWindow?.minimize();
});
ipcMain.handle("pet:quit", async () => {
  isQuitting = true;
  app.quit();
});
ipcMain.on("pet:start-drag-window", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  stopMainWindowDrag();
  const cursor = screen.getCursorScreenPoint();
  const [windowX, windowY] = mainWindow.getPosition();
  const lockedSize = getMainWindowSize();
  lockMainWindowSize(lockedSize);

  dragSession = {
    cursor,
    windowX,
    windowY,
    lockedSize,
    timer: setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed() || !dragSession) {
        stopMainWindowDrag();
        return;
      }

      const currentCursor = screen.getCursorScreenPoint();
      mainWindow.setBounds(
        {
          x: Math.round(dragSession.windowX + currentCursor.x - dragSession.cursor.x),
          y: Math.round(dragSession.windowY + currentCursor.y - dragSession.cursor.y),
          width: dragSession.lockedSize.width,
          height: dragSession.lockedSize.height
        },
        false
      );
    }, 16)
  };
});
ipcMain.on("pet:stop-drag-window", () => {
  stopMainWindowDrag();
});

function stopMainWindowDrag() {
  if (dragSession?.timer) {
    clearInterval(dragSession.timer);
  }

  dragSession = null;
}
ipcMain.on("pet:renderer-ready", () => {
  broadcastConfig();
  if (statusBridge?.currentState) {
    broadcastStatus(statusBridge.currentState);
  }
  if (lastDeviceState) {
    broadcastDeviceState(lastDeviceState);
  }
});

app.whenReady().then(() => {
  app.setAppUserModelId("local.codex.pixelpet");
  initializeSettings();
  createWindow();
  createTray();
  restartBridge();
  restartDeviceBridge();
});

app.on("window-all-closed", () => {
  if (isQuitting || !tray) {
    app.quit();
  }
});
