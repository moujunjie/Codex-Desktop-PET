# Codex Pixel Pet 最新版说明

> 更新时间：2026-06-08  
> 当前可下载安装包：[release/electron-installer-v16/Codex Pixel Pet Setup 0.1.0.exe](release/electron-installer-v16/Codex%20Pixel%20Pet%20Setup%200.1.0.exe)

这是一个轻量化的 Codex 工作状态桌面宠物。最新版已经改成“右下角系统托盘常驻 + 透明桌面状态牌 + 可选摆件屏幕同步”的形态，桌面上只显示像素风状态图标，不再显示额外窗口标题或控制按钮。

## 最新功能

- 透明悬浮桌宠：默认显示带文字、动作和小道具的像素状态牌。
- 系统托盘常驻：右键右下角托盘图标可以打开设置、显示/隐藏桌面图标、退出软件。
- 设置页面：支持调整桌面图标大小、切换图标风格、切换桌面/摆件屏幕模式、配置开机自启动。
- 实时缩放：图标大小范围为 `15%` 到 `300%`，拖动滑杆时会实时预览。
- 默认状态源：默认监听本机 `~/.codex/sessions` 下最新 Codex 会话日志，不再使用循环演示模式。
- 审批提醒：检测到 Codex 需要权限审批时会进入 `approval` 状态，显示更醒目的审批图标，并弹出系统通知。
- 摆件屏幕同步：切换到摆件屏幕模式后，会把状态通过 HTTP JSON 推送给 ESP32、圆屏、点阵屏或三色灯固件。
- 低资源策略：桌面窗口无边框、透明、跳过任务栏；Windows 下禁用 GPU 合成以减少透明背景淡色条纹。

## 快速使用

1. 下载并运行安装包：[`Codex Pixel Pet Setup 0.1.0.exe`](release/electron-installer-v16/Codex%20Pixel%20Pet%20Setup%200.1.0.exe)
2. 启动后看右下角系统托盘图标。
3. 右键托盘图标，选择 `打开设置`。
4. 在设置里调整图标大小、开机自启动、状态来源和摆件屏幕地址。

## 当前状态映射

- `idle`：待命，最近没有新的 Codex 会话事件。
- `thinking`：收到新任务、推理中、正在整理计划。
- `acting`：正在调用工具、执行命令、读取工具输出或修改文件。
- `waiting`：等待用户继续输入。
- `approval`：等待权限审批，属于最高优先级提醒状态。
- `done`：Codex 已生成回复或正在汇报结果。
- `error`：日志中出现错误、失败或桥接异常。
- `offline`：状态源不可用或屏幕同步离线。

## 状态来源

最新版默认选择 `codex-exec` 模式，但当 `pet.config.json` 里的 `source.codexExec.autoStart` 为 `false` 时，实际会进入 Codex 会话日志监听模式。

监听逻辑位于 [`electron/status-bridge.js`](electron/status-bridge.js)：

- 自动查找 `~/.codex/sessions` 下最近修改的 `.jsonl` 会话日志。
- 每 `900ms` 轮询新增内容。
- 根据 `user_message`、`reasoning`、`function_call`、`function_call_output`、`agent_message` 等记录映射桌宠状态。
- 检测到 `approval`、`permission`、`authorize` 或 `sandbox_permissions: require_escalated` 等关键词时进入审批提醒。
- 如果一段时间没有新事件，会自动回到 `idle`。

备用模式仍然保留 `json-file`，可以通过设置页切换。外部程序写入 [`runtime/status.json`](runtime/status.json) 后，桌宠会读取其中的 `status`、`title`、`detail`、`badge` 等字段。

## 摆件屏幕接口

切换到 `摆件屏幕同步` 后，软件会把当前状态周期性 `POST` 到设置页配置的 HTTP 地址。默认地址是：

```text
http://192.168.4.1/status
```

硬件端接收 JSON：

```json
{
  "version": 1,
  "status": "acting",
  "title": "正在调用工具",
  "detail": "shell_command",
  "badge": "TOOL",
  "color": "#ff9966",
  "updatedAt": 1780000000000,
  "screen": {
    "layout": "pixel-pet",
    "frame": "acting",
    "mood": "acting"
  }
}
```

## 开发与打包

安装依赖：

```bash
npm install
```

开发运行：

```bash
npm run dev
```

生成 Windows 安装包：

```bash
npm run build
```

安装包输出到 `release/`。当前上传到 GitHub 的可下载版本位于 `release/electron-installer-v16/`，未上传 `win-unpacked`，因为其中包含超过 GitHub 普通仓库限制的大文件。

---

以下内容是早期原型阶段记录，保留用于追溯设计演进；实际使用请以上面的“最新版说明”为准。

# Codex Pixel Pet

这是一个桌面悬浮版和摆件屏幕双形态的 Codex 状态桌宠，当前重点是四件事：

- 使用像素风精灵图展示不同工作状态
- 用透明置顶窗口把它作为桌宠悬浮在桌面上
- 支持切换到摆件屏幕模式，通过 HTTP 把状态推送给 ESP32/圆屏/点阵屏
- 用稳定、可机读的状态源驱动不同人物状态

## 当前方案

当前我选的主状态源是 `codex exec --json`。

原因很直接：

- 它是官方文档明确支持的机器可读事件流
- 事件粒度足够细，能区分线程开始、回合开始、回合完成、错误、以及中间 item 事件
- 比抓桌面窗口标题或 OCR 更稳

为了便于先把桌宠界面跑起来，应用内同时保留了三个状态源模式：

- `mock`：本地演示轮播，不需要连接 Codex
- `codex-exec`：启动 `codex exec --json` 并解析事件流
- `json-file`：监听 [runtime/status.json](/E:/codex_project/AI红绿灯/runtime/status.json) 这个文件，方便你后续自己接别的桥接程序

显示形式也保留了两个按钮：

- `桌面`：在电脑桌面上显示动态图标桌宠
- `摆件屏幕`：软件窗口变成轻量控制台，同时把状态推送给硬件屏幕

## 目录

- [electron/main.js](/E:/codex_project/AI红绿灯/electron/main.js)：Electron 主进程，负责透明置顶窗口和 IPC
- [electron/status-bridge.js](/E:/codex_project/AI红绿灯/electron/status-bridge.js)：状态桥接，负责 mock、JSON 文件、Codex 事件流三种来源
- [src/renderer.js](/E:/codex_project/AI红绿灯/src/renderer.js)：像素化照片、状态动画、界面更新
- [pet.config.json](/E:/codex_project/AI红绿灯/pet.config.json)：照片路径、裁切参数、状态源配置
- [electron/device-bridge.js](/E:/codex_project/AI红绿灯/electron/device-bridge.js)：摆件屏幕 HTTP 推送
- [electron/settings-store.js](/E:/codex_project/AI红绿灯/electron/settings-store.js)：安装后的用户设置保存，采用追加日志方式

## 运行

先安装依赖：

```bash
npm install
```

启动桌宠：

```bash
npm run dev
```

## 打安装包

安装依赖后可以生成 Windows 安装包：

```bash
npm run build
```

输出目录：

`release/`

也可以生成便携版：

```bash
npm run build:portable
```

或者使用 PowerShell 脚本：

```powershell
pwsh -File ./scripts/build-installer.ps1
pwsh -File ./scripts/build-installer.ps1 -Target portable
```

当前打包配置在 [package.json](/E:/codex_project/AI红绿灯/package.json) 里，使用 `electron-builder` 的 NSIS 安装包。

## 开机自启动

软件内有 `开机自启动` 开关。

实现上使用 Electron 的 `setLoginItemSettings`，设置会保存到系统用户数据目录里的追加日志，不会改写项目配置文件。

## 配置照片

默认已经指向你这次提供的照片路径：

`E:/xwechat_files/wxid_d13r361pn3nb22_39bd/temp/RWTemp/2026-06/667fac53b07d021f348a13ea174aacd3.jpg`

如果以后换图，改 [pet.config.json](/E:/codex_project/AI红绿灯/pet.config.json) 里的 `photoPath` 即可。

像素化时会自动做这些处理：

- 按配置裁切人物主体
- 尝试去掉接近纯白的背景
- 做低色阶量化
- 增加像素描边，让悬浮图标更像“桌宠贴纸”

## 切换状态源

### 1. 演示模式

直接点击悬浮窗底部的 `演示` 按钮即可。

### 2. Codex 模式

点击 `Codex` 按钮，或把 [pet.config.json](/E:/codex_project/AI红绿灯/pet.config.json) 里的：

```json
"mode": "codex-exec"
```

保持默认 `codexExec` 参数时，应用会尝试执行：

```bash
codex exec --json "请简短说明当前任务的进展，并在完成后结束。"
```

你也可以把 `args` 改成自己的任务内容，或指定别的工作目录。

### 3. JSON 文件模式

点击 `文件` 按钮后，应用会监听：

`./runtime/status.json`

你可以用这个脚本快速写入状态：

```bash
node ./scripts/write-status.mjs thinking "正在思考" "分析状态桥接方案"
```

可用状态建议：

- `idle`
- `thinking`
- `acting`
- `waiting`
- `done`
- `error`
- `offline`

## 当前状态映射

- `idle`：待命
- `thinking`：分析任务、整理计划
- `acting`：运行命令、调用工具、改代码、搜索资料
- `waiting`：等待你确认或授权
- `done`：本轮完成
- `error`：执行异常或桥接失败

## 动态桌宠

现在默认优先加载 [pet.config.json](/E:/codex_project/AI红绿灯/pet.config.json) 里的 `spriteSheetPath`，也就是已经生成好的 6 状态像素风精灵图。

每个状态会裁切不同人物格子：

- `idle`：OK 手势待命
- `thinking`：思考姿态
- `acting`：电脑工作姿态
- `waiting`：等待姿态
- `done`：开心完成姿态
- `error`：疑惑/异常姿态

人物本体用 `12fps` 的 Canvas 动画绘制，叠加少量粒子效果；计时文本每秒刷新一次，避免长期悬浮时占用过多资源。

## 摆件屏幕接口

切换到 `摆件屏幕` 后，软件会把当前状态周期性 `POST` 到配置里的 `device.endpoint`。

默认地址：

```text
http://192.168.4.1/status
```

硬件端接收 JSON 即可：

```json
{
  "version": 1,
  "status": "acting",
  "title": "正在运行命令",
  "detail": "npm run build",
  "badge": "TERM",
  "color": "#ff9966",
  "updatedAt": 1780000000000,
  "screen": {
    "layout": "pixel-pet",
    "frame": "acting",
    "mood": "acting"
  }
}
```

## 这版原型的取舍

- 优先做了“桌面可用”的悬浮窗和状态桥接，没有先上复杂的角色骨骼动画
- 人物状态目前是“同一像素角色 + 不同徽章 / 动效 / 颜色语义”，这样能先稳定表达工作状态
- 如果你喜欢这个方向，下一版最值得继续做的是“多帧精灵图”，把思考、敲键盘、等待、完成这些动作做成独立像素姿态
