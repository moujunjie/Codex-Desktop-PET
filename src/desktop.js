const STATUS_CLASS_PREFIX = "state-";
const FALLBACK_STATUS = {
  status: "idle",
  title: "待命中",
  detail: "等待 Codex 状态更新。"
};

const state = {
  config: null,
  assets: {},
  currentStatus: FALLBACK_STATUS
};

const pet = document.getElementById("pet");
const petImage = document.getElementById("petImage");

async function initDesktopPet() {
  state.config = await window.petAPI.getConfig();
  await loadAssets();
  bindDesktopGestures();
  bindPetEvents();

  const currentStatus = await window.petAPI.getCurrentStatus();
  renderStatus(currentStatus || FALLBACK_STATUS);
  window.petAPI.ready();
}

function bindDesktopGestures() {
  document.addEventListener("dblclick", () => {
    window.petAPI.openSettings();
  });

  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    window.petAPI.openSettings();
  });
}

function bindPetEvents() {
  window.petAPI.onStatus((payload) => {
    renderStatus(payload || FALLBACK_STATUS);
  });

  window.petAPI.onConfig(async (nextConfig) => {
    const previousMode = state.config?.appearance?.mode;
    state.config = nextConfig;
    if (previousMode !== nextConfig?.appearance?.mode) {
      await loadAssets();
    }
    renderStatus(state.currentStatus);
  });
}

async function loadAssets() {
  const appearanceMode = state.config?.appearance?.mode || "card";
  state.assets = await window.petAPI.loadStateAssets(appearanceMode);
}

function renderStatus(nextStatus) {
  const normalized = normalizeStatus(nextStatus);
  state.currentStatus = normalized;
  pet.className = `pet ${STATUS_CLASS_PREFIX}${normalized.status}`;
  petImage.src = resolveAsset(normalized.status);
  petImage.alt = "";
  pet.removeAttribute("title");
  document.title = "";
}

function normalizeStatus(payload) {
  const status = payload?.status || "idle";
  return {
    ...FALLBACK_STATUS,
    ...payload,
    status: state.assets[status] ? status : "idle"
  };
}

function resolveAsset(status) {
  return state.assets[status] || state.assets.idle || "";
}

initDesktopPet().catch((error) => {
  console.error("桌面宠物启动失败：", error);
});
