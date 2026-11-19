# =====================================================================
# 桌面桌宠：一只可以随便拖来拖去的像素 Clawd + 对话泡泡
#
# 画法：Clawd 把它的像素画（和聊天框上方那只一模一样，装扮、睡衣、番茄都在）
#       拆成一个个方块/圆/文字，写进 -State 文件；这里照着画，再自己加上动作：
#       发呆轻轻上下、干活快快点头、开心跳、睡觉慢慢呼吸、眨眼……
# 操作：拖动 = 换位置（会记住）；单击 = 摸头；双击 = 打开 Clawd 中心；右键 = 菜单
# 只会有一只：开好几个聊天也只有第一个能开（Mutex 锁）
#
# 参数：-State 状态文件  -SelfTest 截图测试（-Shot 文件夹）
# =====================================================================

param([string]$State = '', [switch]$SelfTest, [string]$Shot = '')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$mutex = New-Object Threading.Mutex($false, 'Local\ClawdDesktopPet')
if (-not $mutex.WaitOne(0)) { [Console]::Out.WriteLine('CLAWD_PET_BUSY'); exit 0 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ClawdPet {
  public class Pet : Form {
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
      get { CreateParams cp = base.CreateParams; cp.ExStyle |= 0x80000 | 0x80 | 0x8 | 0x08000000; return cp; }
    }
    protected override bool ShowWithoutActivation { get { return true; } }

    // ---------- Clawd 递过来的东西 ----------
    public string Mood = "idle";
    public float Unit = 8f;        // SVG 里的 1 格 = 几个像素
    public float Tempo = 1f;       // 动作快慢（越大越慢）
    public bool ShowText = true;
    public string PosFile = "";
    string say = "";
    List<string[]> shapes = new List<string[]>();

    float S = 1f;
    Timer frame;
    DateTime start = DateTime.UtcNow, bubbleUntil = DateTime.MinValue, squishAt = DateTime.MinValue;
    int ax = int.MinValue, ay = 0;  // Clawd 左上角在屏幕上的位置（拖动改的就是它）
    bool down, dragging, hover;
    Point downAt, grab;
    int x0, y0;                     // Clawd 在窗口里的位置
    Rectangle petRect;              // 窗口里 Clawd 占的地方（判断点到的是不是它）

    public Pet() {
      try { SetProcessDPIAware(); } catch { }
      using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) S = g.DpiX / 96f;
      FormBorderStyle = FormBorderStyle.None;
      ShowInTaskbar = false; TopMost = true; StartPosition = FormStartPosition.Manual;
      Text = "Clawd";
      frame = new Timer(); frame.Interval = 66; // 一秒 15 张，像素画够用了
      frame.Tick += delegate { Render(); };
      MouseDown += OnDown; MouseMove += OnMove; MouseUp += OnUp;
      MouseDoubleClick += delegate (object o, MouseEventArgs e) { if (e.Button == MouseButtons.Left) Act("{\"type\":\"open\",\"what\":\"hub\"}"); };
      MouseEnter += delegate { hover = true; };
      MouseLeave += delegate { hover = false; };
    }

    public void Begin() { LoadPos(); frame.Start(); Render(); }

    // ---------- 状态 ----------
    public void SetShapes(string packed) {
      List<string[]> list = new List<string[]>();
      foreach (string line in packed.Split('\n')) { if (line.Length > 0) list.Add(line.Split('|')); }
      shapes = list;
    }
    public void SetSay(string s, bool popUp) {
      if (s == say) return;
      say = s;
      if (popUp && s.Length > 0) bubbleUntil = DateTime.UtcNow.AddSeconds(Math.Min(12, 5 + s.Length / 6.0));
    }

    void Act(string json) { Console.Out.WriteLine("CLAWD_ACTION:" + json); Console.Out.Flush(); }

    // ---------- 位置：记住你把它放在哪 ----------
    void LoadPos() {
      Rectangle wa = Screen.PrimaryScreen.WorkingArea;
      ax = wa.Right - (int)(15 * Unit * S) - P(40);
      ay = wa.Bottom - (int)(13 * Unit * S) - P(8);
      try {
        if (PosFile != "" && File.Exists(PosFile)) {
          string[] xy = File.ReadAllText(PosFile).Trim().Split(',');
          ax = int.Parse(xy[0]); ay = int.Parse(xy[1]);
        }
      } catch { }
      Clamp();
    }
    void SavePos() { try { if (PosFile != "") File.WriteAllText(PosFile, ax + "," + ay); } catch { } }
    void Clamp() {
      // 别让它跑到所有屏幕外面（例如拔掉了第二个屏幕）
      Rectangle v = SystemInformation.VirtualScreen;
      int w = (int)(15 * Unit * S), h = (int)(13 * Unit * S);
      ax = Math.Max(v.Left - w / 2, Math.Min(ax, v.Right - w / 2));
      ay = Math.Max(v.Top, Math.Min(ay, v.Bottom - h / 2));
    }

    // ---------- 鼠标 ----------
    void OnDown(object o, MouseEventArgs e) {
      if (e.Button == MouseButtons.Right) { ShowMenu(e.Location); return; }
      if (e.Button != MouseButtons.Left) return;
      down = true; dragging = false; downAt = Cursor.Position; grab = new Point(Cursor.Position.X - ax, Cursor.Position.Y - ay);
    }
    void OnMove(object o, MouseEventArgs e) {
      if (!down) return;
      Point c = Cursor.Position;
      if (!dragging && (Math.Abs(c.X - downAt.X) > P(4) || Math.Abs(c.Y - downAt.Y) > P(4))) dragging = true;
      if (dragging) { ax = c.X - grab.X; ay = c.Y - grab.Y; Render(); }
    }
    void OnUp(object o, MouseEventArgs e) {
      if (e.Button != MouseButtons.Left || !down) return;
      down = false;
      if (dragging) { dragging = false; Clamp(); SavePos(); return; }
      if (petRect.Contains(e.Location)) { squishAt = DateTime.UtcNow; Act("{\"type\":\"pat\"}"); }
      else bubbleUntil = DateTime.MinValue; // 点泡泡 = 关掉泡泡
    }
    void ShowMenu(Point at) {
      ContextMenuStrip m = new ContextMenuStrip();
      m.Items.Add("摸摸头", null, delegate { squishAt = DateTime.UtcNow; Act("{\"type\":\"pat\"}"); });
      m.Items.Add("喂小鱼干", null, delegate { Act("{\"type\":\"feed\",\"id\":\"fish\"}"); });
      m.Items.Add("番茄钟 开始 / 停止", null, delegate { Act("{\"type\":\"pomo-toggle\"}"); });
      m.Items.Add("打开 Clawd 中心", null, delegate { Act("{\"type\":\"open\",\"what\":\"hub\"}"); });
      m.Items.Add(new ToolStripSeparator());
      m.Items.Add("放回聊天框上方", null, delegate { Act("{\"type\":\"pet-where\",\"where\":\"chat\"}"); });
      m.Show(this, at);
    }

    int P(float v) { return (int)Math.Round(v * S); }
    static float F(string s) { float v; return float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : 0f; }
    static Color C(string s, float op) {
      Color c;
      try { c = ColorTranslator.FromHtml(s); } catch { c = Color.Gray; }
      return Color.FromArgb((int)(Math.Max(0f, Math.Min(1f, op)) * 255), c);
    }

    // ---------- 每种心情的身体动作（单位：格） ----------
    void Motion(double sec, out float dx, out float dy, out float sx, out float sy) {
      double tp = sec / Tempo;
      dx = 0; dy = 0; sx = 1; sy = 1;
      switch (Mood) {
        case "working": dy = (float)(-0.35 * Math.Abs(Math.Sin(tp * Math.PI * 2.4))); break;
        case "happy": { double k = (tp % 0.9) / 0.9; dy = (float)(-2.0 * Math.Sin(Math.PI * Math.Min(1, k / 0.6))); if (k > 0.6) dy = 0; break; }
        case "sleepy": sy = (float)(1 + 0.03 * Math.Sin(tp * Math.PI * 0.6)); break;
        case "love": dx = (float)(0.35 * Math.Sin(tp * Math.PI * 2)); break;
        case "waiting": dy = (float)(-0.8 * Math.Abs(Math.Sin(tp * Math.PI * 1.6))); break;
        case "oops": dx = (float)(0.3 * Math.Sin(tp * Math.PI * 12)); break;
        case "thinking": dx = (float)(0.25 * Math.Sin(tp * Math.PI * 0.8)); break;
        default: dy = (float)(-0.25 * (1 - Math.Cos(tp * Math.PI * 0.9)) ); break; // 发呆：轻轻上下
      }
      // 摸头：压扁一下再弹回来
      double since = (DateTime.UtcNow - squishAt).TotalSeconds;
      if (since < 0.45) { double k = since / 0.45; float q = (float)(Math.Sin(k * Math.PI) * (1 - k)); sy *= 1 - 0.22f * q; sx *= 1 + 0.12f * q; }
    }

    // ---------- 画一张 ----------
    public void Render() {
      if (!IsHandleCreated || ax == int.MinValue) return;
      float u = Unit * S;
      int cw = (int)Math.Ceiling(15 * u), ch = (int)Math.Ceiling(13 * u);
      bool showBubble = ShowText && say.Length > 0 && (DateTime.UtcNow < bubbleUntil || hover || Mood == "waiting");

      // 泡泡多大
      Font bf = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
      SizeF ts = SizeF.Empty;
      int bw = 0, bh = 0, tail = P(9);
      if (showBubble) {
        using (Bitmap tmp = new Bitmap(1, 1)) using (Graphics mg = Graphics.FromImage(tmp)) ts = mg.MeasureString(say, bf, P(210));
        bw = (int)Math.Ceiling(ts.Width) + P(24); bh = (int)Math.Ceiling(ts.Height) + P(16);
      }
      int m = P(6);
      int W = Math.Max(cw, bw) + m * 2, H = (showBubble ? bh + tail : 0) + ch + m * 2 + P(6);
      x0 = (W - cw) / 2; y0 = H - m - ch;
      petRect = new Rectangle(x0, y0, cw, ch);

      using (Bitmap bmp = new Bitmap(W, H, PixelFormat.Format32bppPArgb))
      using (Graphics g = Graphics.FromImage(bmp)) {
        g.Clear(Color.Transparent);
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

        // 对话泡泡：白色圆角 + 小尾巴指向 Clawd
        if (showBubble) {
          g.SmoothingMode = SmoothingMode.AntiAlias;
          RectangleF br = new RectangleF((W - bw) / 2f, m, bw, bh);
          using (GraphicsPath p = Bubble(br, P(12), tail)) {
            using (GraphicsPath sh = (GraphicsPath)p.Clone()) {
              using (Matrix mt = new Matrix()) { mt.Translate(0, P(2)); sh.Transform(mt); }
              using (SolidBrush sb = new SolidBrush(Color.FromArgb(40, 0, 0, 0))) g.FillPath(sb, sh);
            }
            g.FillPath(Brushes.White, p);
            using (Pen pen = new Pen(Color.FromArgb(40, 0, 0, 0), Math.Max(1f, S))) g.DrawPath(pen, p);
          }
          using (SolidBrush tb = new SolidBrush(Color.FromArgb(28, 28, 30)))
          using (StringFormat sf = new StringFormat()) {
            sf.Alignment = StringAlignment.Center; sf.LineAlignment = StringAlignment.Center;
            g.DrawString(say, bf, tb, new RectangleF(br.X + P(12), br.Y + P(8), br.Width - P(24), br.Height - P(16)), sf);
          }
        }

        // Clawd：照着 SVG 的方块画（坐标系：viewBox -1 -4 15 13）
        double sec = (DateTime.UtcNow - start).TotalSeconds;
        float dx, dy, sx, sy;
        Motion(sec, out dx, out dy, out sx, out sy);
        bool blink = Mood != "sleepy" && (sec % 4.2) < 0.13;
        GraphicsState gs = g.Save();
        g.TranslateTransform(x0 + (1 + dx) * u, y0 + (4 + dy) * u);
        // 压扁 / 呼吸：以脚底中间为中心
        g.TranslateTransform(6.5f * u, 8f * u); g.ScaleTransform(sx, sy); g.TranslateTransform(-6.5f * u, -8f * u);
        g.ScaleTransform(u, u);
        foreach (string[] s in shapes) DrawShape(g, s, blink);
        g.Restore(gs);
        bf.Dispose();
        Push(bmp, ax - x0, ay - y0);
      }
    }

    GraphicsPath Bubble(RectangleF r, float rad, float tail) {
      GraphicsPath p = new GraphicsPath();
      float d = rad * 2, cx = r.X + r.Width / 2f;
      p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
      p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
      p.AddLine(cx + tail * 0.8f, r.Bottom, cx, r.Bottom + tail); p.AddLine(cx, r.Bottom + tail, cx - tail * 0.8f, r.Bottom);
      p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
      p.CloseFigure(); return p;
    }

    void DrawShape(Graphics g, string[] s, bool blink) {
      try {
        switch (s[0]) {
          case "r": {
            // r|x|y|w|h|fill|opacity|rx
            float x = F(s[1]), y = F(s[2]), w = F(s[3]), h = F(s[4]), rx = s.Length > 7 ? F(s[7]) : 0;
            if (blink && s[5].ToLower() == "#1a1a1a") { y += h * 0.8f; h *= 0.2f; } // 眨眼
            g.SmoothingMode = rx > 0 ? SmoothingMode.AntiAlias : SmoothingMode.None;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            using (SolidBrush b = new SolidBrush(C(s[5], F(s[6])))) {
              if (rx > 0) using (GraphicsPath p = Rounded(new RectangleF(x, y, w, h), rx)) g.FillPath(b, p);
              else g.FillRectangle(b, x, y, w, h);
            }
            break;
          }
          case "c": {
            // c|cx|cy|rx|ry|fill|stroke|strokeWidth|opacity
            float cx = F(s[1]), cy = F(s[2]), rx = F(s[3]), ry = F(s[4]), op = F(s[8]);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            if (s[5] != "none" && s[5] != "") using (SolidBrush b = new SolidBrush(C(s[5], op))) g.FillEllipse(b, cx - rx, cy - ry, rx * 2, ry * 2);
            if (s[6] != "none" && s[6] != "") using (Pen pen = new Pen(C(s[6], op), F(s[7]))) g.DrawEllipse(pen, cx - rx, cy - ry, rx * 2, ry * 2);
            break;
          }
          case "l": {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (Pen pen = new Pen(C(s[5], 1f), F(s[6]))) g.DrawLine(pen, F(s[1]), F(s[2]), F(s[3]), F(s[4]));
            break;
          }
          case "t": {
            // t|x|y|size|fill|bold|text   （y 是文字的底线）
            float size = F(s[3]);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (Font f = new Font("Segoe UI Symbol", 10f, s[5] == "1" ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Pixel))
            using (SolidBrush b = new SolidBrush(C(s[4], 1f))) {
              GraphicsState st = g.Save();
              float k = size / 10f;
              g.TranslateTransform(F(s[1]), F(s[2]) - size * 0.95f);
              g.ScaleTransform(k, k);
              g.DrawString(s[6], f, b, 0, 0, StringFormat.GenericTypographic);
              g.Restore(st);
            }
            break;
          }
        }
      } catch { }
    }

    static GraphicsPath Rounded(RectangleF r, float rad) {
      GraphicsPath p = new GraphicsPath();
      float d = Math.Min(rad * 2, Math.Min(r.Width, r.Height));
      p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
      p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
      p.CloseFigure(); return p;
    }

    void Push(Bitmap bmp, int x, int y) {
      IntPtr screen = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(screen);
      IntPtr hb = bmp.GetHbitmap(Color.FromArgb(0)), old = SelectObject(mem, hb);
      try {
        PT pos = new PT(x, y), src = new PT(0, 0); SZ size = new SZ(bmp.Width, bmp.Height);
        BLEND b = new BLEND(); b.op = 0; b.flags = 0; b.alpha = 255; b.format = 1;
        if (Bounds != new Rectangle(x, y, bmp.Width, bmp.Height)) SetBounds(x, y, bmp.Width, bmp.Height);
        UpdateLayeredWindow(Handle, screen, ref pos, ref size, mem, ref src, 0, ref b, 2);
      } finally { SelectObject(mem, old); DeleteObject(hb); DeleteDC(mem); ReleaseDC(IntPtr.Zero, screen); }
    }
  }
}
'@

$pet = New-Object ClawdPet.Pet
if ($State) { $pet.PosFile = Join-Path (Split-Path -Parent $State) 'pet-pos.txt' }
$script:lastText = ''
$script:first = $true
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
  if ($s.quit) { $pet.Close(); return }
  $pet.Mood = [string]$s.mood
  $pet.Unit = [single]$s.unit
  $pet.Tempo = [single]$s.tempo
  $pet.ShowText = [bool]$s.showText
  $pet.SetShapes([string]$s.shapes)
  $pet.SetSay([string]$s.say, -not $script:first)  # 刚打开时不弹旧的话
  $script:first = $false
}

$poll = New-Object Windows.Forms.Timer
$poll.Interval = 400
$poll.Add_Tick({ Read-State })
$pet.Add_Shown({
  Read-State
  $pet.Begin()
  $poll.Start()
  if ($SelfTest) {
    $script:shots = New-Object Windows.Forms.Timer
    $script:step = 0
    $script:shots.Interval = 700
    $script:shots.Add_Tick({
      $script:step++
      if ($script:step -eq 1) { $pet.SetSay('嗨！拖我去哪里都可以哦', $true) }
      if ($Shot -ne '') {
        $b = $pet.Bounds
        $bmp = New-Object Drawing.Bitmap($b.Width, $b.Height)
        $g = [Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($b.Location, [Drawing.Point]::Empty, $b.Size)
        $bmp.Save((Join-Path $Shot "pet$($script:step).png"), [Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose()
      }
      if ($script:step -ge 3) { $script:shots.Stop(); $pet.Close() }
    })
    $script:shots.Start()
  }
})
[Console]::Out.WriteLine('CLAWD_PET_READY'); [Console]::Out.Flush()
[Windows.Forms.Application]::Run($pet)
$mutex.ReleaseMutex()
exit 0
