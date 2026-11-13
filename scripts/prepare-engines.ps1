# 准备打包用的内置引擎：resources/bin/{yt-dlp,ffmpeg,ffprobe}.exe
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\prepare-engines.ps1 -Proxy http://127.0.0.1:<端口>
#   powershell -ExecutionPolicy Bypass -File scripts\prepare-engines.ps1 -FfmpegDir <包含 ffmpeg.exe 的目录>
param(
  [string]$FfmpegDir = '',
  [string]$Proxy = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'resources\bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null

if ($Proxy) {
  $env:HTTPS_PROXY = $Proxy
  $env:HTTP_PROXY = $Proxy
}

# 1) yt-dlp：必须是官方独立 exe（pip 装出来的只有 47KB 启动器，需要 Python）
$ytdlp = Join-Path $bin 'yt-dlp.exe'
Write-Host '下载 yt-dlp 独立版...'
curl.exe -L --fail -o $ytdlp 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
if (-not (Test-Path $ytdlp)) { throw 'yt-dlp 下载失败' }
if ((Get-Item $ytdlp).Length -lt 5MB) { throw 'yt-dlp.exe 体积异常，可能下到了 launcher' }

# 2) ffmpeg / ffprobe：默认从 PATH 找，找不到就要求传 -FfmpegDir
if ([string]::IsNullOrWhiteSpace($FfmpegDir)) {
  $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'PATH 里没有 ffmpeg，请用 -FfmpegDir 指定包含 ffmpeg.exe 的目录' }
  $FfmpegDir = Split-Path -Parent $cmd.Source
}
foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
  $source = Join-Path $FfmpegDir $name
  if (-not (Test-Path $source)) { throw "缺少 $source" }
  Copy-Item $source (Join-Path $bin $name) -Force
}

Get-ChildItem $bin | Select-Object Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize
Write-Host "内置引擎已就绪：$bin"
