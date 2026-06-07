const STATUS_META = {
  idle: { color: "#4c9a68", badge: "IDLE" },
  thinking: { color: "#3b8eb8", badge: "THINK" },
  acting: { color: "#d97b35", badge: "WORK" },
  waiting: { color: "#d99b30", badge: "WAIT" },
  approval: { color: "#e84638", badge: "ALLOW" },
  done: { color: "#4c9a68", badge: "DONE" },
  error: { color: "#c85d3f", badge: "ERR" },
  offline: { color: "#77736c", badge: "OFF" }
};

const ICON_SCALE_MIN = 0.15;
const ICON_SCALE_MAX = 3;
const iconScalePreviewSession = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let lastCommittedIconScale = null;

const elements = {
  statusBadge: document.getElementById("statusBadge"),
  statusTitle: document.getElementById("statusTitle"),
  statusDetail: document.getElementById("statusDetail"),
  statusDot: document.getElementById("statusDot"),
  deviceEndpoint: document.getElementById("deviceEndpoint"),
  saveDevice: document.getElementById("saveDevice"),
  deviceState: document.getElementById("deviceState"),
  iconScale: document.getElementById("iconScale"),
  iconScaleValue: document.getElementById("iconScaleValue"),
  startupToggle: document.getElementById("startupToggle"),
  minimizeApp: document.getElementById("minimizeApp"),
  quitApp: document.getElementById("quitApp")
};

async function initSettings() {
  const config = await window.petAPI.getConfig();
  renderConfig(config);
  renderStartup(await window.petAPI.getStartup());
  bindForm();

  const currentStatus = await window.petAPI.getCurrentStatus();
  renderStatus(currentStatus);

  window.petAPI.onConfig(renderConfig);
  window.petAPI.onStatus(renderStatus);
  window.petAPI.onDevice(renderDeviceState);
  window.petAPI.ready();
}

function bindForm() {
  bindRadioGroup("displayMode", async (mode) => {
    await window.petAPI.setDisplayMode(mode);
  });

  bindRadioGroup("appearanceMode", async (mode) => {
    await window.petAPI.setAppearanceMode(mode);
  });

  bindRadioGroup("sourceMode", async (mode) => {
    await window.petAPI.setMode(mode);
  });

  elements.saveDevice.addEventListener("click", async () => {
    const endpoint = elements.deviceEndpoint.value.trim();
    await window.petAPI.setDeviceEndpoint(endpoint);
    elements.deviceState.textContent = "屏幕地址已保存。";
  });

  elements.iconScale.addEventListener("input", () => {
    const scale = Number(elements.iconScale.value);
    renderIconScale(scale);
    previewIconScale(scale);
  });

  elements.iconScale.addEventListener("change", async () => {
    await commitIconScale();
  });

  elements.iconScale.addEventListener("pointerup", async () => {
    await commitIconScale();
  });

  elements.startupToggle.addEventListener("change", async () => {
    const enabled = await window.petAPI.setStartup(elements.startupToggle.checked);
    renderStartup(enabled);
  });

  elements.minimizeApp.addEventListener("click", () => {
    window.petAPI.minimize();
  });

  elements.quitApp.addEventListener("click", () => {
    window.petAPI.quit();
  });
}

function bindRadioGroup(name, callback) {
  for (const input of document.querySelectorAll(`input[name="${name}"]`)) {
    input.addEventListener("change", () => {
      if (input.checked) {
        callback(input.value);
      }
    });
  }
}

function renderConfig(config) {
  setRadioValue("displayMode", config?.display?.mode || "desktop");
  setRadioValue("appearanceMode", config?.appearance?.mode || "card");
  setRadioValue("sourceMode", config?.source?.mode || "codex-exec");
  elements.deviceEndpoint.value = config?.device?.endpoint || "";
  const iconScale = config?.window?.sizeScale || 1;
  renderIconScale(iconScale);
  lastCommittedIconScale = clamp(Number(iconScale), ICON_SCALE_MIN, ICON_SCALE_MAX);
}

function renderStartup(enabled) {
  elements.startupToggle.checked = Boolean(enabled);
}

function renderStatus(payload) {
  const status = payload?.status || "idle";
  const meta = STATUS_META[status] || STATUS_META.idle;
  elements.statusBadge.textContent = payload?.badge || meta.badge;
  elements.statusTitle.textContent = payload?.title || "待命中";
  elements.statusDetail.textContent = payload?.detail || "正在等待状态源。";
  elements.statusDot.style.background = meta.color;
  elements.statusDot.style.boxShadow = `0 0 0 5px ${hexToRgba(meta.color, 0.16)}`;
}

function renderDeviceState(payload) {
  if (!payload) {
    return;
  }

  const time = new Date(payload.updatedAt || Date.now()).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  elements.deviceState.textContent = `${time} · ${payload.message || "摆件状态已更新"}`;
}

function setRadioValue(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) {
    input.checked = true;
  }
}

function renderIconScale(scale) {
  const normalized = clamp(Number(scale || 1), ICON_SCALE_MIN, ICON_SCALE_MAX);
  elements.iconScale.value = normalized;
  elements.iconScaleValue.textContent = `${Math.round(normalized * 100)}%`;
}

function previewIconScale(scale) {
  previewIconScale.sequence += 1;
  if (previewIconScale.frameRequested) {
    previewIconScale.pendingScale = scale;
    previewIconScale.pendingSequence = previewIconScale.sequence;
    return;
  }

  previewIconScale.pendingScale = scale;
  previewIconScale.pendingSequence = previewIconScale.sequence;
  previewIconScale.frameRequested = true;
  requestAnimationFrame(() => {
    previewIconScale.frameRequested = false;
    window.petAPI.previewIconScale({
      scale: previewIconScale.pendingScale,
      sequence: previewIconScale.pendingSequence,
      sessionId: iconScalePreviewSession
    });
  });
}

previewIconScale.frameRequested = false;
previewIconScale.pendingScale = 1;
previewIconScale.pendingSequence = 0;
previewIconScale.sequence = 0;

async function commitIconScale() {
  const targetScale = clamp(Number(elements.iconScale.value), ICON_SCALE_MIN, ICON_SCALE_MAX);
  if (targetScale === lastCommittedIconScale) {
    return;
  }

  lastCommittedIconScale = targetScale;
  const scale = await window.petAPI.setIconScale(targetScale);
  renderIconScale(scale);
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

initSettings().catch((error) => {
  console.error("设置窗口启动失败：", error);
});
