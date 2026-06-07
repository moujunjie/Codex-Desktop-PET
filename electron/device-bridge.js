const http = require("node:http");
const https = require("node:https");

const STATUS_COLORS = {
  idle: "#67d881",
  thinking: "#72d8ff",
  acting: "#ff9966",
  waiting: "#f7c84d",
  approval: "#e84638",
  done: "#73f5a4",
  error: "#ff6d6d",
  offline: "#8c8c95"
};

class DeviceBridge {
  constructor({ getConfig, onDeviceState }) {
    this.getConfig = getConfig;
    this.onDeviceState = onDeviceState;
    this.timer = null;
    this.lastState = null;
    this.inFlight = false;
  }

  start() {
    this.stop();
    const interval = Number(this.getConfig()?.device?.pushIntervalMs || 2500);
    this.timer = setInterval(() => {
      if (this.lastState) {
        this.push(this.lastState);
      }
    }, interval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.inFlight = false;
  }

  setState(state) {
    this.lastState = state;
    this.push(state);
  }

  push(state) {
    const endpoint = this.getConfig()?.device?.endpoint;
    if (!endpoint) {
      this.emitDeviceState("idle", "未配置屏幕地址");
      return;
    }

    if (this.inFlight) {
      return;
    }

    const payload = buildDevicePayload(state);
    this.inFlight = true;

    postJson(endpoint, payload, Number(this.getConfig()?.device?.requestTimeoutMs || 900))
      .then(() => {
        this.emitDeviceState("connected", "摆件屏幕已同步");
      })
      .catch((error) => {
        this.emitDeviceState("error", error.message);
      })
      .finally(() => {
        this.inFlight = false;
      });
  }

  emitDeviceState(status, message) {
    this.onDeviceState({
      status,
      message,
      updatedAt: Date.now()
    });
  }
}

function buildDevicePayload(state) {
  const status = state?.status || "idle";

  return {
    version: 1,
    status,
    title: state?.title || "待命中",
    detail: state?.detail || "",
    badge: state?.badge || status.toUpperCase(),
    color: STATUS_COLORS[status] || STATUS_COLORS.idle,
    updatedAt: Date.now(),
    // 摆件固件只要消费这几个字段，就可以映射到圆屏、点阵屏或三色灯。
    screen: {
      layout: "pixel-pet",
      frame: status,
      mood: status
    }
  };
}

function postJson(endpoint, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const body = JSON.stringify(payload);
    const transport = url.protocol === "https:" ? https : http;

    const request = transport.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body)
        }
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
            return;
          }
          reject(new Error(`屏幕返回 HTTP ${response.statusCode}`));
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("屏幕连接超时"));
    });

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

module.exports = {
  DeviceBridge,
  buildDevicePayload
};
