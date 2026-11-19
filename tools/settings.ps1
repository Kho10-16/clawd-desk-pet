# =====================================================================
# Clawd 设置窗口（Windows 原生窗口，用系统自带的 PowerShell + WinForms）
#
# 工作方式（像传纸条）：
#   1. Clawd 把"现在的设置"（JSON）从 stdin 递进来
#   2. 这里弹出窗口让你改
#   3. 按「保存」→ 把新设置印成一行 CLAWD_SETTINGS:{...} 递回给 Clawd
#      按「取消」或关掉窗口 → 什么都不递，设置不变
#
# 自己单独试：  '{}' | powershell -ExecutionPolicy Bypass -File tools\settings.ps1 -Root .
# =====================================================================

param([string]$Root = (Split-Path -Parent $PSScriptRoot), [switch]$SelfTest)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

# ---------- 1. 读进来现在的设置 ----------
$raw = [Console]::In.ReadToEnd()
try { $cur = $raw | ConvertFrom-Json } catch { $cur = $null }
if ($null -eq $cur) { $cur = [pscustomobject]@{} }

$defaults = [ordered]@{
  focus = $false; sound = $true; volume = 'mid'; longTaskSec = 30; sleepMin = 2
  speed = 'normal'; showText = $true; size = 'medium'; internStart = ''
}
function Get-Pref($name) {
  if ($cur.PSObject.Properties.Name -contains $name) { return $cur.$name }
  return $defaults[$name]
}

# 下拉选单的选项：[显示的字, 存起来的值]
$volumeOpts = @(@('低', 'low'), @('中', 'mid'), @('高', 'high'))
$longOpts   = @(@('10 秒', 10), @('30 秒', 30), @('1 分钟', 60), @('2 分钟', 120))
$sleepOpts  = @(@('1 分钟', 1), @('2 分钟', 2), @('5 分钟', 5), @('10 分钟', 10), @('永远不睡', 0))
$speedOpts  = @(@('慢', 'slow'), @('正常', 'normal'), @('快', 'fast'))
$sizeOpts   = @(@('小', 'small'), @('中', 'medium'), @('大', 'large'))

# ---------- 2. 画窗口 ----------
$font = New-Object Drawing.Font('Microsoft YaHei UI', 10)
$orange = [Drawing.Color]::FromArgb(217, 119, 87)

$form = New-Object Windows.Forms.Form
$form.Text = '🦀 Clawd 设置'
$form.Font = $font
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$form.AutoSize = $true
$form.AutoSizeMode = 'GrowAndShrink'
$form.Padding = New-Object Windows.Forms.Padding(16)
$form.BackColor = [Drawing.Color]::White

$grid = New-Object Windows.Forms.TableLayoutPanel
$grid.ColumnCount = 2
$grid.AutoSize = $true
$grid.Dock = 'Fill'
$grid.Padding = New-Object Windows.Forms.Padding(0)
$form.Controls.Add($grid)

function Add-Title($text) {
  $l = New-Object Windows.Forms.Label
  $l.Text = $text
  $l.AutoSize = $true
  $l.Font = New-Object Drawing.Font('Microsoft YaHei UI', 10.5, [Drawing.FontStyle]::Bold)
  $l.ForeColor = $orange
  $l.Margin = New-Object Windows.Forms.Padding(0, 10, 0, 4)
  $grid.Controls.Add($l)
  $grid.SetColumnSpan($l, 2)
}

function Add-Check($text, $value) {
  $c = New-Object Windows.Forms.CheckBox
  $c.Text = $text
  $c.Checked = [bool]$value
  $c.AutoSize = $true
  $c.Margin = New-Object Windows.Forms.Padding(0, 4, 0, 4)
  $grid.Controls.Add($c)
  $grid.SetColumnSpan($c, 2)
  return $c
}

function Add-Combo($label, $opts, $value) {
  $l = New-Object Windows.Forms.Label
  $l.Text = $label
  $l.AutoSize = $true
  $l.Anchor = 'Left'
  $l.Margin = New-Object Windows.Forms.Padding(0, 6, 16, 6)
  $cb = New-Object Windows.Forms.ComboBox
  $cb.DropDownStyle = 'DropDownList'
  $cb.Width = 150
  foreach ($o in $opts) { [void]$cb.Items.Add($o[0]) }
  $idx = 0
  for ($i = 0; $i -lt $opts.Count; $i++) { if ("$($opts[$i][1])" -eq "$value") { $idx = $i } }
  $cb.SelectedIndex = $idx
  $cb.Tag = $opts
  $grid.Controls.Add($l)
  $grid.Controls.Add($cb)
  return $cb
}

function Get-ComboValue($cb) { return $cb.Tag[$cb.SelectedIndex][1] }

Add-Title '🤫 打扰程度'
$focus    = Add-Check '专注模式（不说话、不弹提示、动画放慢）' (Get-Pref 'focus')
$showText = Add-Check '聊天框右上角显示文字' (Get-Pref 'showText')

Add-Title '🔔 提示音'
$sound  = Add-Check '开启提示音' (Get-Pref 'sound')
$volume = Add-Combo '音量' $volumeOpts (Get-Pref 'volume')
$long   = Add-Combo '完成音触发：任务超过' $longOpts (Get-Pref 'longTaskSec')

# 试听按钮：按当前选的音量播放
$tryBox = New-Object Windows.Forms.FlowLayoutPanel
$tryBox.AutoSize = $true
$tryBox.Margin = New-Object Windows.Forms.Padding(0, 2, 0, 2)
function New-TryButton($text, $sound) {
  $b = New-Object Windows.Forms.Button
  $b.Text = $text
  $b.AutoSize = $true
  $b.Add_Click({
    $file = Join-Path $Root ("sounds\{0}-{1}.wav" -f $sound, (Get-ComboValue $volume))
    if (Test-Path $file) { (New-Object Media.SoundPlayer $file).Play() }
  }.GetNewClosure())
  return $b
}
$tryBox.Controls.Add((New-TryButton '▶ 试听成就音' 'achievement'))
$tryBox.Controls.Add((New-TryButton '▶ 试听完成音' 'done'))
$tryBox.Controls.Add((New-TryButton '▶ 试听金币音' 'coin'))
$tryBox.Controls.Add((New-TryButton '▶ 试听提醒音' 'nudge'))
$grid.Controls.Add($tryBox)
$grid.SetColumnSpan($tryBox, 2)

Add-Title '🦀 Clawd 的样子'
$speed = Add-Combo '动画速度' $speedOpts (Get-Pref 'speed')
$size  = Add-Combo '聊天框上方的大小' $sizeOpts (Get-Pref 'size')
$sleep = Add-Combo '多久没动静就睡觉' $sleepOpts (Get-Pref 'sleepMin')

Add-Title '📋 周报'
$lblIntern = New-Object Windows.Forms.Label
$lblIntern.Text = '实习开始日期'
$lblIntern.AutoSize = $true
$lblIntern.Anchor = 'Left'
$lblIntern.Margin = New-Object Windows.Forms.Padding(0, 6, 16, 6)
$intern = New-Object Windows.Forms.TextBox
$intern.Width = 150
$intern.Text = [string](Get-Pref 'internStart')
$grid.Controls.Add($lblIntern)
$grid.Controls.Add($intern)
$hint = New-Object Windows.Forms.Label
$hint.Text = '格式像 2026-10-06，留空 = 不设'
$hint.AutoSize = $true
$hint.ForeColor = [Drawing.Color]::Gray
$grid.Controls.Add($hint)
$grid.SetColumnSpan($hint, 2)

# ---------- 3. 底部按钮 ----------
$bar = New-Object Windows.Forms.FlowLayoutPanel
$bar.FlowDirection = 'RightToLeft'
$bar.AutoSize = $true
$bar.Dock = 'Fill'
$bar.Margin = New-Object Windows.Forms.Padding(0, 16, 0, 0)

$save = New-Object Windows.Forms.Button
$save.Text = '保存'
$save.AutoSize = $true
$save.BackColor = $orange
$save.ForeColor = [Drawing.Color]::White
$save.FlatStyle = 'Flat'

$cancel = New-Object Windows.Forms.Button
$cancel.Text = '取消'
$cancel.AutoSize = $true
$cancel.DialogResult = 'Cancel'

$reset = New-Object Windows.Forms.Button
$reset.Text = '恢复默认'
$reset.AutoSize = $true

$bar.Controls.Add($save)
$bar.Controls.Add($cancel)
$bar.Controls.Add($reset)
$grid.Controls.Add($bar)
$grid.SetColumnSpan($bar, 2)
$form.AcceptButton = $save
$form.CancelButton = $cancel

function Set-Combo($cb, $value) {
  for ($i = 0; $i -lt $cb.Tag.Count; $i++) { if ("$($cb.Tag[$i][1])" -eq "$value") { $cb.SelectedIndex = $i } }
}

$reset.Add_Click({
  $focus.Checked = $defaults.focus
  $showText.Checked = $defaults.showText
  $sound.Checked = $defaults.sound
  Set-Combo $volume $defaults.volume
  Set-Combo $long $defaults.longTaskSec
  Set-Combo $speed $defaults.speed
  Set-Combo $size $defaults.size
  Set-Combo $sleep $defaults.sleepMin
  $intern.Text = ''
})

$script:result = $null
$save.Add_Click({
  $d = $intern.Text.Trim()
  if ($d -ne '' -and $d -notmatch '^\d{4}-\d{2}-\d{2}$') {
    [void][Windows.Forms.MessageBox]::Show('实习开始日期的格式要像 2026-10-06', 'Clawd 设置', 'OK', 'Warning')
    return
  }
  $script:result = [ordered]@{
    focus       = $focus.Checked
    sound       = $sound.Checked
    volume      = Get-ComboValue $volume
    longTaskSec = [int](Get-ComboValue $long)
    sleepMin    = [int](Get-ComboValue $sleep)
    speed       = Get-ComboValue $speed
    showText    = $showText.Checked
    size        = Get-ComboValue $size
    internStart = $d
  }
  $form.Close()
})

# 窗口弹出来时放到最前面
# Claude 启动这个脚本时带着"隐藏窗口"的标记（为了不闪出命令行黑框），
# Windows 会把程序第一次显示的窗口藏起来。所以窗口出现后，再明确叫它显示一次。
Add-Type -Namespace ClawdWin -Name User32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
'@
$form.Add_Shown({
  [void][ClawdWin.User32]::ShowWindow($form.Handle, 5)  # 5 = SW_SHOW
  [void][ClawdWin.User32]::SetForegroundWindow($form.Handle)
  $form.Activate()
  if ($SelfTest) {
    # -SelfTest：报告窗口有没有真的看得见，然后自动按保存
    [Console]::Error.WriteLine("visible=" + [ClawdWin.User32]::IsWindowVisible($form.Handle))
    $save.PerformClick()
  }
})
[void]$form.ShowDialog()

# ---------- 4. 把结果递回给 Clawd ----------
if ($null -ne $script:result) {
  $json = $script:result | ConvertTo-Json -Compress
  [Console]::Out.WriteLine('CLAWD_SETTINGS:' + $json)
  exit 0
}
exit 1
