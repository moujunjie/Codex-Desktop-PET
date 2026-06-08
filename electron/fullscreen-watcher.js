const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_POLL_INTERVAL_MS = 800;

class FullscreenWatcher {
  constructor({ pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, onChange }) {
    this.pollIntervalMs = pollIntervalMs;
    this.onChange = onChange;
    this.process = null;
    this.stdoutBuffer = "";
    this.stopped = true;
  }

  start() {
    if (process.platform !== "win32" || this.process) {
      return;
    }

    this.stopped = false;
    const command = resolvePowerShellCommand();
    this.process = spawn(
      command,
      [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        buildWatcherScript(this.pollIntervalMs)
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    this.process.stdout.on("data", (chunk) => {
      this.consumeStdout(chunk.toString("utf8"));
    });

    this.process.stderr.on("data", (chunk) => {
      const message = chunk.toString("utf8").trim();
      if (message) {
        console.warn("全屏检测进程提示：", message);
      }
    });

    this.process.on("error", (error) => {
      console.warn("全屏检测进程启动失败：", error.message);
    });

    this.process.on("exit", () => {
      this.process = null;
      this.stdoutBuffer = "";
    });
  }

  stop() {
    this.stopped = true;
    if (!this.process) {
      return;
    }

    const watcherProcess = this.process;
    this.process = null;
    watcherProcess.kill();
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
        this.onChange?.(JSON.parse(trimmed));
      } catch (error) {
        console.warn("全屏检测结果解析失败：", error.message);
      }
    }
  }
}

function resolvePowerShellCommand() {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const windowsPowerShell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (fs.existsSync(windowsPowerShell)) {
    return windowsPowerShell;
  }

  return "powershell.exe";
}

function buildWatcherScript(pollIntervalMs) {
  const safeInterval = Math.max(300, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS);
  return `
$ErrorActionPreference = "SilentlyContinue"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ForegroundWindowApi {
  public const uint MONITOR_DEFAULTTONEAREST = 2;

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MONITORINFO {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
  }

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);

  [DllImport("user32.dll")]
  public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);
}
"@

function Get-WindowTextValue($handle) {
  $buffer = New-Object System.Text.StringBuilder 512
  [ForegroundWindowApi]::GetWindowText($handle, $buffer, $buffer.Capacity) | Out-Null
  return $buffer.ToString()
}

function Get-WindowClassName($handle) {
  $buffer = New-Object System.Text.StringBuilder 256
  [ForegroundWindowApi]::GetClassName($handle, $buffer, $buffer.Capacity) | Out-Null
  return $buffer.ToString()
}

$lastJson = ""
while ($true) {
  try {
    $handle = [ForegroundWindowApi]::GetForegroundWindow()
    $result = @{
      fullscreen = $false
      processId = 0
      title = ""
      className = ""
    }

    if ($handle -ne [IntPtr]::Zero) {
      $windowRect = New-Object ForegroundWindowApi+RECT
      $hasWindowRect = [ForegroundWindowApi]::GetWindowRect($handle, [ref]$windowRect)
      $monitorHandle = [ForegroundWindowApi]::MonitorFromWindow($handle, [ForegroundWindowApi]::MONITOR_DEFAULTTONEAREST)
      $monitorInfo = New-Object ForegroundWindowApi+MONITORINFO
      $monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([ForegroundWindowApi+MONITORINFO])
      $hasMonitorInfo = [ForegroundWindowApi]::GetMonitorInfo($monitorHandle, [ref]$monitorInfo)
      $processId = 0
      [ForegroundWindowApi]::GetWindowThreadProcessId($handle, [ref]$processId) | Out-Null
      $className = Get-WindowClassName $handle
      $title = Get-WindowTextValue $handle

      $visible = [ForegroundWindowApi]::IsWindowVisible($handle)
      $minimized = [ForegroundWindowApi]::IsIconic($handle)
      $tolerance = 3
      $coversMonitor =
        $hasWindowRect -and
        $hasMonitorInfo -and
        $windowRect.Left -le ($monitorInfo.rcMonitor.Left + $tolerance) -and
        $windowRect.Top -le ($monitorInfo.rcMonitor.Top + $tolerance) -and
        $windowRect.Right -ge ($monitorInfo.rcMonitor.Right - $tolerance) -and
        $windowRect.Bottom -ge ($monitorInfo.rcMonitor.Bottom - $tolerance)

      $ignoredShellClass = $className -eq "Progman" -or $className -eq "WorkerW" -or $className -eq "Shell_TrayWnd"

      $result = @{
        fullscreen = [bool]($visible -and -not $minimized -and -not $ignoredShellClass -and $coversMonitor)
        processId = [int]$processId
        title = $title
        className = $className
      }
    }

    $json = $result | ConvertTo-Json -Compress
    if ($json -ne $lastJson) {
      [Console]::Out.WriteLine($json)
      [Console]::Out.Flush()
      $lastJson = $json
    }
  } catch {
    $json = (@{ fullscreen = $false; processId = 0; title = ""; className = "" } | ConvertTo-Json -Compress)
    if ($json -ne $lastJson) {
      [Console]::Out.WriteLine($json)
      [Console]::Out.Flush()
      $lastJson = $json
    }
  }

  Start-Sleep -Milliseconds ${safeInterval}
}
`;
}

module.exports = {
  FullscreenWatcher
};
