const fs = require("node:fs");
const path = require("node:path");

class SettingsStore {
  constructor(userDataDir) {
    this.userDataDir = userDataDir;
    this.logPath = path.join(userDataDir, "settings-log.jsonl");
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  readLatest() {
    if (!fs.existsSync(this.logPath)) {
      return {};
    }

    const lines = fs.readFileSync(this.logPath, "utf8").split(/\r?\n/).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const record = JSON.parse(lines[index]);
        return record.settings || {};
      } catch (_error) {
        // 设置采用追加日志，遇到损坏行时继续向前找上一份可用配置。
      }
    }

    return {};
  }

  append(settings) {
    const record = {
      savedAt: new Date().toISOString(),
      settings
    };
    fs.appendFileSync(this.logPath, `${JSON.stringify(record)}\n`, "utf8");
  }
}

function mergeDeep(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch === undefined ? base : patch;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = isPlainObject(value) ? mergeDeep(base[key] || {}, value) : value;
  }

  return merged;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  SettingsStore,
  mergeDeep
};
