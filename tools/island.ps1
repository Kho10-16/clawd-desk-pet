# =====================================================================
# 桌面灵动岛：屏幕顶部正中间的一颗小黑药丸
#   平时：左边小 Clawd，右边番茄钟倒计时 / 心情
#   点一下：弹性展开成大卡片（状态、Clawd 说的话、倒计时圈、按钮）
#   Claude 在等你回复时：药丸变成橙色字提醒你
#
# 数据：Clawd 把一小份状态写进 -State 文件，这里每 0.5 秒看一眼
# 按钮：印一行 CLAWD_ACTION:{...} 给 Clawd（和 Clawd 中心同一套）
# 只会有一颗：开好几个聊天也只有第一个能开（用一把"锁"Mutex）
#
# 参数：-State 状态文件  -SelfTest 截图测试（-Shot 文件夹）
# =====================================================================

param([string]$State = '', [switch]$SelfTest, [string]$Shot = '')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

# 只能有一颗灵动岛
$mutex = New-Object Threading.Mutex($false, 'Local\ClawdIsland')
if (-not $mutex.WaitOne(0)) { [Console]::Out.WriteLine('CLAWD_ISLAND_BUSY'); exit 0 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ClawdIsland {
  public class Island : Form {
    // ---------- Windows 的"分层窗口"：每个像素的透明度我们自己画 ----------
    [StructLayout(LayoutKind.Sequential)] struct PT { public int x, y; public PT(int a, int b) { x = a; y = b; } }
    [StructLayout(LayoutKind.Sequential)] struct SZ { public int cx, cy; public SZ(int a, int b) { cx = a; cy = b; } }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] struct BLEND { public byte op, flags, alpha, format; }
    [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr h, IntPtr dst, ref PT pos, ref SZ size, IntPtr src, ref PT srcPos, int key, ref BLEND b, int flags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    protected override CreateParams CreateParams {
      get {
        CreateParams cp = base.CreateParams;
        cp.ExStyle |= 0x80000 | 0x80 | 0x8 | 0x08000000; // 分层 | 不进任务栏 | 永远在最上面 | 点它不抢焦点
        return cp;
      }
    }
    protected override bool ShowWithoutActivation { get { return true; } }

    // ---------- 状态（PowerShell 那边读文件后填进来） ----------
    public string Mood = "idle", MoodLabel = "发呆", Say = "", Phase = "idle", Kind = "adult", Task = "";
    public int Lv = 1;
    public long EndsAt = 0, Skew = 0;       // 番茄钟结束时间（Clawd 的时钟）、两边时钟差
    public int WholeMs = 25 * 60000;        // 这一段一共多久（画圆圈用）
    public bool Online = true;

    float S = 1f;
    float t = 0f, target = 0f;              // 0 = 收起，1 = 展开
    Timer anim, clock;
    Point mouse = new Point(-1, -1);
    RectangleF[] btnRects = new RectangleF[0];
    string[] btnActs = new string[0];
    const int M = 14;                       // 阴影留的边

    static readonly string[] ADULT = { "..XXXXXXXXX..", "..XXXXXXXXX..", "..XXEXXXEXX..", "..XXEXXXEXX..", "LLXXXXXXXXXRR", "..XXXXXXXXX..", "...A.B.A.B...", "...A.B.A.B..." };
    static readonly string[] BABY = { "...XXXXXXX...", "...XEXXXEX...", "...XEXXXEX...", "...XXXXXXX...", "...A.B.A.B..." };

    public Island() {
      try { SetProcessDPIAware(); } catch { }
      using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) S = g.DpiX / 96f;
      FormBorderStyle = FormBorderStyle.None;
      ShowInTaskbar = false;
      TopMost = true;
      StartPosition = FormStartPosition.Manual;
      Text = "Clawd 灵动岛";
      anim = new Timer(); anim.Interval = 15;
      anim.Tick += delegate {
        float d = target - t;
        if (Math.Abs(d) < 0.01f) { t = target; anim.Stop(); } else t += d * 0.22f;
        Render();
      };
      clock = new Timer(); clock.Interval = 1000;
      clock.Tick += delegate { Render(); };
      clock.Start();
      MouseClick += OnClickIsland;
      MouseMove += delegate (object o, MouseEventArgs e) { mouse = e.Location; if (t > 0.5f) Render(); };
      MouseLeave += delegate { mouse = new Point(-1, -1); if (t > 0.5f) Render(); };
    }

    public bool Expanded { get { return target > 0.5f; } set { target = value ? 1f : 0f; anim.Start(); } }

    int P(float v) { return (int)Math.Round(v * S); }
    static float Lerp(float a, float b, float k) { return a + (b - a) * k; }
    // 弹一下的缓动（超过一点再回来，像果冻）
    static float Spring(float k) { float c = 1.55f; float x = k - 1f; return 1f + (c + 1f) * x * x * x + c * x * x; }

    long LeftMs() {
      long nowMs = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds + Skew;
      return Math.Max(0, EndsAt - nowMs);
    }
    string LeftText() { long l = LeftMs(); return string.Format("{0}:{1:00}", l / 60000, (l % 60000) / 1000); }

    static GraphicsPath Pill(RectangleF r, float rad) {
      GraphicsPath p = new GraphicsPath();
      float d = Math.Min(rad * 2, Math.Min(r.Width, r.Height));
      p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
      p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
      p.CloseFigure(); return p;
    }

    void DrawClawd(Graphics g, float x, float y, float cell, int alpha) {
      string[] sp = Kind == "baby" ? BABY : ADULT;
      bool shut = Mood == "sleepy" || Mood == "love" || Mood == "hungry" || Mood == "oops";
      using (SolidBrush ob = new SolidBrush(Color.FromArgb(alpha, 217, 119, 87)))
      using (SolidBrush eb = new SolidBrush(Color.FromArgb(alpha, 20, 20, 20))) {
        for (int r = 0; r < sp.Length; r++) {
          for (int c = 0; c < sp[r].Length; c++) {
            char ch = sp[r][c];
            if (ch == '.') continue;
            bool eye = ch == 'E';
            // 闭眼：眼睛上面那格涂成身体色，只留下面一条线
            bool isTopEye = eye && r + 1 < sp.Length && sp[r + 1][c] == 'E';
            Brush b = eye && !(shut && isTopEye) ? eb : ob;
            g.FillRectangle(b, x + c * cell, y + r * cell, cell + 0.4f, cell + 0.4f);
          }
        }
      }
    }

    void Write(Graphics g, string s, float size, FontStyle st, Color c, RectangleF r, StringAlignment h) {
      using (Font f = new Font("Microsoft YaHei UI", size, st, GraphicsUnit.Point))
      using (SolidBrush b = new SolidBrush(c))
      using (StringFormat sf = new StringFormat()) {
        sf.Alignment = h; sf.LineAlignment = StringAlignment.Center; sf.Trimming = StringTrimming.EllipsisCharacter;
        sf.FormatFlags = StringFormatFlags.NoWrap;
        g.DrawString(s, f, b, r, sf);
      }
    }

    Color Accent() {
      if (Mood == "waiting") return Color.FromArgb(255, 159, 10);
      if (Phase == "focus") return Color.FromArgb(255, 107, 94);
      if (Phase == "break") return Color.FromArgb(48, 209, 88);
      return Color.FromArgb(200, 200, 205);
    }

    string Title() {
      if (Mood == "waiting") return "Claude 在等你回复";
      if (Phase == "focus") return Task.Length > 0 ? "专注中 · " + Task : "专注中";
      if (Phase == "break") return "休息一下";
      return "Lv." + Lv + " · " + MoodLabel;
    }

    public void Render() {
      if (!IsHandleCreated) return;
      float k = Spring(Math.Max(0f, Math.Min(1f, t)));
      float w = Lerp(P(200), P(380), k), h = Lerp(P(36), P(132), k), rad = Lerp(h / 2f, P(34), Math.Min(1f, t * 1.4f));
      int W = (int)Math.Ceiling(Math.Max(w, P(200))) + P(M) * 2, H = (int)Math.Ceiling(Math.Max(h, P(36))) + P(M) * 2;
      Rectangle scr = Screen.PrimaryScreen.WorkingArea;
      int X = scr.Left + (scr.Width - W) / 2, Y = scr.Top + P(6) - P(M) / 2;

      using (Bitmap bmp = new Bitmap(W, H, PixelFormat.Format32bppPArgb))
      using (Graphics g = Graphics.FromImage(bmp)) {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit; // 透明背景上只能用灰阶抗锯齿
        g.Clear(Color.Transparent);
        float ox = (W - w) / 2f, oy = P(M) / 2f;
        RectangleF pill = new RectangleF(ox, oy, w, h);
        // 柔和的影子
        for (int i = 6; i >= 1; i--) {
          using (GraphicsPath sp = Pill(new RectangleF(pill.X - i * S, pill.Y - i * S * 0.4f + P(3), pill.Width + i * 2 * S, pill.Height + i * 2 * S), rad + i * S))
          using (SolidBrush sb = new SolidBrush(Color.FromArgb(10, 0, 0, 0))) g.FillPath(sb, sp);
        }
        using (GraphicsPath p = Pill(pill, rad)) {
          using (SolidBrush black = new SolidBrush(Color.FromArgb(Online ? 255 : 200, 0, 0, 0))) g.FillPath(black, p);
          g.SetClip(p);

          // ----- 收起时的内容 -----
          int a1 = (int)(255 * Math.Max(0f, 1f - t * 2.2f));
          if (a1 > 0) {
            float cell = P(2.1f);
            DrawClawd(g, pill.X + P(14), pill.Y + (h - (Kind == "baby" ? 5 : 8) * cell) / 2f, cell, a1);
            string right = Mood == "waiting" ? "等你回复" : Phase != "idle" ? LeftText() : MoodLabel;
            Color ac = Accent();
            Write(g, right, 10f, FontStyle.Bold, Color.FromArgb(a1, ac), new RectangleF(pill.X + P(50), pill.Y, w - P(64), h), StringAlignment.Far);
            if (Phase != "idle" && Mood != "waiting") {
              // 番茄 / 水杯 小圆点
              using (SolidBrush db = new SolidBrush(Color.FromArgb(a1, ac))) g.FillEllipse(db, pill.Right - P(14) - P(62), pill.Y + h / 2f - P(4), P(8), P(8));
            }
          }

          // ----- 展开后的内容 -----
          int a2 = (int)(255 * Math.Max(0f, Math.Min(1f, (t - 0.45f) * 2.2f)));
          btnRects = new RectangleF[0]; btnActs = new string[0];
          if (a2 > 0) {
            float cell = P(4.6f);
            float cy = pill.Y + P(22);
            DrawClawd(g, pill.X + P(22), cy + (Kind == "baby" ? P(8) : 0), cell, a2);
            float tx = pill.X + P(22) + 13 * cell + P(14);
            bool ring = Phase != "idle";
            float textW = pill.Right - tx - (ring ? P(84) : P(22));
            Write(g, Title(), 11.5f, FontStyle.Bold, Mood == "waiting" ? Color.FromArgb(a2, Accent()) : Color.FromArgb(a2, 255, 255, 255), new RectangleF(tx, cy - P(2), textW, P(24)), StringAlignment.Near);
            Write(g, Say, 9f, FontStyle.Regular, Color.FromArgb(a2 * 6 / 10, 255, 255, 255), new RectangleF(tx, cy + P(22), textW, P(20)), StringAlignment.Near);
            if (ring) {
              float d = P(56), rx = pill.Right - P(22) - d, ry = pill.Y + P(16);
              float frac = WholeMs > 0 ? 1f - (float)LeftMs() / WholeMs : 0f;
              using (Pen bg = new Pen(Color.FromArgb(a2 * 15 / 100, 255, 255, 255), P(5)))
              using (Pen fg = new Pen(Color.FromArgb(a2, Accent()), P(5))) {
                fg.StartCap = LineCap.Round; fg.EndCap = LineCap.Round;
                g.DrawEllipse(bg, rx, ry, d, d);
                if (frac > 0.002f) g.DrawArc(fg, rx, ry, d, d, -90, 360f * frac);
              }
              Write(g, LeftText(), 9.5f, FontStyle.Bold, Color.FromArgb(a2, 255, 255, 255), new RectangleF(rx - P(4), ry, d + P(8), d), StringAlignment.Center);
            }
            // 按钮
            string[][] btns = Phase == "focus" ? new string[][] { new[] { "停止番茄", "pomo-stop" }, new[] { "打开 Clawd 中心", "hub" }, new[] { "收起", "close" } }
              : Phase == "break" ? new string[][] { new[] { "下一个番茄", "pomo-start" }, new[] { "结束", "pomo-end" }, new[] { "打开 Clawd 中心", "hub" } }
              : new string[][] { new[] { "开始番茄", "pomo-start" }, new[] { "打开 Clawd 中心", "hub" }, new[] { "收起", "close" } };
            float bx = pill.X + P(18), by = pill.Bottom - P(44), bw = (w - P(36) - P(8) * (btns.Length - 1)) / btns.Length, bh = P(30);
            btnRects = new RectangleF[btns.Length]; btnActs = new string[btns.Length];
            for (int i = 0; i < btns.Length; i++) {
              RectangleF r = new RectangleF(bx + i * (bw + P(8)), by, bw, bh);
              btnRects[i] = r; btnActs[i] = btns[i][1];
              bool hover = r.Contains(mouse);
              using (GraphicsPath bp = Pill(r, bh / 2f))
              using (SolidBrush bb = new SolidBrush(Color.FromArgb(a2 * (hover ? 30 : 16) / 100, 255, 255, 255))) g.FillPath(bb, bp);
              Write(g, btns[i][0], 9f, FontStyle.Bold, Color.FromArgb(a2, 255, 255, 255), r, StringAlignment.Center);
            }
          }
          g.ResetClip();
        }
        Push(bmp, X, Y);
      }
    }

    void Push(Bitmap bmp, int x, int y) {
      IntPtr screen = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(screen);
      IntPtr hb = bmp.GetHbitmap(Color.FromArgb(0)), old = SelectObject(mem, hb);
      try {
        PT pos = new PT(x, y), src = new PT(0, 0); SZ size = new SZ(bmp.Width, bmp.Height);
        BLEND b = new BLEND(); b.op = 0; b.flags = 0; b.alpha = 255; b.format = 1;
        if (Bounds != new Rectangle(x, y, bmp.Width, bmp.Height)) SetBounds(x, y, bmp.Width, bmp.Height);
        UpdateLayeredWindow(Handle, screen, ref pos, ref size, mem, ref src, 0, ref b, 2);
      } finally {
        SelectObject(mem, old); DeleteObject(hb); DeleteDC(mem); ReleaseDC(IntPtr.Zero, screen);
      }
    }

    void Say2(string json) { Console.Out.WriteLine("CLAWD_ACTION:" + json); Console.Out.Flush(); }

    void OnClickIsland(object o, MouseEventArgs e) {
      if (e.Button == MouseButtons.Right) {
        ContextMenuStrip m = new ContextMenuStrip();
        m.Items.Add("打开 Clawd 中心", null, delegate { Say2("{\"type\":\"open\",\"what\":\"hub\"}"); });
        m.Items.Add("隐藏灵动岛（可在设置里再打开）", null, delegate { Say2("{\"type\":\"island-off\"}"); });
        m.Show(this, e.Location);
        return;
      }
      if (t > 0.5f) {
        for (int i = 0; i < btnRects.Length; i++) {
          if (!btnRects[i].Contains(e.Location)) continue;
          string a = btnActs[i];
          if (a == "close") { Expanded = false; return; }
          if (a == "hub") Say2("{\"type\":\"open\",\"what\":\"hub\"}");
          else Say2("{\"type\":\"" + a + "\"}");
          Expanded = false;
          return;
        }
      }
      Expanded = !Expanded;
    }
  }
}
'@

# ---------- 读状态文件 → 填进灵动岛 ----------
$island = New-Object ClawdIsland.Island
$script:lastText = ''
$script:lastSeen = [DateTime]::UtcNow
function Read-State {
  if (-not $State -or -not (Test-Path $State)) { return }
  try {
    $fs = [IO.File]::Open($State, 'Open', 'Read', 'ReadWrite')
    $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)
    $text = $sr.ReadToEnd(); $sr.Close()
  } catch { return }
  if ($text -eq $script:lastText -or $text.Length -lt 2) { return }
  try { $s = $text | ConvertFrom-Json } catch { return }
  $script:lastText = $text
  if ($s.quit) { $island.Close(); return } # Clawd 说：设置里关掉灵动岛了
  $nowMs = [long]([DateTime]::UtcNow - [DateTime]'1970-01-01').TotalMilliseconds
  $island.Skew = [long]$s.now - $nowMs
  $island.Mood = [string]$s.mood
  $island.MoodLabel = [string]$s.moodLabel
  $island.Say = [string]$s.say
  $island.Task = [string]$s.task
  $island.Lv = [int]$s.lv
  $island.Kind = if ($s.form -eq 'baby') { 'baby' } else { 'adult' }
  $island.Phase = [string]$s.pomo.phase
  $island.EndsAt = [long]$s.pomo.endsAt
  $island.WholeMs = [int]$s.pomo.wholeMs
  $wasWaiting = $script:waiting
  $script:waiting = ($s.mood -eq 'waiting')
  # Claude 在等你回复：自动展开 6 秒提醒你
  if ($script:waiting -and -not $wasWaiting) {
    $island.Expanded = $true
    $script:autoCloseAt = [DateTime]::UtcNow.AddSeconds(6)
  }
  $island.Render()
}
$script:waiting = $false
$script:autoCloseAt = [DateTime]::MaxValue

$poll = New-Object Windows.Forms.Timer
$poll.Interval = 500
$poll.Add_Tick({
  Read-State
  if ([DateTime]::UtcNow -gt $script:autoCloseAt) { $island.Expanded = $false; $script:autoCloseAt = [DateTime]::MaxValue }
})
$island.Add_Shown({
  Read-State
  $island.Render()
  $poll.Start()
  if ($SelfTest) {
    # 截图测试：收起 → 展开 → 结束
    $script:shots = New-Object Windows.Forms.Timer
    $script:step = 0
    $script:shots.Interval = 900
    $script:shots.Add_Tick({
      $script:step++
      $b = $island.Bounds
      if ($Shot -ne '') {
        $bmp = New-Object Drawing.Bitmap($b.Width, $b.Height)
        $g = [Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($b.Location, [Drawing.Point]::Empty, $b.Size)
        $bmp.Save((Join-Path $Shot "island$($script:step).png"), [Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose()
      }
      if ($script:step -eq 1) { $island.Expanded = $true }
      if ($script:step -ge 2) { $script:shots.Stop(); $island.Close() }
    })
    $script:shots.Start()
  }
})
[Console]::Out.WriteLine('CLAWD_ISLAND_READY'); [Console]::Out.Flush()
[Windows.Forms.Application]::Run($island)
$mutex.ReleaseMutex()
exit 0
