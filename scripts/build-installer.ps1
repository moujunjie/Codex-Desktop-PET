param(
  [ValidateSet("nsis", "portable")]
  [string]$Target = "nsis"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

Write-Host "安装打包依赖..."
npm install --no-audit --no-fund

if ($Target -eq "portable") {
  Write-Host "生成便携版..."
  npm run build:portable
} else {
  Write-Host "生成安装包..."
  npm run build
}

Write-Host "输出目录：$ProjectRoot\release"
