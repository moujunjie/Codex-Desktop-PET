import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");
const outputPath = path.join(rootDir, "runtime", "status.json");

const status = process.argv[2] || "idle";
const title = process.argv[3] || "状态已更新";
const detail = process.argv[4] || "这是通过脚本写入的演示状态。";
const badge = process.argv[5] || status.toUpperCase();

const payload = {
  status,
  title,
  detail,
  badge,
  turnStartedAt: ["thinking", "acting", "waiting"].includes(status) ? Date.now() : null
};

await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
console.log(`状态已写入 ${outputPath}`);
