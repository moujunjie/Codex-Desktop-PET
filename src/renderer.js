const STATUS_META = {
  idle: {
    bubbleIcon: "Zz",
    pill: "待命",
    accentLabel: "IDLE",
    symbol: "○"
  },
  thinking: {
    bubbleIcon: "...",
    pill: "思考中",
    accentLabel: "THINK",
    symbol: "○"
  },
  acting: {
    bubbleIcon: "GO",
    pill: "执行中",
    accentLabel: "TOOL",
    symbol: "○"
  },
  waiting: {
    bubbleIcon: "?!",
    pill: "等你确认",
    accentLabel: "WAIT",
    symbol: "?"
  },
  done: {
    bubbleIcon: "OK",
    pill: "已完成",
    accentLabel: "DONE",
    symbol: "✓"
  },
  error: {
    bubbleIcon: "!!",
    pill: "异常",
    accentLabel: "ERR",
    symbol: "!"
  },
  offline: {
    bubbleIcon: "--",
    pill: "离线",
    accentLabel: "OFF",
    symbol: "Z"
  }
};

const SPRITE_FRAMES = {
  idle: { column: 0, row: 0 },
  thinking: { column: 1, row: 0 },
  acting: { column: 2, row: 0 },
  waiting: { column: 0, row: 1 },
  done: { column: 1, row: 1 },
  error: { column: 2, row: 1 },
  offline: { column: 0, row: 1 }
};

const state = {
  config: null,
  current: {
    status: "idle",
    title: "待命中",
    detail: "等待状态源连接。",
    badge: "IDLE",
    sourceLabel: "本地状态桥接",
    updatedAt: Date.now(),
    turnStartedAt: null
  },
  renderedCanvas: null,
  spriteSheet: null,
  animationTimer: null,
  clockTimer: null
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindControls();
  initializeApp();
});

async function initializeApp() {
  state.config = await window.petAPI.getConfig();
  document.body.classList.toggle("display-device", state.config.display?.mode === "device");

  try {
    const spriteSheetDataUrl = await window.petAPI.loadSpriteSheetDataUrl();
    if (spriteSheetDataUrl) {
      state.spriteSheet = await loadImage(spriteSheetDataUrl);
    } else {
      const photoDataUrl = await window.petAPI.loadPhotoDataUrl();
      if (photoDataUrl) {
        const image = await loadImage(photoDataUrl);
        state.renderedCanvas = buildPixelPortrait(image, state.config.pixelation || {});
      } else {
        state.renderedCanvas = buildFallbackPortrait();
      }
    }
  } catch (error) {
    state.renderedCanvas = buildFallbackPortrait(error.message);
  }

  startAnimationLoop();
  startClockLoop();

  const currentState = await window.petAPI.getCurrentStatus();
  if (currentState) {
    applyState(currentState);
  } else {
    applyState(state.current);
  }

  window.petAPI.onStatus((payload) => {
    applyState(payload);
  });

  window.petAPI.onDevice((payload) => {
    applyDeviceState(payload);
  });

  const startupEnabled = await window.petAPI.getStartup();
  elements.startupToggle.checked = startupEnabled;
  elements.deviceEndpointInput.value = state.config.device?.endpoint || "";

  window.petAPI.ready();
}

function bindElements() {
  elements.petCard = document.getElementById("petCard");
  elements.canvas = document.getElementById("avatarCanvas");
  elements.bubbleIcon = document.getElementById("bubbleIcon");
  elements.bubbleText = document.getElementById("bubbleText");
  elements.statusBadge = document.getElementById("statusBadge");
  elements.statePill = document.getElementById("statePill");
  elements.detailText = document.getElementById("detailText");
  elements.sourceText = document.getElementById("sourceText");
  elements.elapsedText = document.getElementById("elapsedText");
  elements.fxChip = document.getElementById("fxChip");
  elements.fxSymbol = document.getElementById("fxSymbol");
  elements.deviceText = document.getElementById("deviceText");
  elements.deviceEndpointInput = document.getElementById("deviceEndpointInput");
  elements.startupToggle = document.getElementById("startupToggle");
  elements.minimizeButton = document.getElementById("minimizeButton");
  elements.quitButton = document.getElementById("quitButton");
  elements.modeButtons = Array.from(document.querySelectorAll(".mode-button"));
  elements.displayButtons = Array.from(document.querySelectorAll(".display-button"));
}

function bindControls() {
  for (const button of elements.modeButtons) {
    button.addEventListener("click", async () => {
      const mode = button.dataset.mode;
      await window.petAPI.setMode(mode);
      state.config = {
        ...state.config,
        source: {
          ...state.config.source,
          mode
        }
      };
      updateModeButtons(mode);
    });
  }

  for (const button of elements.displayButtons) {
    button.addEventListener("click", async () => {
      const mode = button.dataset.displayMode;
      await window.petAPI.setDisplayMode(mode);
      state.config = {
        ...state.config,
        display: {
          ...state.config.display,
          mode
        }
      };
      document.body.classList.toggle("display-device", mode === "device");
      updateDisplayButtons(mode);
      drawAvatarFrame(performance.now());
    });
  }

  elements.deviceEndpointInput.addEventListener("change", async () => {
    const endpoint = elements.deviceEndpointInput.value.trim();
    await window.petAPI.setDeviceEndpoint(endpoint);
    state.config = {
      ...state.config,
      device: {
        ...state.config.device,
        endpoint
      }
    };
  });

  elements.startupToggle.addEventListener("change", async () => {
    const enabled = await window.petAPI.setStartup(elements.startupToggle.checked);
    elements.startupToggle.checked = enabled;
  });

  elements.minimizeButton.addEventListener("click", () => {
    window.petAPI.minimize();
  });

  elements.quitButton.addEventListener("click", () => {
    window.petAPI.quit();
  });
}

function updateModeButtons(activeMode) {
  for (const button of elements.modeButtons) {
    button.classList.toggle("is-active", button.dataset.mode === activeMode);
  }
}

function updateDisplayButtons(activeMode) {
  for (const button of elements.displayButtons) {
    button.classList.toggle("is-active", button.dataset.displayMode === activeMode);
  }
}

function applyState(nextState) {
  state.current = {
    ...state.current,
    ...nextState
  };

  const meta = STATUS_META[state.current.status] || STATUS_META.idle;
  elements.petCard.className = `pet-card status-${state.current.status}`;
  elements.bubbleIcon.textContent = meta.bubbleIcon;
  elements.bubbleText.textContent = state.current.title || "状态更新中";
  elements.statusBadge.textContent = state.current.badge || meta.accentLabel;
  elements.statePill.textContent = meta.pill;
  elements.detailText.textContent = state.current.detail || "暂无更多描述。";
  elements.sourceText.textContent = state.current.sourceLabel || "本地状态桥接";
  elements.fxChip.textContent = state.current.status === "acting" ? "⌘" : state.current.status === "thinking" ? "..." : "□";
  elements.fxSymbol.textContent = meta.symbol;
  updateModeButtons(state.config?.source?.mode || "mock");
  updateDisplayButtons(state.config?.display?.mode || "desktop");
}

function applyDeviceState(deviceState) {
  const statusText = deviceState.status === "connected" ? "摆件屏幕已同步" : deviceState.message || "摆件屏幕未连接";
  elements.deviceText.textContent = statusText;
  elements.deviceText.dataset.status = deviceState.status;
}

function startClockLoop() {
  if (state.clockTimer) {
    clearInterval(state.clockTimer);
  }

  updateElapsedText();
  state.clockTimer = setInterval(updateElapsedText, 1000);
}

function updateElapsedText() {
  const startedAt = state.current.turnStartedAt;
  elements.elapsedText.textContent = startedAt ? formatDuration(Date.now() - startedAt) : "00:00";
}

function startAnimationLoop() {
  if (state.animationTimer) {
    clearInterval(state.animationTimer);
  }

  const fps = Math.max(6, Math.min(18, Number(state.config.animation?.fps || 12)));
  state.animationTimer = setInterval(() => {
    drawAvatarFrame(performance.now());
  }, Math.round(1000 / fps));
  drawAvatarFrame(performance.now());
}

function drawAvatarFrame(now) {
  const context = elements.canvas.getContext("2d");
  context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);

  if (state.spriteSheet) {
    drawSpriteSheetFrame(context, now);
    return;
  }

  if (!state.renderedCanvas) {
    return;
  }

  drawFallbackAvatar(context, now);
}

function drawFallbackAvatar(context, now) {
  const transform = getStatusTransform(state.current.status, now);
  const x = Math.round((elements.canvas.width - state.renderedCanvas.width) / 2);
  const y = Math.round(elements.canvas.height - state.renderedCanvas.height);

  context.save();
  context.translate(elements.canvas.width / 2 + transform.shakeX, elements.canvas.height);
  context.rotate(transform.rotate);
  context.scale(transform.scaleX, transform.scaleY);
  context.translate(-elements.canvas.width / 2, -elements.canvas.height + transform.bobY);
  context.drawImage(state.renderedCanvas, x, y);
  context.restore();

  drawStatusOverlays(context, state.current.status, now);
}

function drawSpriteSheetFrame(context, now) {
  const status = state.current.status || "idle";
  const frame = SPRITE_FRAMES[status] || SPRITE_FRAMES.idle;
  const cellWidth = Math.floor(state.spriteSheet.width / 3);
  const cellHeight = Math.floor(state.spriteSheet.height / 2);
  const sourceX = frame.column * cellWidth;
  const sourceY = frame.row * cellHeight;
  const transform = getStatusTransform(status, now);
  const isDevice = state.config.display?.mode === "device";
  const drawSize = isDevice ? 178 : 232;
  const destinationY = Math.round(elements.canvas.height - drawSize - (isDevice ? 44 : 12));

  context.save();
  context.imageSmoothingEnabled = false;
  context.translate(elements.canvas.width / 2 + transform.shakeX, destinationY + drawSize);
  context.rotate(transform.rotate);
  context.scale(transform.scaleX, transform.scaleY);
  context.drawImage(
    state.spriteSheet,
    sourceX,
    sourceY,
    cellWidth,
    cellHeight,
    -drawSize / 2,
    -drawSize + transform.bobY,
    drawSize,
    drawSize
  );
  context.restore();

  drawStatusOverlays(context, status, now);
}

function getStatusTransform(status, now) {
  const seconds = now / 1000;
  const base = {
    bobY: Math.sin(seconds * 2.2) * 3,
    rotate: 0,
    shakeX: 0,
    scaleX: 1,
    scaleY: 1
  };

  if (status === "thinking") {
    base.bobY = Math.sin(seconds * 3.1) * 5;
    base.rotate = Math.sin(seconds * 1.8) * 0.025;
  }

  if (status === "acting") {
    base.bobY = Math.sin(seconds * 8) * 2;
    base.shakeX = Math.sin(seconds * 18) * 1.2;
    base.scaleY = 1 + Math.sin(seconds * 10) * 0.012;
  }

  if (status === "waiting") {
    base.rotate = Math.sin(seconds * 2.6) * 0.035;
    base.bobY = Math.sin(seconds * 1.4) * 2;
  }

  if (status === "done") {
    base.bobY = Math.sin(seconds * 4.4) * 6;
    base.scaleX = 1 + Math.sin(seconds * 4.4) * 0.018;
    base.scaleY = 1 + Math.sin(seconds * 4.4) * 0.018;
  }

  if (status === "error") {
    base.shakeX = Math.sin(seconds * 42) * 4;
    base.rotate = Math.sin(seconds * 31) * 0.035;
  }

  return base;
}

function drawStatusOverlays(context, status, now) {
  const seconds = now / 1000;

  if (status === "idle") {
    drawSparkle(context, 52, 74 + Math.sin(seconds * 2) * 4, 8, "#ffd875");
    drawSparkle(context, 178, 48 + Math.cos(seconds * 1.6) * 4, 6, "#ffd875");
  }

  if (status === "thinking") {
    drawDotTrail(context, seconds);
  }

  if (status === "acting") {
    drawCommandPulse(context, seconds);
  }

  if (status === "waiting") {
    drawHourglassPulse(context, seconds);
  }

  if (status === "done") {
    drawConfetti(context, seconds);
  }

  if (status === "error") {
    drawWarningFlash(context, seconds);
  }
}

function drawSparkle(context, x, y, size, color) {
  context.save();
  context.fillStyle = color;
  context.globalAlpha = 0.8;
  context.fillRect(Math.round(x - 1), Math.round(y - size / 2), 2, size);
  context.fillRect(Math.round(x - size / 2), Math.round(y - 1), size, 2);
  context.restore();
}

function drawDotTrail(context, seconds) {
  context.save();
  for (let index = 0; index < 3; index += 1) {
    const pulse = (Math.sin(seconds * 4 + index * 1.2) + 1) / 2;
    context.fillStyle = `rgba(114, 216, 255, ${0.35 + pulse * 0.55})`;
    context.fillRect(164 + index * 14, 46 - pulse * 8, 8, 8);
  }
  context.restore();
}

function drawCommandPulse(context, seconds) {
  context.save();
  const alpha = 0.35 + ((Math.sin(seconds * 8) + 1) / 2) * 0.35;
  context.fillStyle = `rgba(255, 248, 225, ${alpha})`;
  context.fillRect(82, 146, 58, 4);
  context.fillRect(94, 158, 42, 4);
  context.fillStyle = `rgba(255, 153, 102, ${alpha})`;
  context.fillRect(148, 146, 10, 10);
  context.restore();
}

function drawHourglassPulse(context, seconds) {
  context.save();
  const y = 62 + ((seconds * 10) % 34);
  context.fillStyle = "rgba(247, 200, 77, 0.8)";
  context.fillRect(42, y, 4, 4);
  context.fillRect(50, y + 8, 4, 4);
  context.restore();
}

function drawConfetti(context, seconds) {
  context.save();
  const colors = ["#73f5a4", "#ffd875", "#ff9fb0", "#72d8ff"];
  for (let index = 0; index < 12; index += 1) {
    const x = 38 + ((index * 37 + seconds * 24) % 154);
    const y = 28 + ((index * 19 + seconds * 42) % 96);
    context.fillStyle = colors[index % colors.length];
    context.globalAlpha = 0.75;
    context.fillRect(Math.round(x), Math.round(y), 5, 5);
  }
  context.restore();
}

function drawWarningFlash(context, seconds) {
  context.save();
  context.globalAlpha = 0.2 + ((Math.sin(seconds * 14) + 1) / 2) * 0.18;
  context.fillStyle = "#ff6d6d";
  context.fillRect(18, 18, elements.canvas.width - 36, elements.canvas.height - 36);
  context.restore();
}

function buildPixelPortrait(image, pixelConfig) {
  const crop = pixelConfig.crop || { x: 0.08, y: 0.03, w: 0.84, h: 0.84 };
  const smallWidth = Number(pixelConfig.smallWidth || 60);
  const scale = Number(pixelConfig.scale || 3);
  const threshold = Number(pixelConfig.backgroundThreshold || 245);
  const outlineColor = pixelConfig.outlineColor || "#2b1b18";

  const cropX = Math.floor(image.width * crop.x);
  const cropY = Math.floor(image.height * crop.y);
  const cropWidth = Math.floor(image.width * crop.w);
  const cropHeight = Math.floor(image.height * crop.h);
  const smallHeight = Math.max(1, Math.round((cropHeight / cropWidth) * smallWidth));

  const smallCanvas = document.createElement("canvas");
  smallCanvas.width = smallWidth;
  smallCanvas.height = smallHeight;

  const smallContext = smallCanvas.getContext("2d", { willReadFrequently: true });
  smallContext.imageSmoothingEnabled = true;
  smallContext.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    smallWidth,
    smallHeight
  );

  const imageData = smallContext.getImageData(0, 0, smallWidth, smallHeight);
  removeNearWhiteBackground(imageData, threshold);
  quantizeImage(imageData);
  const outlined = addOutline(imageData, hexToRgba(outlineColor));
  smallContext.putImageData(outlined, 0, 0);

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = smallWidth * scale;
  outputCanvas.height = smallHeight * scale;
  const outputContext = outputCanvas.getContext("2d");
  outputContext.imageSmoothingEnabled = false;
  outputContext.drawImage(smallCanvas, 0, 0, outputCanvas.width, outputCanvas.height);

  return outputCanvas;
}

function removeNearWhiteBackground(imageData, threshold) {
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const isNearWhite =
      red > threshold &&
      green > threshold &&
      blue > threshold &&
      Math.abs(red - green) < 12 &&
      Math.abs(green - blue) < 12;

    if (isNearWhite) {
      data[index + 3] = 0;
    }
  }
}

function quantizeImage(imageData) {
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) {
      continue;
    }

    data[index] = quantizeChannel(data[index]);
    data[index + 1] = quantizeChannel(data[index + 1]);
    data[index + 2] = quantizeChannel(data[index + 2]);
  }
}

function quantizeChannel(value) {
  const step = 32;
  return Math.max(0, Math.min(255, Math.round(value / step) * step));
}

function addOutline(imageData, outlineColor) {
  const { width, height, data } = imageData;
  const result = new ImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3];

      if (alpha > 0) {
        result.data[offset] = data[offset];
        result.data[offset + 1] = data[offset + 1];
        result.data[offset + 2] = data[offset + 2];
        result.data[offset + 3] = alpha;
        continue;
      }

      if (hasOpaqueNeighbor(data, width, height, x, y)) {
        result.data[offset] = outlineColor.r;
        result.data[offset + 1] = outlineColor.g;
        result.data[offset + 2] = outlineColor.b;
        result.data[offset + 3] = outlineColor.a;
      }
    }
  }

  return result;
}

function hasOpaqueNeighbor(data, width, height, x, y) {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }

      const nextX = x + offsetX;
      const nextY = y + offsetY;

      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
        continue;
      }

      const neighborOffset = (nextY * width + nextX) * 4;
      if (data[neighborOffset + 3] > 0) {
        return true;
      }
    }
  }

  return false;
}

function buildFallbackPortrait(message = "照片加载失败") {
  const canvas = document.createElement("canvas");
  canvas.width = 180;
  canvas.height = 220;
  const context = canvas.getContext("2d");

  context.fillStyle = "#ffefe0";
  context.fillRect(60, 18, 60, 60);
  context.fillStyle = "#2f1a16";
  context.fillRect(45, 5, 90, 42);
  context.fillRect(52, 90, 76, 92);
  context.fillStyle = "#ffffff";
  context.fillRect(32, 178, 116, 24);
  context.fillStyle = "#2b1b18";
  context.font = "12px sans-serif";
  context.fillText(message.slice(0, 8), 52, 212);

  return canvas;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败"));
    image.src = dataUrl;
  });
}

function hexToRgba(hex) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((segment) => `${segment}${segment}`).join("")
    : normalized;

  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
    a: 255
  };
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
