const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_STATE = {
  status: "idle",
  title: "待命中",
  detail: "等待状态源连接。",
  badge: "IDLE",
  sourceLabel: "本地状态桥接",
  updatedAt: Date.now(),
  turnStartedAt: null
};

class StatusBridge {
  constructor({ rootDir, getConfig, onState }) {
    this.rootDir = rootDir;
    this.getConfig = getConfig;
    this.onState = onState;
    this.currentState = { ...DEFAULT_STATE };
    this.mockTimer = null;
    this.fileWatcher = null;
    this.codexProcess = null;
    this.codexLogTimer = null;
    this.codexLogFilePath = null;
    this.codexLogOffset = 0;
    this.lastCodexLogEventAt = 0;
    this.stdoutBuffer = "";
    this.stderrTail = "";
  }

  start() {
    this.stop();

    const config = this.getConfig();
    const mode = config?.source?.mode || "mock";

    if (mode === "codex-exec") {
      this.startCodexExecMode();
      return;
    }

    if (mode === "json-file") {
      this.startJsonFileMode();
      return;
    }

    this.startCodexExecMode();
  }

  stop() {
    if (this.mockTimer) {
      clearInterval(this.mockTimer);
      this.mockTimer = null;
    }

    if (this.fileWatcher) {
      fs.unwatchFile(this.fileWatcher.filePath, this.fileWatcher.listener);
      this.fileWatcher = null;
    }

    if (this.codexProcess) {
      this.codexProcess.kill();
      this.codexProcess = null;
    }

    if (this.codexLogTimer) {
      clearInterval(this.codexLogTimer);
      this.codexLogTimer = null;
    }

    this.codexLogFilePath = null;
    this.codexLogOffset = 0;
  }

  emitState(partialState) {
    this.currentState = {
      ...this.currentState,
      ...partialState,
      updatedAt: Date.now()
    };
    this.onState(this.currentState);
  }

  startMockMode() {
    const config = this.getConfig();
    const seconds = Number(config?.source?.mockCycleSeconds || 6);
    const sequence = [
      {
        status: "idle",
        title: "待命中",
        detail: "桌宠已就位，等待新的 Codex 任务。",
        badge: "IDLE",
        sourceLabel: "Mock 演示"
      },
      {
        status: "thinking",
        title: "正在思考",
        detail: "分析任务和拆解执行计划。",
        badge: "THINK",
        sourceLabel: "Mock 演示",
        turnStartedAt: Date.now()
      },
      {
        status: "acting",
        title: "正在动手",
        detail: "调用工具、改代码、整理结果。",
        badge: "TOOL",
        sourceLabel: "Mock 演示",
        turnStartedAt: Date.now()
      },
      {
        status: "waiting",
        title: "等待你确认",
        detail: "遇到需要你拍板的步骤，暂时先停一下。",
        badge: "WAIT",
        sourceLabel: "Mock 演示",
        turnStartedAt: Date.now()
      },
      {
        status: "approval",
        title: "等待权限审批",
        detail: "Codex 需要你批准命令或权限后才能继续。",
        badge: "ALLOW",
        sourceLabel: "Mock 演示",
        turnStartedAt: Date.now()
      },
      {
        status: "done",
        title: "任务完成",
        detail: "结果已经整理好，可以继续下一步。",
        badge: "DONE",
        sourceLabel: "Mock 演示",
        turnStartedAt: null
      }
    ];

    let index = 0;
    this.emitState(sequence[index]);

    this.mockTimer = setInterval(() => {
      index = (index + 1) % sequence.length;
      const nextState = {
        ...sequence[index]
      };

      if (nextState.status === "thinking" || nextState.status === "acting" || nextState.status === "waiting" || nextState.status === "approval") {
        nextState.turnStartedAt = Date.now();
      }

      this.emitState(nextState);
    }, seconds * 1000);
  }

  startJsonFileMode() {
    const config = this.getConfig();
    const relativePath = config?.source?.file?.path || "./runtime/status.json";
    const filePath = path.isAbsolute(relativePath) ? relativePath : path.join(this.rootDir, relativePath);

    const loadFileState = () => {
      if (!fs.existsSync(filePath)) {
        this.emitState({
          status: "idle",
          title: "等待状态文件",
          detail: `还没看到 ${path.basename(filePath)}，你可以先写入一份 JSON。`,
          badge: "FILE",
          sourceLabel: "JSON 文件"
        });
        return;
      }

      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        this.emitState(normalizeExternalState(parsed, "JSON 文件"));
      } catch (error) {
        this.emitState({
          status: "error",
          title: "状态文件解析失败",
          detail: error.message,
          badge: "ERR",
          sourceLabel: "JSON 文件"
        });
      }
    };

    loadFileState();

    fs.watchFile(filePath, { interval: 800 }, loadFileState);
    this.fileWatcher = {
      filePath,
      listener: loadFileState
    };
  }

  startCodexExecMode() {
    const config = this.getConfig();
    const sourceConfig = config?.source?.codexExec || {};
    if (sourceConfig.autoStart === false) {
      this.startCodexLogMode();
      return;
    }

    const command = sourceConfig.command || "codex";
    const args = Array.isArray(sourceConfig.args) ? sourceConfig.args : [];
    const cwd = sourceConfig.cwd ? resolveMaybeRelative(this.rootDir, sourceConfig.cwd) : this.rootDir;

    this.emitState({
      status: "thinking",
      title: "正在连接 Codex",
      detail: `${command} ${args.join(" ")}`.trim(),
      badge: "LINK",
      sourceLabel: "codex exec --json",
      turnStartedAt: Date.now()
    });

    this.codexProcess = spawn(command, args, {
      cwd,
      shell: true
    });

    this.codexProcess.stdout.on("data", (chunk) => {
      this.consumeStdout(chunk.toString("utf8"));
    });

    this.codexProcess.stderr.on("data", (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-400);
    });

    this.codexProcess.on("close", (code) => {
      if (code === 0) {
        this.emitState({
          status: "done",
          title: "Codex 已完成",
          detail: "本轮 codex exec 已正常结束。",
          badge: "DONE",
          sourceLabel: "codex exec --json",
          turnStartedAt: null
        });
        return;
      }

      this.emitState({
        status: "error",
        title: "Codex 进程退出异常",
        detail: (this.stderrTail || `退出码 ${code}`).trim(),
        badge: "ERR",
        sourceLabel: "codex exec --json",
        turnStartedAt: null
      });
    });

    this.codexProcess.on("error", (error) => {
      this.emitState({
        status: "error",
        title: "无法启动 Codex",
        detail: error.message,
        badge: "ERR",
        sourceLabel: "codex exec --json",
        turnStartedAt: null
      });
    });
  }

  startCodexLogMode() {
    const poll = () => {
      const latestLog = findLatestCodexSessionLog();
      if (!latestLog) {
        this.emitState({
          status: "idle",
          title: "等待 Codex 日志",
          detail: "还没找到 .codex/sessions 会话日志。",
          badge: "IDLE",
          sourceLabel: "Codex 会话日志",
          turnStartedAt: null
        });
        return;
      }

      if (latestLog !== this.codexLogFilePath) {
        this.codexLogFilePath = latestLog;
        this.codexLogOffset = Math.max(0, fs.statSync(latestLog).size - 96 * 1024);
        this.emitState({
          status: "idle",
          title: "已监听 Codex",
          detail: `正在监听 ${path.basename(latestLog)}`,
          badge: "LOG",
          sourceLabel: "Codex 会话日志",
          turnStartedAt: null
        });
      }

      this.consumeCodexLog(latestLog);
      this.maybeMarkCodexLogIdle();
    };

    poll();
    this.codexLogTimer = setInterval(poll, 900);
  }

  consumeCodexLog(filePath) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (error) {
      return;
    }

    if (stat.size < this.codexLogOffset) {
      this.codexLogOffset = 0;
    }

    if (stat.size === this.codexLogOffset) {
      return;
    }

    const length = stat.size - this.codexLogOffset;
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, length, this.codexLogOffset);
    } finally {
      fs.closeSync(fd);
    }
    this.codexLogOffset = stat.size;

    const lines = buffer.toString("utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        const mapped = mapCodexLogRecordToState(record, this.currentState);
        if (mapped) {
          this.lastCodexLogEventAt = Date.now();
          this.emitState(mapped);
        }
      } catch (_error) {
        // 会话日志可能刚写到半行，下一次轮询会读到完整内容。
      }
    }
  }

  maybeMarkCodexLogIdle() {
    const status = this.currentState?.status;
    if (!this.lastCodexLogEventAt || status === "idle" || status === "approval" || status === "waiting") {
      return;
    }

    const idleAfterMs = Number(this.getConfig()?.source?.codexLogIdleAfterMs || 180000);
    if (Date.now() - this.lastCodexLogEventAt > idleAfterMs) {
      this.emitState({
        status: "idle",
        title: "待命中",
        detail: "最近没有新的 Codex 会话事件。",
        badge: "IDLE",
        sourceLabel: "Codex 会话日志",
        turnStartedAt: null
      });
    }
  }

  consumeStdout(text) {
    this.stdoutBuffer += text;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const event = JSON.parse(trimmed);
        const mappedState = mapCodexEventToState(event, this.currentState);
        if (mappedState) {
          this.emitState(mappedState);
        }
      } catch (error) {
        this.emitState({
          status: "error",
          title: "状态流解析失败",
          detail: `${error.message}：${trimmed.slice(0, 120)}`,
          badge: "ERR",
          sourceLabel: "codex exec --json"
        });
      }
    }
  }
}

function normalizeExternalState(rawState, sourceLabel) {
  const status = normalizeStatusName(rawState.status || "idle");
  return {
    status,
    title: rawState.title || "收到外部状态",
    detail: rawState.detail || "外部桥接程序已推送新的状态。",
    badge: rawState.badge || status.toUpperCase() || "EXT",
    sourceLabel,
    turnStartedAt: rawState.turnStartedAt || null
  };
}

function resolveMaybeRelative(rootDir, targetPath) {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  return path.join(rootDir, targetPath);
}

function mapCodexEventToState(event, previousState) {
  const eventType = event?.type;
  if (!eventType) {
    return null;
  }

  if (/approval|authorize|permission/i.test(JSON.stringify(event))) {
    return {
      status: "approval",
      title: "等待权限审批",
      detail: "检测到 Codex 正在等待你批准权限或命令。",
      badge: "ALLOW",
      sourceLabel: "codex exec --json",
      turnStartedAt: previousState.turnStartedAt || Date.now()
    };
  }

  if (eventType === "thread.started") {
    return {
      status: "thinking",
      title: "Codex 已连接",
      detail: "线程已经创建，准备开始处理任务。",
      badge: "LINK",
      sourceLabel: "codex exec --json"
    };
  }

  if (eventType === "turn.started") {
    return {
      status: "thinking",
      title: "新一轮任务开始",
      detail: "Codex 正在读取上下文并组织计划。",
      badge: "TURN",
      sourceLabel: "codex exec --json",
      turnStartedAt: Date.now()
    };
  }

  if (eventType === "turn.completed") {
    return {
      status: "done",
      title: "任务完成",
      detail: "这一轮已经收尾，等待下一步。",
      badge: "DONE",
      sourceLabel: "codex exec --json",
      turnStartedAt: null
    };
  }

  if (eventType === "turn.failed" || eventType === "error") {
    const detail = event?.message || event?.error?.message || "Codex 返回了失败事件。";
    return {
      status: "error",
      title: "执行失败",
      detail,
      badge: "ERR",
      sourceLabel: "codex exec --json",
      turnStartedAt: null
    };
  }

  if (eventType === "item.started") {
    return mapItemState(event?.item, previousState);
  }

  if (eventType === "item.completed") {
    const item = event?.item || {};
    const itemType = item.type || item.item_type;

    if (itemType === "agent_message") {
      return {
        status: "acting",
        title: "正在整理回复",
        detail: "准备把结果汇总成可读的回答。",
        badge: "CHAT",
        sourceLabel: "codex exec --json",
        turnStartedAt: previousState.turnStartedAt || Date.now()
      };
    }

    return null;
  }

  return null;
}

function mapCodexLogRecordToState(record, previousState) {
  const payload = record?.payload || {};
  const payloadType = payload?.type;
  const recordText = JSON.stringify(record || {});

  if (/sandbox_permissions\\"?:\\"require_escalated|approval|authorize|permission/i.test(recordText)) {
    return {
      status: "approval",
      title: "等待权限审批",
      detail: "Codex 请求权限或审批，需要你确认。",
      badge: "ALLOW",
      sourceLabel: "Codex 会话日志",
      turnStartedAt: previousState.turnStartedAt || Date.now()
    };
  }

  if (record?.type === "event_msg" && payloadType === "user_message") {
    return {
      status: "thinking",
      title: "收到新任务",
      detail: "Codex 正在读取你的新请求。",
      badge: "THINK",
      sourceLabel: "Codex 会话日志",
      turnStartedAt: Date.now()
    };
  }

  if (record?.type === "response_item" && payloadType === "reasoning") {
    return {
      status: "thinking",
      title: "正在思考",
      detail: "Codex 正在分析上下文和组织步骤。",
      badge: "THINK",
      sourceLabel: "Codex 会话日志",
      turnStartedAt: previousState.turnStartedAt || Date.now()
    };
  }

  if (record?.type === "response_item" && payloadType === "function_call") {
    return {
      status: "acting",
      title: "正在调用工具",
      detail: shorten(payload.name || "工具调用中。"),
      badge: "TOOL",
      sourceLabel: "Codex 会话日志",
      turnStartedAt: previousState.turnStartedAt || Date.now()
    };
  }

  if (record?.type === "response_item" && payloadType === "function_call_output") {
    return {
      status: "acting",
      title: "工具返回结果",
      detail: "Codex 正在读取工具输出。",
      badge: "WORK",
      sourceLabel: "Codex 会话日志",
      turnStartedAt: previousState.turnStartedAt || Date.now()
    };
  }

  if (record?.type === "event_msg" && payloadType === "agent_message") {
    return {
      status: "done",
      title: "正在汇报结果",
      detail: shorten(payload.message || "Codex 正在回复你。"),
      badge: "DONE",
      sourceLabel: "Codex 会话日志",
      turnStartedAt: null
    };
  }

  if (record?.type === "response_item" && payloadType === "message") {
    return {
      status: "done",
      title: "已生成回复",
      detail: "Codex 已输出一段回复。",
      badge: "DONE",
      sourceLabel: "Codex 会话日志",
      turnStartedAt: null
    };
  }

  if (/error|failed|execution error/i.test(recordText)) {
    return {
      status: "error",
      title: "执行异常",
      detail: "Codex 日志中出现错误事件。",
      badge: "ERR",
      sourceLabel: "Codex 会话日志",
      turnStartedAt: null
    };
  }

  return null;
}

function findLatestCodexSessionLog() {
  const sessionsDir = path.join(os.homedir(), ".codex", "sessions");
  if (!fs.existsSync(sessionsDir)) {
    return null;
  }

  let latest = null;
  const stack = [sessionsDir];
  while (stack.length) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (_error) {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }

      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (_error) {
        continue;
      }

      if (!latest || stat.mtimeMs > latest.mtimeMs) {
        latest = {
          filePath: fullPath,
          mtimeMs: stat.mtimeMs
        };
      }
    }
  }

  return latest?.filePath || null;
}

function mapItemState(item, previousState) {
  const itemType = item?.type || item?.item_type || "unknown";
  const combinedText = JSON.stringify(item || {});

  if (/approval|authorize|confirm|permission|allow/i.test(combinedText)) {
    return {
      status: "approval",
      title: "等待权限审批",
      detail: "检测到疑似审批或授权步骤，先高亮提醒。",
      badge: "ALLOW",
      sourceLabel: "codex exec --json",
      turnStartedAt: previousState.turnStartedAt || Date.now()
    };
  }

  if (itemType === "reasoning") {
    return {
      status: "thinking",
      title: "正在思考",
      detail: "分析问题、拆解步骤、准备行动。",
      badge: "THINK",
      sourceLabel: "codex exec --json",
      turnStartedAt: previousState.turnStartedAt || Date.now()
    };
  }

  if (itemType === "command_execution") {
    return {
      status: "acting",
      title: "正在运行命令",
      detail: shorten(item?.command || item?.raw_command || "命令执行中。"),
      badge: "TERM",
      sourceLabel: "codex exec --json",
      turnStartedAt: previousState.turnStartedAt || Date.now()
    };
  }

  if (itemType === "mcp_tool_call") {
    return {
      status: "acting",
      title: "正在调用工具",
      detail: shorten(item?.tool_name || item?.server || "MCP 工具调用中。"),
      badge: "TOOL",
      sourceLabel: "codex exec --json",
      turnStartedAt: previousState.turnStartedAt || Date.now()
    };
  }

  if (itemType === "web_search") {
    return {
      status: "acting",
      title: "正在搜索资料",
      detail: shorten(item?.query || "正在检索网页信息。"),
      badge: "WEB",
      sourceLabel: "codex exec --json",
      turnStartedAt: previousState.turnStartedAt || Date.now()
    };
  }

  if (itemType === "plan_update") {
    return {
      status: "thinking",
      title: "正在调整计划",
      detail: "把执行步骤整理成更稳妥的节奏。",
      badge: "PLAN",
      sourceLabel: "codex exec --json",
      turnStartedAt: previousState.turnStartedAt || Date.now()
    };
  }

  if (itemType === "file_change") {
    return {
      status: "acting",
      title: "正在修改文件",
      detail: shorten(item?.path || item?.file_path || "文件变更中。"),
      badge: "EDIT",
      sourceLabel: "codex exec --json",
      turnStartedAt: previousState.turnStartedAt || Date.now()
    };
  }

  if (itemType === "agent_message") {
    return {
      status: "acting",
      title: "正在组织回复",
      detail: "准备把当前进展讲清楚。",
      badge: "CHAT",
      sourceLabel: "codex exec --json",
      turnStartedAt: previousState.turnStartedAt || Date.now()
    };
  }

  return {
    status: "acting",
    title: "正在处理中",
    detail: `收到事件：${itemType}`,
    badge: "WORK",
    sourceLabel: "codex exec --json",
    turnStartedAt: previousState.turnStartedAt || Date.now()
  };
}

function shorten(text) {
  if (!text) {
    return "处理中。";
  }

  return String(text).replace(/\s+/g, " ").slice(0, 100);
}

function normalizeStatusName(status) {
  const rawStatus = String(status || "idle").toLowerCase();
  if (rawStatus === "needs_approval" || rawStatus === "approval_required" || rawStatus === "permission") {
    return "approval";
  }

  return rawStatus;
}

module.exports = {
  StatusBridge
};
