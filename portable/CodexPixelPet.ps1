Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$script:AppName = "CodexPixelPet"
$script:InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:RegistryPath = "HKCU:\Software\CodexPixelPet"
$script:RunRegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$script:RunValueName = "CodexPixelPet"
$script:SourceMode = "mock"
$script:DisplayMode = "desktop"
$script:Endpoint = "http://192.168.4.1/status"
$script:DeviceMessage = "摆件屏幕未连接"
$script:DeviceStatus = "idle"
$script:LastDevicePush = Get-Date "2000-01-01"
$script:MockIndex = 0
$script:LastMockSwitch = Get-Date
$script:CodexProcess = $null

$script:Status = [pscustomobject]@{
  status = "idle"
  title = "待命中"
  detail = "等待新的 Codex 任务。"
  badge = "IDLE"
  turnStartedAt = $null
}

$script:StatusColors = @{
  idle = [System.Drawing.Color]::FromArgb(103, 216, 129)
  thinking = [System.Drawing.Color]::FromArgb(114, 216, 255)
  acting = [System.Drawing.Color]::FromArgb(255, 153, 102)
  waiting = [System.Drawing.Color]::FromArgb(247, 200, 77)
  done = [System.Drawing.Color]::FromArgb(115, 245, 164)
  error = [System.Drawing.Color]::FromArgb(255, 109, 109)
  offline = [System.Drawing.Color]::FromArgb(140, 140, 149)
}

$script:SpriteFrames = @{
  idle = @{ column = 0; row = 0 }
  thinking = @{ column = 1; row = 0 }
  acting = @{ column = 2; row = 0 }
  waiting = @{ column = 0; row = 1 }
  done = @{ column = 1; row = 1 }
  error = @{ column = 2; row = 1 }
  offline = @{ column = 0; row = 1 }
}

$script:MockStates = @(
  @{ status = "idle"; title = "待命中"; detail = "桌宠已就位，等待新的 Codex 任务。"; badge = "IDLE" },
  @{ status = "thinking"; title = "正在思考"; detail = "分析任务和拆解执行计划。"; badge = "THINK" },
  @{ status = "acting"; title = "正在动手"; detail = "调用工具、改代码、整理结果。"; badge = "TOOL" },
  @{ status = "waiting"; title = "等待你确认"; detail = "遇到需要你拍板的步骤，暂时先停一下。"; badge = "WAIT" },
  @{ status = "done"; title = "任务完成"; detail = "结果已经整理好，可以继续下一步。"; badge = "DONE" },
  @{ status = "error"; title = "遇到异常"; detail = "演示一个错误状态，方便确认红色动效。"; badge = "ERR" }
)

function Ensure-RegistryKey {
  if (-not (Test-Path $script:RegistryPath)) {
    New-Item -Path $script:RegistryPath -Force | Out-Null
  }
}

function Read-Setting {
  param(
    [string]$Name,
    [string]$DefaultValue
  )

  Ensure-RegistryKey
  try {
    $value = (Get-ItemProperty -Path $script:RegistryPath -Name $Name -ErrorAction Stop).$Name
    if ([string]::IsNullOrWhiteSpace($value)) {
      return $DefaultValue
    }
    return [string]$value
  } catch {
    return $DefaultValue
  }
}

function Write-Setting {
  param(
    [string]$Name,
    [string]$Value
  )

  Ensure-RegistryKey
  Set-ItemProperty -Path $script:RegistryPath -Name $Name -Value $Value
}

function Get-AccentColor {
  $status = [string]$script:Status.status
  if ($script:StatusColors.ContainsKey($status)) {
    return $script:StatusColors[$status]
  }
  return $script:StatusColors.idle
}

function Set-PetStatus {
  param(
    [hashtable]$State
  )

  $startedAt = $null
  if (@("thinking", "acting", "waiting") -contains $State.status) {
    $startedAt = Get-Date
  }

  $script:Status = [pscustomobject]@{
    status = $State.status
    title = $State.title
    detail = $State.detail
    badge = $State.badge
    turnStartedAt = $startedAt
  }

  Update-Labels
}

function Format-Duration {
  if ($null -eq $script:Status.turnStartedAt) {
    return "00:00"
  }

  $span = (Get-Date) - $script:Status.turnStartedAt
  return "{0:00}:{1:00}" -f [Math]::Floor($span.TotalMinutes), $span.Seconds
}

function Round-Rect {
  param(
    [System.Drawing.RectangleF]$Rect,
    [float]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2
  $path.AddArc($Rect.X, $Rect.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rect.Right - $diameter, $Rect.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rect.Right - $diameter, $Rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rect.X, $Rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-Sparkle {
  param(
    [System.Drawing.Graphics]$Graphics,
    [float]$X,
    [float]$Y,
    [float]$Size,
    [System.Drawing.Color]$Color
  )

  $brush = New-Object System.Drawing.SolidBrush $Color
  $Graphics.FillRectangle($brush, [int]($X - 1), [int]($Y - $Size / 2), 2, [int]$Size)
  $Graphics.FillRectangle($brush, [int]($X - $Size / 2), [int]($Y - 1), [int]$Size, 2)
  $brush.Dispose()
}

function Draw-StatusOverlays {
  param(
    [System.Drawing.Graphics]$Graphics,
    [float]$Seconds
  )

  $status = [string]$script:Status.status

  if ($status -eq "idle") {
    Draw-Sparkle $Graphics 72 (126 + [Math]::Sin($Seconds * 2) * 4) 10 ([System.Drawing.Color]::FromArgb(255, 216, 117))
    Draw-Sparkle $Graphics 240 (94 + [Math]::Cos($Seconds * 1.6) * 4) 8 ([System.Drawing.Color]::FromArgb(255, 216, 117))
  }

  if ($status -eq "thinking") {
    for ($i = 0; $i -lt 3; $i++) {
      $pulse = ([Math]::Sin($Seconds * 4 + $i * 1.2) + 1) / 2
      $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb([int](90 + $pulse * 150), 114, 216, 255))
      $Graphics.FillRectangle($brush, 210 + $i * 15, [int](92 - $pulse * 9), 8, 8)
      $brush.Dispose()
    }
  }

  if ($status -eq "acting") {
    $alpha = [int](90 + (([Math]::Sin($Seconds * 8) + 1) / 2) * 90)
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($alpha, 255, 248, 225))
    $Graphics.FillRectangle($brush, 100, 216, 74, 5)
    $Graphics.FillRectangle($brush, 116, 230, 52, 5)
    $brush.Dispose()
  }

  if ($status -eq "waiting") {
    $y = 105 + (($Seconds * 12) % 42)
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(210, 247, 200, 77))
    $Graphics.FillRectangle($brush, 74, [int]$y, 5, 5)
    $Graphics.FillRectangle($brush, 84, [int]($y + 10), 5, 5)
    $brush.Dispose()
  }

  if ($status -eq "done") {
    $colors = @(
      [System.Drawing.Color]::FromArgb(115, 245, 164),
      [System.Drawing.Color]::FromArgb(255, 216, 117),
      [System.Drawing.Color]::FromArgb(255, 159, 176),
      [System.Drawing.Color]::FromArgb(114, 216, 255)
    )
    for ($i = 0; $i -lt 14; $i++) {
      $brush = New-Object System.Drawing.SolidBrush $colors[$i % $colors.Count]
      $x = 48 + (($i * 39 + $Seconds * 25) % 210)
      $y = 72 + (($i * 19 + $Seconds * 42) % 128)
      $Graphics.FillRectangle($brush, [int]$x, [int]$y, 5, 5)
      $brush.Dispose()
    }
  }

  if ($status -eq "error") {
    $alpha = [int](35 + (([Math]::Sin($Seconds * 14) + 1) / 2) * 45)
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($alpha, 255, 109, 109))
    $Graphics.FillRectangle($brush, 28, 72, 264, 222)
    $brush.Dispose()
  }
}

function Load-SpriteImage {
  $candidates = @(
    (Join-Path $script:InstallDir "pixel-pet-spritesheet.png"),
    (Join-Path $script:InstallDir "ig_0757e341b2ac3e0e016a25782b93a4819681a6378cddac779a.png")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return [System.Drawing.Image]::FromFile($candidate)
    }
  }

  return $null
}

function Draw-Pet {
  param(
    [System.Drawing.Graphics]$Graphics
  )

  $seconds = ([DateTimeOffset]::Now.ToUnixTimeMilliseconds() % 1000000) / 1000
  $accent = Get-AccentColor

  $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $Graphics.Clear([System.Drawing.Color]::Magenta)

  $card = New-Object System.Drawing.RectangleF 10, 10, ($script:Form.Width - 20), ($script:Form.Height - 20)
  $cardPath = Round-Rect $card 26
  $cardBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(232, 21, 18, 16))
  $Graphics.FillPath($cardBrush, $cardPath)
  $cardBrush.Dispose()
  $cardPath.Dispose()

  $ringPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, $accent.R, $accent.G, $accent.B)), 8
  $Graphics.DrawEllipse($ringPen, 62, 82, 196, 196)
  $ringPen.Dispose()

  $shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(80, 0, 0, 0))
  $Graphics.FillEllipse($shadowBrush, 88, 286, 144, 24)
  $shadowBrush.Dispose()

  if ($null -ne $script:SpriteImage) {
    $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half

    $status = [string]$script:Status.status
    if (-not $script:SpriteFrames.ContainsKey($status)) {
      $status = "idle"
    }

    $frame = $script:SpriteFrames[$status]
    $cellWidth = [Math]::Floor($script:SpriteImage.Width / 3)
    $cellHeight = [Math]::Floor($script:SpriteImage.Height / 2)
    $src = New-Object System.Drawing.Rectangle ($frame.column * $cellWidth), ($frame.row * $cellHeight), $cellWidth, $cellHeight

    $drawSize = if ($script:DisplayMode -eq "device") { 172 } else { 226 }
    $destX = [int](($script:Form.Width - $drawSize) / 2)
    $destY = if ($script:DisplayMode -eq "device") { 88 } else { 86 }

    $bob = [Math]::Sin($seconds * 2.2) * 3
    $shake = 0
    $rotate = 0
    $scale = 1

    if ($status -eq "thinking") {
      $bob = [Math]::Sin($seconds * 3.1) * 5
      $rotate = [Math]::Sin($seconds * 1.8) * 1.4
    } elseif ($status -eq "acting") {
      $bob = [Math]::Sin($seconds * 8) * 2
      $shake = [Math]::Sin($seconds * 18) * 2
    } elseif ($status -eq "waiting") {
      $rotate = [Math]::Sin($seconds * 2.6) * 2.0
    } elseif ($status -eq "done") {
      $bob = [Math]::Sin($seconds * 4.4) * 6
      $scale = 1 + [Math]::Sin($seconds * 4.4) * 0.018
    } elseif ($status -eq "error") {
      $shake = [Math]::Sin($seconds * 42) * 4
      $rotate = [Math]::Sin($seconds * 31) * 2.0
    }

    $state = $Graphics.Save()
    $Graphics.TranslateTransform($script:Form.Width / 2 + $shake, $destY + $drawSize)
    $Graphics.RotateTransform($rotate)
    $Graphics.ScaleTransform($scale, $scale)
    $dest = New-Object System.Drawing.Rectangle ([int](-$drawSize / 2)), ([int](-$drawSize + $bob)), $drawSize, $drawSize
    $Graphics.DrawImage($script:SpriteImage, $dest, $src, [System.Drawing.GraphicsUnit]::Pixel)
    $Graphics.Restore($state)
  }

  Draw-StatusOverlays $Graphics $seconds
}

function Update-Labels {
  if ($null -eq $script:TitleLabel) {
    return
  }

  $script:TitleLabel.Text = [string]$script:Status.title
  $script:DetailLabel.Text = [string]$script:Status.detail
  $script:BadgeLabel.Text = [string]$script:Status.badge
  $script:ElapsedLabel.Text = Format-Duration
  $script:SourceLabel.Text = "状态源：$script:SourceMode"
  $script:DeviceLabel.Text = $script:DeviceMessage

  $accent = Get-AccentColor
  foreach ($button in @($script:BtnMock, $script:BtnCodex, $script:BtnFile, $script:BtnDesktop, $script:BtnDevice)) {
    $button.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
  }

  if ($script:SourceMode -eq "mock") { $script:BtnMock.BackColor = $accent }
  if ($script:SourceMode -eq "codex") { $script:BtnCodex.BackColor = $accent }
  if ($script:SourceMode -eq "file") { $script:BtnFile.BackColor = $accent }
  if ($script:DisplayMode -eq "desktop") { $script:BtnDesktop.BackColor = $accent }
  if ($script:DisplayMode -eq "device") { $script:BtnDevice.BackColor = $accent }

  $script:EndpointBox.Visible = $script:DisplayMode -eq "device"
  $script:DeviceLabel.Visible = $script:DisplayMode -eq "device"
  $script:Form.Height = if ($script:DisplayMode -eq "device") { 438 } else { 512 }
  $script:Form.Invalidate()
}

function Set-SourceMode {
  param([string]$Mode)

  $script:SourceMode = $Mode
  if ($Mode -eq "mock") {
    $script:MockIndex = 0
    $script:LastMockSwitch = Get-Date
    Set-PetStatus $script:MockStates[$script:MockIndex]
  } elseif ($Mode -eq "file") {
    Set-PetStatus @{ status = "idle"; title = "等待状态文件"; detail = "读取 $script:InstallDir\status.json"; badge = "FILE" }
  } elseif ($Mode -eq "codex") {
    Start-CodexSource
  }
  Update-Labels
}

function Set-DisplayMode {
  param([string]$Mode)

  $script:DisplayMode = $Mode
  Write-Setting "DisplayMode" $Mode
  Update-Labels
}

function Read-FileStatus {
  $statusPath = Join-Path $script:InstallDir "status.json"
  if (-not (Test-Path $statusPath)) {
    Set-PetStatus @{ status = "idle"; title = "等待状态文件"; detail = "读取 $statusPath"; badge = "FILE" }
    return
  }

  try {
    $json = Get-Content -Path $statusPath -Raw -ErrorAction Stop | ConvertFrom-Json
    Set-PetStatus @{
      status = if ($json.status) { [string]$json.status } else { "idle" }
      title = if ($json.title) { [string]$json.title } else { "收到外部状态" }
      detail = if ($json.detail) { [string]$json.detail } else { "外部状态已更新。" }
      badge = if ($json.badge) { [string]$json.badge } else { "FILE" }
    }
  } catch {
    Set-PetStatus @{ status = "error"; title = "状态文件解析失败"; detail = $_.Exception.Message; badge = "ERR" }
  }
}

function Handle-CodexLine {
  param([string]$Line)

  try {
    $event = $Line | ConvertFrom-Json
    $type = [string]$event.type

    if ($type -eq "thread.started") {
      Set-PetStatus @{ status = "thinking"; title = "Codex 已连接"; detail = "线程已经创建，准备开始处理任务。"; badge = "LINK" }
    } elseif ($type -eq "turn.started") {
      Set-PetStatus @{ status = "thinking"; title = "新一轮任务开始"; detail = "Codex 正在读取上下文并组织计划。"; badge = "TURN" }
    } elseif ($type -eq "turn.completed") {
      Set-PetStatus @{ status = "done"; title = "任务完成"; detail = "这一轮已经收尾，等待下一步。"; badge = "DONE" }
    } elseif ($type -eq "turn.failed" -or $type -eq "error") {
      Set-PetStatus @{ status = "error"; title = "执行失败"; detail = "Codex 返回了失败事件。"; badge = "ERR" }
    } elseif ($type -like "item.*") {
      $itemText = $event.item | ConvertTo-Json -Compress -Depth 8
      if ($itemText -match "approval|authorize|confirm|permission|allow") {
        Set-PetStatus @{ status = "waiting"; title = "等待你确认"; detail = "检测到审批或授权步骤。"; badge = "WAIT" }
      } elseif ($itemText -match "command|tool|file|web|search") {
        Set-PetStatus @{ status = "acting"; title = "正在动手"; detail = "调用工具、运行命令或处理文件。"; badge = "TOOL" }
      } else {
        Set-PetStatus @{ status = "thinking"; title = "正在思考"; detail = "分析上下文并准备下一步。"; badge = "THINK" }
      }
    }
  } catch {
    Set-PetStatus @{ status = "error"; title = "状态流解析失败"; detail = $_.Exception.Message; badge = "ERR" }
  }
}

function Start-CodexSource {
  Set-PetStatus @{ status = "thinking"; title = "正在连接 Codex"; detail = "启动 codex exec --json。"; badge = "LINK" }

  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $psi.Arguments = '/c codex exec --json "请简短说明当前任务的进展，并在完成后结束。"'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    $process.EnableRaisingEvents = $true
    $process.add_OutputDataReceived({
      param($sender, $eventArgs)
      if (-not [string]::IsNullOrWhiteSpace($eventArgs.Data)) {
        Handle-CodexLine $eventArgs.Data
      }
    })
    $process.add_ErrorDataReceived({
      param($sender, $eventArgs)
      if (-not [string]::IsNullOrWhiteSpace($eventArgs.Data)) {
        Set-PetStatus @{ status = "error"; title = "Codex 输出错误"; detail = $eventArgs.Data; badge = "ERR" }
      }
    })
    $process.add_Exited({
      if ($script:SourceMode -eq "codex" -and $sender.ExitCode -eq 0) {
        Set-PetStatus @{ status = "done"; title = "Codex 已完成"; detail = "本轮 codex exec 已正常结束。"; badge = "DONE" }
      }
    })

    $process.Start() | Out-Null
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
    $script:CodexProcess = $process
  } catch {
    Set-PetStatus @{ status = "error"; title = "无法启动 Codex"; detail = $_.Exception.Message; badge = "ERR" }
  }
}

function Set-StartupEnabled {
  param([bool]$Enabled)

  try {
    if ($Enabled) {
      $launcher = Join-Path $script:InstallDir "launch-installed.cmd"
      $command = "`"$launcher`""
      New-Item -Path $script:RunRegistryPath -Force | Out-Null
      Set-ItemProperty -Path $script:RunRegistryPath -Name $script:RunValueName -Value $command
    } else {
      Remove-ItemProperty -Path $script:RunRegistryPath -Name $script:RunValueName -ErrorAction SilentlyContinue
    }
  } catch {
    [System.Windows.Forms.MessageBox]::Show("开机自启动设置失败：$($_.Exception.Message)", $script:AppName) | Out-Null
  }
}

function Get-StartupEnabled {
  try {
    $value = (Get-ItemProperty -Path $script:RunRegistryPath -Name $script:RunValueName -ErrorAction Stop).$script:RunValueName
    return -not [string]::IsNullOrWhiteSpace($value)
  } catch {
    return $false
  }
}

function Push-DeviceStatus {
  if ($script:DisplayMode -ne "device") {
    return
  }

  if ([string]::IsNullOrWhiteSpace($script:Endpoint)) {
    $script:DeviceMessage = "未配置屏幕地址"
    $script:DeviceStatus = "error"
    return
  }

  try {
    $payload = [ordered]@{
      version = 1
      status = [string]$script:Status.status
      title = [string]$script:Status.title
      detail = [string]$script:Status.detail
      badge = [string]$script:Status.badge
      color = "#{0:X2}{1:X2}{2:X2}" -f (Get-AccentColor).R, (Get-AccentColor).G, (Get-AccentColor).B
      updatedAt = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
      screen = @{
        layout = "pixel-pet"
        frame = [string]$script:Status.status
        mood = [string]$script:Status.status
      }
    }

    $json = $payload | ConvertTo-Json -Compress -Depth 5
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $request = [System.Net.WebRequest]::Create($script:Endpoint)
    $request.Method = "POST"
    $request.Timeout = 900
    $request.ContentType = "application/json"
    $request.ContentLength = $bytes.Length
    $stream = $request.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    $response = $request.GetResponse()
    $response.Close()
    $script:DeviceMessage = "摆件屏幕已同步"
    $script:DeviceStatus = "connected"
  } catch {
    $script:DeviceMessage = "屏幕连接失败：$($_.Exception.Message)"
    $script:DeviceStatus = "error"
  }
}

function New-FlatButton {
  param(
    [string]$Text,
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height
  )

  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.SetBounds($X, $Y, $Width, $Height)
  $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $button.FlatAppearance.BorderSize = 0
  $button.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
  $button.ForeColor = [System.Drawing.Color]::White
  $button.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 8.5, [System.Drawing.FontStyle]::Bold)
  return $button
}

function New-InfoLabel {
  param(
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height,
    [float]$Size,
    [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular
  )

  $label = New-Object System.Windows.Forms.Label
  $label.SetBounds($X, $Y, $Width, $Height)
  $label.BackColor = [System.Drawing.Color]::Transparent
  $label.ForeColor = [System.Drawing.Color]::FromArgb(255, 247, 236)
  $label.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", $Size, $Style)
  return $label
}

$script:DisplayMode = Read-Setting "DisplayMode" "desktop"
$script:Endpoint = Read-Setting "Endpoint" "http://192.168.4.1/status"
$script:SpriteImage = Load-SpriteImage

$script:Form = New-Object System.Windows.Forms.Form
$script:Form.Text = $script:AppName
$script:Form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$script:Form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$script:Form.Size = New-Object System.Drawing.Size(320, 512)
$script:Form.TopMost = $true
$script:Form.BackColor = [System.Drawing.Color]::Magenta
$script:Form.TransparencyKey = [System.Drawing.Color]::Magenta
$script:Form.ShowInTaskbar = $true

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$script:Form.Location = New-Object System.Drawing.Point(($screen.Right - 340), ($screen.Bottom - 540))

$doubleBufferProperty = $script:Form.GetType().GetProperty("DoubleBuffered", [System.Reflection.BindingFlags] "Instance, NonPublic")
$doubleBufferProperty.SetValue($script:Form, $true, $null)

$script:TitleLabel = New-InfoLabel 28 336 210 24 10 ([System.Drawing.FontStyle]::Bold)
$script:DetailLabel = New-InfoLabel 28 362 260 40 8.5
$script:BadgeLabel = New-InfoLabel 238 336 54 24 8.5 ([System.Drawing.FontStyle]::Bold)
$script:ElapsedLabel = New-InfoLabel 238 18 54 24 8.5 ([System.Drawing.FontStyle]::Bold)
$script:SourceLabel = New-InfoLabel 28 396 260 18 8
$script:DeviceLabel = New-InfoLabel 28 396 260 18 8

$script:BtnMock = New-FlatButton "演示" 24 418 84 28
$script:BtnCodex = New-FlatButton "Codex" 118 418 84 28
$script:BtnFile = New-FlatButton "文件" 212 418 84 28
$script:BtnDesktop = New-FlatButton "桌面" 24 454 132 28
$script:BtnDevice = New-FlatButton "摆件屏幕" 164 454 132 28

$script:EndpointBox = New-Object System.Windows.Forms.TextBox
$script:EndpointBox.SetBounds(24, 418, 272, 26)
$script:EndpointBox.Text = $script:Endpoint
$script:EndpointBox.BackColor = [System.Drawing.Color]::FromArgb(25, 25, 25)
$script:EndpointBox.ForeColor = [System.Drawing.Color]::White
$script:EndpointBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$script:EndpointBox.Visible = $false

$script:StartupCheck = New-Object System.Windows.Forms.CheckBox
$script:StartupCheck.Text = "开机自启动"
$script:StartupCheck.SetBounds(24, 486, 132, 24)
$script:StartupCheck.BackColor = [System.Drawing.Color]::Transparent
$script:StartupCheck.ForeColor = [System.Drawing.Color]::FromArgb(217, 201, 176)
$script:StartupCheck.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 8.5)
$script:StartupCheck.Checked = Get-StartupEnabled

$minimizeButton = New-FlatButton "−" 246 16 28 26
$quitButton = New-FlatButton "×" 278 16 28 26

$script:Form.Controls.AddRange(@(
  $script:TitleLabel,
  $script:DetailLabel,
  $script:BadgeLabel,
  $script:ElapsedLabel,
  $script:SourceLabel,
  $script:DeviceLabel,
  $script:BtnMock,
  $script:BtnCodex,
  $script:BtnFile,
  $script:BtnDesktop,
  $script:BtnDevice,
  $script:EndpointBox,
  $script:StartupCheck,
  $minimizeButton,
  $quitButton
))

$script:Form.Add_Paint({
  param($sender, $eventArgs)
  Draw-Pet $eventArgs.Graphics
})

$dragging = $false
$dragStart = New-Object System.Drawing.Point 0, 0
$script:Form.Add_MouseDown({
  param($sender, $eventArgs)
  if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    $script:dragging = $true
    $script:dragStart = $eventArgs.Location
  }
})
$script:Form.Add_MouseMove({
  param($sender, $eventArgs)
  if ($script:dragging) {
    $script:Form.Left += $eventArgs.X - $script:dragStart.X
    $script:Form.Top += $eventArgs.Y - $script:dragStart.Y
  }
})
$script:Form.Add_MouseUp({
  $script:dragging = $false
})

$script:BtnMock.Add_Click({ Set-SourceMode "mock" })
$script:BtnCodex.Add_Click({ Set-SourceMode "codex" })
$script:BtnFile.Add_Click({ Set-SourceMode "file" })
$script:BtnDesktop.Add_Click({ Set-DisplayMode "desktop" })
$script:BtnDevice.Add_Click({ Set-DisplayMode "device" })
$script:EndpointBox.Add_Leave({
  $script:Endpoint = $script:EndpointBox.Text.Trim()
  Write-Setting "Endpoint" $script:Endpoint
})
$script:StartupCheck.Add_CheckedChanged({
  Set-StartupEnabled $script:StartupCheck.Checked
})
$minimizeButton.Add_Click({ $script:Form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized })
$quitButton.Add_Click({ $script:Form.Close() })

$logicTimer = New-Object System.Windows.Forms.Timer
$logicTimer.Interval = 500
$logicTimer.Add_Tick({
  if ($script:SourceMode -eq "mock" -and ((Get-Date) - $script:LastMockSwitch).TotalSeconds -ge 6) {
    $script:MockIndex = ($script:MockIndex + 1) % $script:MockStates.Count
    $script:LastMockSwitch = Get-Date
    Set-PetStatus $script:MockStates[$script:MockIndex]
  }

  if ($script:SourceMode -eq "file") {
    Read-FileStatus
  }

  if (((Get-Date) - $script:LastDevicePush).TotalMilliseconds -ge 2500) {
    $script:LastDevicePush = Get-Date
    Push-DeviceStatus
  }

  Update-Labels
})

$animationTimer = New-Object System.Windows.Forms.Timer
$animationTimer.Interval = 83
$animationTimer.Add_Tick({ $script:Form.Invalidate() })

Set-SourceMode "mock"
Update-Labels
$logicTimer.Start()
$animationTimer.Start()

[System.Windows.Forms.Application]::Run($script:Form)
