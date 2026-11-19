# =====================================================================
# Clawd 中心：一个只给你自己用的小网站 + 用 Edge 的"应用模式"打开它
#
# 像开一家只有你一个客人的小店：
#   柜台（这个脚本）在 127.0.0.1 开门，只有这台电脑能进来，而且要带暗号 token
#   店面（tools\hub\index.html）用 Edge 打开，看起来像一个独立的 app
#   传话：
#     Clawd → 店面：Clawd 把最新状态写进 -State 文件，店面每 0.6 秒来柜台看一次
#     店面 → Clawd：你按了按钮，店面告诉柜台，柜台印一行 CLAWD_ACTION:{...} 给 Clawd
#   店面关掉（或很久没来看）→ 柜台自己关门
#
# 参数：-Root 插件文件夹  -State 状态文件  -Data 放 Edge 资料的文件夹  -NoBrowser 不自动开 Edge（测试用）
# =====================================================================

#   -OpenUrl <网址>：柜台已经开着、只是窗口被关了 → 只重新打开窗口，然后结束
param([string]$Root = (Split-Path -Parent $PSScriptRoot), [string]$State = '', [string]$Data = $env:TEMP, [switch]$NoBrowser, [string]$OpenUrl = '')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Say-ToClawd([string]$line) {
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
}

# 用 Edge 的应用模式打开店面（没有网址栏，像一个独立 app）
function Open-Window([string]$target) {
  $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($edge) {
    $edgeData = Join-Path $Data 'edge-hub' # 单独的资料夹：不会混进你平常的 Edge
    Start-Process $edge -ArgumentList "--app=$target", "--user-data-dir=`"$edgeData`"", '--window-size=1180,780', '--no-first-run', '--no-default-browser-check', '--disable-extensions'
  } else {
    Start-Process $target # 没有 Edge 就用默认浏览器
  }
}

if ($OpenUrl -ne '') {
  if ($OpenUrl -notmatch '^http://127\.0\.0\.1:\d+/\?t=[0-9a-f]+$') { exit 2 } # 只打开自己的柜台
  Open-Window $OpenUrl
  exit 0
}

# ---------- 1. 找一个空着的门牌号（端口） ----------
$listener = $null
$port = 0
foreach ($p in 47800..47899) {
  $l = New-Object Net.HttpListener
  $l.Prefixes.Add("http://127.0.0.1:$p/")
  try { $l.Start(); $listener = $l; $port = $p; break } catch { $l.Close() }
}
if ($null -eq $listener) { Say-ToClawd 'CLAWD_HUB_ERROR:no-port'; exit 1 }

# 暗号：别的程序就算找到门牌号，没有暗号也进不来
$token = [Guid]::NewGuid().ToString('N')
$url = "http://127.0.0.1:$port/?t=$token"
Say-ToClawd ('CLAWD_HUB:{"port":' + $port + '}')
Say-ToClawd "CLAWD_HUB_URL:$url" # Clawd 记住它：窗口被关掉后可以再打开

# ---------- 2. 打开店面 ----------
if (-not $NoBrowser) { Open-Window $url }

# ---------- 3. 柜台营业 ----------
$page = Join-Path $Root 'tools\hub\index.html'
$started = [DateTime]::UtcNow
$lastSeen = [DateTime]::MinValue
$utf8 = New-Object Text.UTF8Encoding($false)

function Send($ctx, [int]$code, [string]$type, [string]$body) {
  $res = $ctx.Response
  $res.StatusCode = $code
  $res.Headers['Cache-Control'] = 'no-store'
  if ($type) { $res.ContentType = $type }
  $bytes = $utf8.GetBytes($body)
  $res.ContentLength64 = $bytes.Length
  if ($bytes.Length -gt 0) { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
  $res.Close()
}

$running = $true
while ($running) {
  $task = $listener.GetContextAsync()
  while (-not $task.Wait(1000)) {
    $now = [DateTime]::UtcNow
    # 店面一直没打开（60 秒）、或者很久没来看（150 秒，最小化太久浏览器会放慢）→ 关门
    if ($lastSeen -eq [DateTime]::MinValue -and ($now - $started).TotalSeconds -gt 60) { $running = $false; break }
    if ($lastSeen -ne [DateTime]::MinValue -and ($now - $lastSeen).TotalSeconds -gt 150) { $running = $false; break }
  }
  if (-not $running) { break }
  $ctx = $task.Result
  try {
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath
    if ($req.QueryString['t'] -ne $token) { Send $ctx 403 'text/plain' 'no'; continue }
    $lastSeen = [DateTime]::UtcNow

    if ($path -eq '/' -and $req.HttpMethod -eq 'GET') {
      Send $ctx 200 'text/html; charset=utf-8' ([IO.File]::ReadAllText($page, $utf8))
    } elseif ($path -eq '/state') {
      $json = '{}'
      if ($State -and (Test-Path $State)) { try { $json = [IO.File]::ReadAllText($State, $utf8) } catch { $json = '' } }
      if ($json -eq '') { Send $ctx 503 'text/plain' 'busy' } else { Send $ctx 200 'application/json; charset=utf-8' $json }
    } elseif ($path -eq '/action' -and $req.HttpMethod -eq 'POST') {
      $reader = New-Object IO.StreamReader($req.InputStream, $utf8)
      $body = $reader.ReadToEnd().Trim()
      $reader.Close()
      # 只收一行 JSON，换行去掉，免得传话被打断
      if ($body.StartsWith('{') -and $body.Length -lt 2000) { Say-ToClawd ('CLAWD_ACTION:' + ($body -replace '[\r\n]', ' ')) }
      Send $ctx 204 '' ''
    } elseif ($path -eq '/bye') {
      # 店面说要走了：可能是关窗口，也可能只是重新整理。10 秒内没再来就关门
      Send $ctx 204 '' ''
      $lastSeen = [DateTime]::UtcNow.AddSeconds(-140)
    } else {
      Send $ctx 404 'text/plain' 'not found'
    }
  } catch {
    try { $ctx.Response.Abort() } catch { }
  }
}
$listener.Stop()
Say-ToClawd 'CLAWD_HUB_CLOSED'
exit 0
