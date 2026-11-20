// =====================================================================
// Clawd 桌面小助手：⚫ 灵动岛 + 🦀 桌面桌宠，住在同一个小程序里
//
// 为什么这样做（比喻）：
//   以前灵动岛、桌宠各自请了一个 PowerShell 管家（每个约 78 MB），每一帧都买一张新画纸、
//   还要在同一条线上一边看信一边画画，所以会顿。
//   现在：
//   - 一个小程序同时管两只，用 Windows 自带的 C# 编译器编一次，之后直接用
//   - 画纸只买一次（DIB），每一帧在同一张纸上重画
//   - 一条专门的"画画线程"，跟着屏幕刷新的节拍（DwmFlush = 等下一次刷新）画，弹簧动画按真实时间算
//   - 不动的时候就睡觉（0 帧）；桌宠上下晃只是"挪窗口"，不重画
//   - 状态文件有变化时 Windows 会通知（FileSystemWatcher），不用一直去看
//
// 用法：clawd-desktop.exe --state <desktop-state.json> [--selftest <截图文件夹>]
// 状态文件：{ now, quit?, island: {...} | null, pet: {...} | null }
// 按钮：往 stdout 印 CLAWD_ACTION:{...}，Clawd 会照做
//
// 注意：要能用 Windows 自带的 csc.exe（C# 5）编译——不要用 $"" 字符串、?.、=> 方法体这些新语法。
// =====================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace ClawdDesktop {

  // ---------------------------------------------------------------- Windows 接口
  static class Native {
    [StructLayout(LayoutKind.Sequential)] public struct PT { public int x, y; public PT(int a, int b) { x = a; y = b; } }
    [StructLayout(LayoutKind.Sequential)] public struct SZ { public int cx, cy; public SZ(int a, int b) { cx = a; cy = b; } }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] public struct BLEND { public byte op, flags, alpha, format; }
    [StructLayout(LayoutKind.Sequential)] public struct BITMAPINFOHEADER {
      public int biSize, biWidth, biHeight; public short biPlanes, biBitCount;
      public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant;
    }
    [DllImport("user32.dll")] public static extern bool UpdateLayeredWindow(IntPtr h, IntPtr dst, ref PT pos, ref SZ size, IntPtr src, ref PT srcPos, int key, ref BLEND b, int flags);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, int flags);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr o);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFOHEADER bmi, int usage, out IntPtr bits, IntPtr section, int offset);
    [DllImport("dwmapi.dll")] public static extern int DwmFlush();
    public const int SWP_NOSIZE = 0x1, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10;
  }

  // ---------------------------------------------------------------- 一张一直重复用的画纸
  class Surface : IDisposable {
    public readonly int W, H;
    public readonly Graphics G;
    readonly Bitmap bmp;
    readonly IntPtr dc, hbmp, old;
    public Surface(int w, int h) {
      W = Math.Max(1, w); H = Math.Max(1, h);
      Native.BITMAPINFOHEADER bi = new Native.BITMAPINFOHEADER();
      bi.biSize = 40; bi.biWidth = W; bi.biHeight = -H; bi.biPlanes = 1; bi.biBitCount = 32;
      IntPtr bits;
      hbmp = Native.CreateDIBSection(IntPtr.Zero, ref bi, 0, out bits, IntPtr.Zero, 0);
      dc = Native.CreateCompatibleDC(IntPtr.Zero);
      old = Native.SelectObject(dc, hbmp);
      bmp = new Bitmap(W, H, W * 4, PixelFormat.Format32bppPArgb, bits); // GDI+ 直接画在 DIB 上，不用再复制
      G = Graphics.FromImage(bmp);
    }
    /** 把左上角 w×h 这一块贴到窗口上（位置 x, y） */
    public void Push(IntPtr hwnd, int x, int y, int w, int h) {
      Native.PT pos = new Native.PT(x, y), src = new Native.PT(0, 0);
      Native.SZ size = new Native.SZ(Math.Min(w, W), Math.Min(h, H));
      Native.BLEND b = new Native.BLEND(); b.alpha = 255; b.format = 1;
      Native.UpdateLayeredWindow(hwnd, IntPtr.Zero, ref pos, ref size, dc, ref src, 0, ref b, 2);
    }
    public void Dispose() { G.Dispose(); bmp.Dispose(); Native.SelectObject(dc, old); Native.DeleteObject(hbmp); Native.DeleteDC(dc); }
  }

  // ---------------------------------------------------------------- 透明的、永远在最上面、不抢焦点的窗口
  class LayerWindow : Form {
    public IntPtr Hwnd;
    public LayerWindow() {
      FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
      StartPosition = FormStartPosition.Manual; Text = "Clawd";
      Hwnd = Handle;
    }
    protected override CreateParams CreateParams {
      get { CreateParams cp = base.CreateParams; cp.ExStyle |= 0x80000 | 0x80 | 0x8 | 0x08000000; return cp; }
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    /** 只挪位置，不重画（ULW 窗口会记住上次贴的图） */
    public void MoveTo(int x, int y) {
      Native.SetWindowPos(Hwnd, IntPtr.Zero, x, y, 0, 0, Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
    }
  }

  // ---------------------------------------------------------------- 画画线程
  interface IAnim {
    /** 画一帧。返回 0 = 不用再画（睡觉）、1 = 慢慢画（30 帧）、2 = 跟着屏幕刷新画 */
    int Frame(double now);
    /** 睡觉的话，最多睡多久（毫秒；-1 = 一直睡到被叫醒） */
    int NextWakeMs(double now);
  }

  static class Animator {
    static readonly List<IAnim> items = new List<IAnim>();
    static readonly AutoResetEvent wake = new AutoResetEvent(false);
    public static readonly Stopwatch Clock = Stopwatch.StartNew();
    public static double Now { get { return Clock.Elapsed.TotalSeconds; } }
    public static void Add(IAnim a) { lock (items) items.Add(a); }
    public static void Wake() { wake.Set(); }
    public static void Start() {
      Thread t = new Thread(Loop);
      t.IsBackground = true; t.Priority = ThreadPriority.AboveNormal; t.Name = "clawd-animator";
      t.Start();
    }
    static void Loop() {
      while (true) {
        int mode = 0; int sleep = -1;
        IAnim[] list; lock (items) list = items.ToArray();
        double now = Now;
        foreach (IAnim a in list) {
          int m = 0;
          try { m = a.Frame(now); } catch (Exception e) { Debug.WriteLine(e); }
          mode = Math.Max(mode, m);
          if (m == 0) { int w = a.NextWakeMs(now); if (w >= 0) sleep = sleep < 0 ? w : Math.Min(sleep, w); }
        }
        if (mode == 2) { if (Native.DwmFlush() != 0) Thread.Sleep(8); }  // 等屏幕下一次刷新
        else if (mode == 1) wake.WaitOne(33);
        else wake.WaitOne(sleep);
      }
    }
  }

  // ---------------------------------------------------------------- 小工具
  static class U {
    public static float S = 1f;
    public static int P(double v) { return (int)Math.Round(v * S); }
    public static float F(string s) { float v; return float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : 0f; }
    public static Color C(string s, float op) {
      Color c;
      try { c = ColorTranslator.FromHtml(s); } catch { c = Color.Gray; }
      return Color.FromArgb((int)(Math.Max(0f, Math.Min(1f, op)) * 255), c);
    }
    public static GraphicsPath Round(RectangleF r, float rad) {
      GraphicsPath p = new GraphicsPath();
      float d = Math.Min(rad * 2, Math.Min(r.Width, r.Height));
      if (d <= 0.5f) { p.AddRectangle(r); return p; }
      p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
      p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
      p.CloseFigure(); return p;
    }
    static readonly object outLock = new object();
    public static void Act(string json) { lock (outLock) { Console.Out.WriteLine("CLAWD_ACTION:" + json); Console.Out.Flush(); } }
    public static string Str(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : ""; }
    public static double Num(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToDouble(v, CultureInfo.InvariantCulture) : 0; }
    public static bool Bool(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) && v is bool && (bool)v; }
    public static Dictionary<string, object> Obj(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) ? v as Dictionary<string, object> : null; }
    public static long NowMs() { return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds; }
  }

  // =================================================================== ⚫ 灵动岛
  class Island : IAnim {
    readonly LayerWindow win = new LayerWindow();
    readonly object sync = new object();
    readonly Surface surf;
    readonly Font fTitle, fSay, fBtn, fSmall;
    readonly SolidBrush black = new SolidBrush(Color.Black);
    // 状态
    string mood = "idle", moodLabel = "发呆", say = "", phase = "idle", kind = "adult", task = "";
    int lv = 1; long endsAt = 0, skew = 0; int wholeMs = 1500000;
    bool visible;
    // 弹簧：x = 0 收起 / 1 展开
    double x = 0, v = 0, target = 0, lastT = -1;
    int lastSecond = -1; bool dirty = true;
    RectangleF[] btnRects = new RectangleF[0]; string[] btnActs = new string[0];
    Point mouse = new Point(-1, -1);
    DateTime autoCloseAt = DateTime.MaxValue;
    const int M = 14;
    static readonly string[] ADULT = { "..XXXXXXXXX..", "..XXXXXXXXX..", "..XXEXXXEXX..", "..XXEXXXEXX..", "LLXXXXXXXXXRR", "..XXXXXXXXX..", "...A.B.A.B...", "...A.B.A.B..." };
    static readonly string[] BABY = { "...XXXXXXX...", "...XEXXXEX...", "...XEXXXEX...", "...XXXXXXX...", "...A.B.A.B..." };

    public Island() {
      surf = new Surface(U.P(380) + U.P(M) * 2 + U.P(40), U.P(132) + U.P(M) * 2 + U.P(40));
      fTitle = new Font("Microsoft YaHei UI", 11.5f, FontStyle.Bold);
      fSay = new Font("Microsoft YaHei UI", 9f);
      fBtn = new Font("Microsoft YaHei UI", 9f, FontStyle.Bold);
      fSmall = new Font("Microsoft YaHei UI", 10f, FontStyle.Bold);
      win.MouseClick += OnClick;
      win.MouseMove += delegate (object o, MouseEventArgs e) { lock (sync) { mouse = e.Location; dirty = true; } Animator.Wake(); };
      win.MouseLeave += delegate { lock (sync) { mouse = new Point(-1, -1); dirty = true; } Animator.Wake(); };
      Animator.Add(this);
    }

    public void Apply(Dictionary<string, object> s, long now) {
      bool show = s != null;
      lock (sync) {
        if (show) {
          bool wasWaiting = mood == "waiting";
          mood = U.Str(s, "mood"); moodLabel = U.Str(s, "moodLabel"); say = U.Str(s, "say");
          lv = (int)U.Num(s, "lv"); kind = U.Str(s, "form") == "baby" ? "baby" : "adult"; task = U.Str(s, "task");
          Dictionary<string, object> p = U.Obj(s, "pomo");
          phase = U.Str(p, "phase"); if (phase == "") phase = "idle";
          endsAt = (long)U.Num(p, "endsAt"); wholeMs = (int)U.Num(p, "wholeMs");
          skew = now - U.NowMs();
          // Claude 在等你回复：自动展开 6 秒
          if (mood == "waiting" && !wasWaiting) { target = 1; autoCloseAt = DateTime.UtcNow.AddSeconds(6); }
          dirty = true;
        }
      }
      SetVisible(show);
      Animator.Wake();
    }

    void SetVisible(bool show) {
      if (show == visible) return;
      visible = show;
      win.BeginInvoke((MethodInvoker)delegate {
        if (show) win.Show(); else win.Hide();
        // Show() 会把窗口挪回 WinForms 记得的位置，所以显示之后马上再贴一次图
        lock (sync) dirty = true;
        Animator.Wake();
      });
    }

    public int NextWakeMs(double now) {
      lock (sync) {
        if (autoCloseAt != DateTime.MaxValue) return Math.Max(0, (int)(autoCloseAt - DateTime.UtcNow).TotalMilliseconds);
        if (visible && phase != "idle") return 1000 - (int)(U.NowMs() % 1000) + 5; // 倒计时：每秒画一次
        return -1;
      }
    }

    public int Frame(double now) {
      lock (sync) {
        if (!visible) { lastT = -1; return 0; }
        if (DateTime.UtcNow >= autoCloseAt) { target = 0; autoCloseAt = DateTime.MaxValue; }
        // 弹簧（按真实经过的时间算，帧数多少都一样顺）
        double dt = lastT < 0 ? 1 / 60.0 : Math.Min(0.05, now - lastT);
        lastT = now;
        bool moving = Math.Abs(x - target) > 0.0008 || Math.Abs(v) > 0.003;
        if (moving) {
          const double k = 210, c = 19; // 硬一点、带一点点回弹，像苹果的灵动岛
          int steps = 4; double h = dt / steps;
          for (int i = 0; i < steps; i++) { double a = -k * (x - target) - c * v; v += a * h; x += v * h; }
          if (Math.Abs(x - target) < 0.0008 && Math.Abs(v) < 0.003) { x = target; v = 0; }
        } else lastT = -1;
        int sec = (int)(U.NowMs() / 1000);
        if (moving || dirty || (phase != "idle" && sec != lastSecond)) {
          lastSecond = sec; dirty = false;
          Render();
        }
        return moving ? 2 : 0;
      }
    }

    long LeftMs() { return Math.Max(0, endsAt - (U.NowMs() + skew)); }
    string LeftText() { long l = LeftMs(); return string.Format("{0}:{1:00}", l / 60000, (l % 60000) / 1000); }
    Color Accent() {
      if (mood == "waiting") return Color.FromArgb(255, 159, 10);
      if (phase == "focus") return Color.FromArgb(255, 107, 94);
      if (phase == "break") return Color.FromArgb(48, 209, 88);
      return Color.FromArgb(200, 200, 205);
    }
    string Title() {
      if (mood == "waiting") return "Claude 在等你回复";
      if (phase == "focus") return task.Length > 0 ? "专注中 · " + task : "专注中";
      if (phase == "break") return "休息一下";
      return "Lv." + lv + " · " + moodLabel;
    }
    static float Lerp(float a, float b, float k) { return a + (b - a) * k; }

    void DrawClawd(Graphics g, float ox, float oy, float cell, int alpha) {
      string[] sp = kind == "baby" ? BABY : ADULT;
      bool shut = mood == "sleepy" || mood == "love" || mood == "hungry" || mood == "oops";
      using (SolidBrush ob = new SolidBrush(Color.FromArgb(alpha, 217, 119, 87)))
      using (SolidBrush eb = new SolidBrush(Color.FromArgb(alpha, 20, 20, 20))) {
        for (int r = 0; r < sp.Length; r++)
          for (int c = 0; c < sp[r].Length; c++) {
            char ch = sp[r][c];
            if (ch == '.') continue;
            bool eye = ch == 'E', top = eye && r + 1 < sp.Length && sp[r + 1][c] == 'E';
            g.FillRectangle(eye && !(shut && top) ? eb : ob, ox + c * cell, oy + r * cell, cell + 0.4f, cell + 0.4f);
          }
      }
    }
    void Text(Graphics g, string s, Font f, Color c, RectangleF r, StringAlignment h) {
      using (SolidBrush b = new SolidBrush(c))
      using (StringFormat sf = new StringFormat(StringFormatFlags.NoWrap)) {
        sf.Alignment = h; sf.LineAlignment = StringAlignment.Center; sf.Trimming = StringTrimming.EllipsisCharacter;
        g.DrawString(s, f, b, r, sf);
      }
    }

    void Render() {
      float t = (float)x;
      float tc = Math.Max(0f, Math.Min(1.06f, t));
      float w = Lerp(U.P(200), U.P(380), tc), h = Lerp(U.P(36), U.P(132), tc);
      float rad = Lerp(h / 2f, U.P(34), Math.Max(0f, Math.Min(1f, t * 1.4f)));
      int W = (int)Math.Ceiling(Math.Max(w, U.P(200))) + U.P(M) * 2, H = (int)Math.Ceiling(Math.Max(h, U.P(36))) + U.P(M) * 2;
      W = Math.Min(W, surf.W); H = Math.Min(H, surf.H);
      Rectangle scr = Screen.PrimaryScreen.WorkingArea;
      int X = scr.Left + (scr.Width - W) / 2, Y = scr.Top + U.P(6) - U.P(M) / 2;

      Graphics g = surf.G;
      g.SetClip(new Rectangle(0, 0, W, H)); g.Clear(Color.Transparent); g.ResetClip();
      g.SmoothingMode = SmoothingMode.AntiAlias; g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
      float ox = (W - w) / 2f, oy = U.P(M) / 2f;
      RectangleF pill = new RectangleF(ox, oy, w, h);
      for (int i = 5; i >= 1; i--) // 柔和的影子
        using (GraphicsPath sp = U.Round(new RectangleF(pill.X - i * U.S, pill.Y - i * U.S * 0.4f + U.P(3), pill.Width + i * 2 * U.S, pill.Height + i * 2 * U.S), rad + i * U.S))
        using (SolidBrush sb = new SolidBrush(Color.FromArgb(11, 0, 0, 0))) g.FillPath(sb, sp);
      using (GraphicsPath p = U.Round(pill, rad)) {
        g.FillPath(black, p);
        g.SetClip(p);
        // 收起时的内容
        int a1 = (int)(255 * Math.Max(0f, 1f - t * 2.2f));
        if (a1 > 0) {
          float cell = U.P(2.1);
          DrawClawd(g, pill.X + U.P(14), pill.Y + (h - (kind == "baby" ? 5 : 8) * cell) / 2f, cell, a1);
          string right = mood == "waiting" ? "等你回复" : phase != "idle" ? LeftText() : moodLabel;
          Text(g, right, fSmall, Color.FromArgb(a1, Accent()), new RectangleF(pill.X + U.P(50), pill.Y, w - U.P(64), h), StringAlignment.Far);
          if (phase != "idle" && mood != "waiting")
            using (SolidBrush db = new SolidBrush(Color.FromArgb(a1, Accent()))) g.FillEllipse(db, pill.Right - U.P(14) - U.P(62), pill.Y + h / 2f - U.P(4), U.P(8), U.P(8));
        }
        // 展开后的内容
        int a2 = (int)(255 * Math.Max(0f, Math.Min(1f, (t - 0.45f) * 2.2f)));
        btnRects = new RectangleF[0]; btnActs = new string[0];
        if (a2 > 0) {
          float cell = U.P(4.6), cy = pill.Y + U.P(22);
          DrawClawd(g, pill.X + U.P(22), cy + (kind == "baby" ? U.P(8) : 0), cell, a2);
          float tx = pill.X + U.P(22) + 13 * cell + U.P(14);
          bool ring = phase != "idle";
          float textW = pill.Right - tx - (ring ? U.P(84) : U.P(22));
          Text(g, Title(), fTitle, mood == "waiting" ? Color.FromArgb(a2, Accent()) : Color.FromArgb(a2, 255, 255, 255), new RectangleF(tx, cy - U.P(2), textW, U.P(24)), StringAlignment.Near);
          Text(g, say, fSay, Color.FromArgb(a2 * 6 / 10, 255, 255, 255), new RectangleF(tx, cy + U.P(22), textW, U.P(20)), StringAlignment.Near);
          if (ring) {
            float d = U.P(56), rx = pill.Right - U.P(22) - d, ry = pill.Y + U.P(16);
            float frac = wholeMs > 0 ? 1f - (float)LeftMs() / wholeMs : 0f;
            using (Pen bg = new Pen(Color.FromArgb(a2 * 15 / 100, 255, 255, 255), U.P(5)))
            using (Pen fg = new Pen(Color.FromArgb(a2, Accent()), U.P(5))) {
              fg.StartCap = LineCap.Round; fg.EndCap = LineCap.Round;
              g.DrawEllipse(bg, rx, ry, d, d);
              if (frac > 0.002f) g.DrawArc(fg, rx, ry, d, d, -90, 360f * frac);
            }
            Text(g, LeftText(), fBtn, Color.FromArgb(a2, 255, 255, 255), new RectangleF(rx - U.P(4), ry, d + U.P(8), d), StringAlignment.Center);
          }
          string[][] btns = phase == "focus" ? new string[][] { new[] { "停止番茄", "pomo-stop" }, new[] { "打开 Clawd 中心", "hub" }, new[] { "收起", "close" } }
            : phase == "break" ? new string[][] { new[] { "下一个番茄", "pomo-start" }, new[] { "结束", "pomo-end" }, new[] { "打开 Clawd 中心", "hub" } }
            : new string[][] { new[] { "开始番茄", "pomo-start" }, new[] { "打开 Clawd 中心", "hub" }, new[] { "收起", "close" } };
          float bx = pill.X + U.P(18), by = pill.Bottom - U.P(44), bh = U.P(30), bw = (w - U.P(36) - U.P(8) * (btns.Length - 1)) / btns.Length;
          btnRects = new RectangleF[btns.Length]; btnActs = new string[btns.Length];
          for (int i = 0; i < btns.Length; i++) {
            RectangleF r = new RectangleF(bx + i * (bw + U.P(8)), by, bw, bh);
            btnRects[i] = r; btnActs[i] = btns[i][1];
            using (GraphicsPath bp = U.Round(r, bh / 2f))
            using (SolidBrush bb = new SolidBrush(Color.FromArgb(a2 * (r.Contains(mouse) ? 30 : 16) / 100, 255, 255, 255))) g.FillPath(bb, bp);
            Text(g, btns[i][0], fBtn, Color.FromArgb(a2, 255, 255, 255), r, StringAlignment.Center);
          }
        }
        g.ResetClip();
      }
      surf.Push(win.Hwnd, X, Y, W, H);
      lastRect = new Rectangle(X, Y, W, H);
    }

    void OnClick(object o, MouseEventArgs e) {
      if (e.Button == MouseButtons.Right) {
        ContextMenuStrip m = new ContextMenuStrip();
        m.Items.Add("打开 Clawd 中心", null, delegate { U.Act("{\"type\":\"open\",\"what\":\"hub\"}"); });
        m.Items.Add("隐藏灵动岛（可在设置里再打开）", null, delegate { U.Act("{\"type\":\"island-off\"}"); });
        m.Show(win, e.Location);
        return;
      }
      lock (sync) {
        if (x > 0.5) {
          for (int i = 0; i < btnRects.Length; i++) {
            if (!btnRects[i].Contains(e.Location)) continue;
            string a = btnActs[i];
            if (a == "hub") U.Act("{\"type\":\"open\",\"what\":\"hub\"}");
            else if (a != "close") U.Act("{\"type\":\"" + a + "\"}");
            target = 0; autoCloseAt = DateTime.MaxValue;
            Animator.Wake();
            return;
          }
        }
        target = target > 0.5 ? 0 : 1; autoCloseAt = DateTime.MaxValue;
      }
      Animator.Wake();
    }

    public void SetExpanded(bool on) { lock (sync) { target = on ? 1 : 0; } Animator.Wake(); }
    // WinForms 不知道 ULW 把窗口挪到哪了，所以自己记住（截图测试用）
    Rectangle lastRect;
    public Rectangle Bounds { get { lock (sync) return lastRect; } }
  }

  // =================================================================== 🦀 桌面桌宠
  class Pet : IAnim {
    readonly LayerWindow win = new LayerWindow(), bubbleWin = new LayerWindow();
    readonly object sync = new object();
    Surface open, blink, squish, bubble;
    readonly Font bubbleFont = new Font("Microsoft YaHei UI", 9.5f);
    readonly Font glyphFont = new Font("Segoe UI Symbol", 10f, FontStyle.Regular, GraphicsUnit.Pixel);
    readonly Font glyphBold = new Font("Segoe UI Symbol", 10f, FontStyle.Bold, GraphicsUnit.Pixel);
    // 状态
    string mood = "idle", say = "", shapesText = "";
    List<string[]> shapes = new List<string[]>();
    float unit = 8f, tempo = 1f; bool showText = true, visible, first = true, needSprite = true, needBubble = true;
    DateTime bubbleUntil = DateTime.MinValue, squishAt = DateTime.MinValue;
    bool hover, down, dragging;
    Point downAt, grab;
    int ax = int.MinValue, ay;       // Clawd 左上角在屏幕上的位置
    int cw, ch;                       // Clawd 窗口大小
    int shownX = int.MinValue, shownY, shownFace = -1; // 现在窗口在哪、贴的是哪张图
    bool bubbleShown; int bw, bh, bShownX = int.MinValue, bShownY;
    readonly double born = Animator.Now;
    public string PosFile = "";

    public Pet() {
      win.MouseDown += OnDown; win.MouseMove += OnMove; win.MouseUp += OnUp;
      win.MouseDoubleClick += delegate (object o, MouseEventArgs e) { if (e.Button == MouseButtons.Left) U.Act("{\"type\":\"open\",\"what\":\"hub\"}"); };
      win.MouseEnter += delegate { lock (sync) hover = true; Animator.Wake(); };
      win.MouseLeave += delegate { lock (sync) hover = false; Animator.Wake(); };
      bubbleWin.MouseUp += delegate { lock (sync) bubbleUntil = DateTime.MinValue; Animator.Wake(); }; // 点泡泡 = 关掉
      Animator.Add(this);
    }

    public void Apply(Dictionary<string, object> s) {
      bool show = s != null;
      lock (sync) {
        if (show) {
          mood = U.Str(s, "mood");
          float u = (float)U.Num(s, "unit"); if (u <= 0) u = 8;
          if (u != unit) { unit = u; needSprite = true; if (ax != int.MinValue) Clamp(); }
          tempo = Math.Max(0.3f, (float)U.Num(s, "tempo"));
          showText = U.Bool(s, "showText");
          string sh = U.Str(s, "shapes");
          if (sh != shapesText) {
            shapesText = sh;
            List<string[]> list = new List<string[]>();
            foreach (string line in sh.Split('\n')) if (line.Length > 0) list.Add(line.Split('|'));
            shapes = list; needSprite = true;
          }
          string ns = U.Str(s, "say");
          if (ns != say) {
            say = ns; needBubble = true;
            if (!first && ns.Length > 0) bubbleUntil = DateTime.UtcNow.AddSeconds(Math.Min(12, 5 + ns.Length / 6.0));
          }
          first = false;
          if (ax == int.MinValue) LoadPos();
        }
      }
      if (show != visible) {
        lock (sync) { visible = show; shownFace = -1; shownX = int.MinValue; bShownX = int.MinValue; }
        win.BeginInvoke((MethodInvoker)delegate {
          if (show) win.Show(); else { win.Hide(); bubbleWin.Hide(); }
          lock (sync) { shownFace = -1; shownX = int.MinValue; } // 显示之后重新贴一次图
          Animator.Wake();
        });
      }
      Animator.Wake();
    }

    // ---------- 位置 ----------
    int SpriteW() { return (int)Math.Ceiling(15 * unit * U.S); }
    int SpriteH() { return (int)Math.Ceiling(13 * unit * U.S); }
    void LoadPos() {
      Rectangle wa = Screen.PrimaryScreen.WorkingArea;
      ax = wa.Right - SpriteW() - U.P(40); ay = wa.Bottom - SpriteH() - U.P(8);
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
      Rectangle v = SystemInformation.VirtualScreen;
      int w = SpriteW(), h = SpriteH();
      ax = Math.Max(v.Left - w / 2, Math.Min(ax, v.Right - w / 2));
      ay = Math.Max(v.Top, Math.Min(ay, v.Bottom - h / 2));
    }

    // ---------- 鼠标（在界面线程；只改状态，画画交给画画线程） ----------
    void OnDown(object o, MouseEventArgs e) {
      if (e.Button == MouseButtons.Right) { ShowMenu(e.Location); return; }
      if (e.Button != MouseButtons.Left) return;
      lock (sync) { down = true; dragging = false; downAt = Cursor.Position; grab = new Point(Cursor.Position.X - ax, Cursor.Position.Y - ay); }
    }
    void OnMove(object o, MouseEventArgs e) {
      int nx = 0, ny = 0; bool move = false;
      lock (sync) {
        if (!down) return;
        Point c = Cursor.Position;
        if (!dragging && (Math.Abs(c.X - downAt.X) > U.P(4) || Math.Abs(c.Y - downAt.Y) > U.P(4))) dragging = true;
        if (dragging) { ax = c.X - grab.X; ay = c.Y - grab.Y; nx = ax; ny = ay; shownX = ax; shownY = ay; move = true; }
      }
      if (move) { win.MoveTo(nx, ny); Animator.Wake(); } // 拖动直接在这条线上挪，最跟手
    }
    void OnUp(object o, MouseEventArgs e) {
      if (e.Button != MouseButtons.Left) return;
      bool pat = false;
      lock (sync) {
        if (!down) return;
        down = false;
        if (dragging) { dragging = false; Clamp(); SavePos(); }
        else { squishAt = DateTime.UtcNow; pat = true; }
      }
      if (pat) U.Act("{\"type\":\"pat\"}");
      Animator.Wake();
    }
    void ShowMenu(Point at) {
      ContextMenuStrip m = new ContextMenuStrip();
      m.Items.Add("摸摸头", null, delegate { lock (sync) squishAt = DateTime.UtcNow; U.Act("{\"type\":\"pat\"}"); Animator.Wake(); });
      m.Items.Add("喂小鱼干", null, delegate { U.Act("{\"type\":\"feed\",\"id\":\"fish\"}"); });
      m.Items.Add("番茄钟 开始 / 停止", null, delegate { U.Act("{\"type\":\"pomo-toggle\"}"); });
      m.Items.Add("打开 Clawd 中心", null, delegate { U.Act("{\"type\":\"open\",\"what\":\"hub\"}"); });
      m.Items.Add(new ToolStripSeparator());
      m.Items.Add("放回聊天框上方", null, delegate { U.Act("{\"type\":\"pet-where\",\"where\":\"chat\"}"); });
      m.Show(win, at);
    }

    // ---------- 动作：返回窗口要挪多少像素（整数，像素画才清楚）、要不要压扁 ----------
    void Motion(double sec, out int dx, out int dy, out float squishK) {
      double tp = sec / tempo, u = unit * U.S, fx = 0, fy = 0;
      switch (mood) {
        case "working": fy = -0.35 * Math.Abs(Math.Sin(tp * Math.PI * 2.4)); break;
        case "happy": { double k = (tp % 0.9) / 0.9; fy = k < 0.6 ? -2.0 * Math.Sin(Math.PI * k / 0.6) : 0; break; }
        case "sleepy": fy = 0.12 * Math.Sin(tp * Math.PI * 0.6); break;
        case "love": fx = 0.35 * Math.Sin(tp * Math.PI * 2); break;
        case "waiting": fy = -0.8 * Math.Abs(Math.Sin(tp * Math.PI * 1.6)); break;
        case "oops": fx = 0.3 * Math.Sin(tp * Math.PI * 12); break;
        case "thinking": fx = 0.25 * Math.Sin(tp * Math.PI * 0.8); break;
        default: fy = -0.25 * (1 - Math.Cos(tp * Math.PI * 0.9)); break;
      }
      dx = (int)Math.Round(fx * u); dy = (int)Math.Round(fy * u);
      double since = (DateTime.UtcNow - squishAt).TotalSeconds;
      squishK = since < 0.45 ? (float)(Math.Sin(since / 0.45 * Math.PI) * (1 - since / 0.45)) : 0f;
    }

    public int NextWakeMs(double now) {
      lock (sync) {
        if (bubbleShown && bubbleUntil != DateTime.MinValue && !hover && mood != "waiting")
          return Math.Max(0, (int)(bubbleUntil - DateTime.UtcNow).TotalMilliseconds);
        return -1;
      }
    }

    public int Frame(double now) {
      int mx = 0, my = 0, face = 0; bool moveWin = false, pushFace = false;
      Surface toPush = null; int px = 0, py = 0;
      bool showB = false, moveB = false, pushB = false; int bx = 0, by = 0;
      int mode;
      lock (sync) {
        if (!visible || shapes.Count == 0 || ax == int.MinValue) return 0;
        if (needSprite) BuildSprites();
        double sec = now - born;
        int dx, dy; float sq;
        Motion(sec, out dx, out dy, out sq);
        bool blinkNow = mood != "sleepy" && (sec % 4.2) < 0.13;
        if (dragging) { dx = 0; dy = 0; }
        px = ax + dx; py = ay + dy;
        if (sq > 0.001f) { RenderSprite(squish, false, sq); toPush = squish; face = 3; pushFace = true; }
        else { face = blinkNow ? 1 : 0; if (face != shownFace) { toPush = blinkNow ? blink : open; pushFace = true; } }
        if (pushFace) shownFace = face;
        if (px != shownX || py != shownY) { moveWin = true; shownX = px; shownY = py; }
        // 对话泡泡：跟着 Clawd 的"家"（不跟着上下晃）
        showB = showText && say.Length > 0 && (DateTime.UtcNow < bubbleUntil || hover || mood == "waiting");
        if (showB && needBubble) { BuildBubble(); pushB = true; }
        if (showB) {
          bx = ax + cw / 2 - bw / 2; by = ay - bh + U.P(4);
          moveB = bx != bShownX || by != bShownY;
          bShownX = bx; bShownY = by;
        }
        mode = sq > 0.001f || mood == "happy" || mood == "waiting" || dragging ? 2 : 1;
        mx = px; my = py;
      }
      // 下面这些会和界面线程说话：放在锁外面做，免得两边互相等
      if (toPush != null) toPush.Push(win.Hwnd, mx, my, cw, ch);
      else if (moveWin) win.MoveTo(mx, my);
      if (showB) {
        if (pushB) bubble.Push(bubbleWin.Hwnd, bx, by, bw, bh);
        else if (moveB) bubbleWin.MoveTo(bx, by);
        if (!bubbleShown) {
          bubbleShown = true;
          if (!pushB) bubble.Push(bubbleWin.Hwnd, bx, by, bw, bh);
          Surface bs = bubble; int sx = bx, sy = by, sw = bw, sh = bh;
          bubbleWin.BeginInvoke((MethodInvoker)delegate { bubbleWin.Show(); lock (sync) bs.Push(bubbleWin.Hwnd, sx, sy, sw, sh); });
        }
      } else if (bubbleShown) {
        bubbleShown = false; bubbleWin.BeginInvoke((MethodInvoker)delegate { bubbleWin.Hide(); });
      }
      return mode;
    }

    // ---------- 画像素 Clawd：只在形状变了的时候画（睁眼、眨眼两张） ----------
    void BuildSprites() {
      needSprite = false; shownFace = -1;
      cw = SpriteW(); ch = SpriteH();
      if (open == null || open.W < cw || open.H < ch) {
        if (open != null) { open.Dispose(); blink.Dispose(); squish.Dispose(); }
        open = new Surface(cw, ch); blink = new Surface(cw, ch); squish = new Surface(cw, ch);
      }
      RenderSprite(open, false, 0); RenderSprite(blink, true, 0);
    }

    void RenderSprite(Surface s, bool blinkEyes, float squishK) {
      Graphics g = s.G;
      g.SetClip(new Rectangle(0, 0, cw, ch)); g.Clear(Color.Transparent);
      GraphicsState st = g.Save();
      float u = unit * U.S;
      g.TranslateTransform(u * 1, u * 4); // viewBox 从 (-1, -4) 开始
      if (squishK > 0) { // 摸头：以脚底中间为中心压扁
        g.TranslateTransform(6.5f * u, 8f * u); g.ScaleTransform(1 + 0.12f * squishK, 1 - 0.22f * squishK); g.TranslateTransform(-6.5f * u, -8f * u);
      }
      g.ScaleTransform(u, u);
      foreach (string[] sh in shapes) DrawShape(g, sh, blinkEyes);
      g.Restore(st);
      g.ResetClip();
    }

    void DrawShape(Graphics g, string[] s, bool blinkEyes) {
      try {
        switch (s[0]) {
          case "r": {
            float x = U.F(s[1]), y = U.F(s[2]), w = U.F(s[3]), h = U.F(s[4]), rx = s.Length > 7 ? U.F(s[7]) : 0;
            if (blinkEyes && s[5].ToLowerInvariant() == "#1a1a1a") { y += h * 0.8f; h *= 0.2f; }
            g.SmoothingMode = rx > 0 ? SmoothingMode.AntiAlias : SmoothingMode.None;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            using (SolidBrush b = new SolidBrush(U.C(s[5], U.F(s[6])))) {
              if (rx > 0) using (GraphicsPath p = U.Round(new RectangleF(x, y, w, h), rx)) g.FillPath(b, p);
              else g.FillRectangle(b, x, y, w, h);
            }
            break;
          }
          case "c": {
            float cx = U.F(s[1]), cy = U.F(s[2]), rx = U.F(s[3]), ry = U.F(s[4]), op = U.F(s[8]);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            if (s[5] != "none" && s[5] != "") using (SolidBrush b = new SolidBrush(U.C(s[5], op))) g.FillEllipse(b, cx - rx, cy - ry, rx * 2, ry * 2);
            if (s[6] != "none" && s[6] != "") using (Pen pen = new Pen(U.C(s[6], op), U.F(s[7]))) g.DrawEllipse(pen, cx - rx, cy - ry, rx * 2, ry * 2);
            break;
          }
          case "l": {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (Pen pen = new Pen(U.C(s[5], 1f), U.F(s[6]))) g.DrawLine(pen, U.F(s[1]), U.F(s[2]), U.F(s[3]), U.F(s[4]));
            break;
          }
          case "t": {
            float size = U.F(s[3]);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            using (SolidBrush b = new SolidBrush(U.C(s[4], 1f))) {
              GraphicsState st = g.Save();
              float k = size / 10f;
              g.TranslateTransform(U.F(s[1]), U.F(s[2]) - size * 0.95f);
              g.ScaleTransform(k, k);
              g.DrawString(s[6], s[5] == "1" ? glyphBold : glyphFont, b, 0, 0, StringFormat.GenericTypographic);
              g.Restore(st);
            }
            break;
          }
        }
      } catch { }
    }

    // ---------- 对话泡泡 ----------
    void BuildBubble() {
      needBubble = false;
      SizeF ts;
      using (Bitmap tmp = new Bitmap(1, 1)) using (Graphics mg = Graphics.FromImage(tmp)) ts = mg.MeasureString(say, bubbleFont, U.P(210));
      int tail = U.P(9), m = U.P(6);
      int iw = (int)Math.Ceiling(ts.Width) + U.P(24), ih = (int)Math.Ceiling(ts.Height) + U.P(16);
      bw = iw + m * 2; bh = ih + tail + m * 2;
      if (bubble == null || bubble.W < bw || bubble.H < bh) { if (bubble != null) bubble.Dispose(); bubble = new Surface(Math.Max(bw, U.P(260)), Math.Max(bh, U.P(140))); }
      Graphics g = bubble.G;
      g.SetClip(new Rectangle(0, 0, bw, bh)); g.Clear(Color.Transparent);
      g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
      RectangleF br = new RectangleF(m, m, iw, ih);
      using (GraphicsPath p = BubblePath(br, U.P(12), tail)) {
        using (GraphicsPath sh = (GraphicsPath)p.Clone()) {
          using (Matrix mt = new Matrix()) { mt.Translate(0, U.P(2)); sh.Transform(mt); }
          using (SolidBrush sb = new SolidBrush(Color.FromArgb(40, 0, 0, 0))) g.FillPath(sb, sh);
        }
        g.FillPath(Brushes.White, p);
        using (Pen pen = new Pen(Color.FromArgb(40, 0, 0, 0), Math.Max(1f, U.S))) g.DrawPath(pen, p);
      }
      using (SolidBrush tb = new SolidBrush(Color.FromArgb(28, 28, 30)))
      using (StringFormat sf = new StringFormat()) {
        sf.Alignment = StringAlignment.Center; sf.LineAlignment = StringAlignment.Center;
        g.DrawString(say, bubbleFont, tb, new RectangleF(br.X + U.P(12), br.Y + U.P(8), br.Width - U.P(24), br.Height - U.P(16)), sf);
      }
      g.ResetClip();
    }
    static GraphicsPath BubblePath(RectangleF r, float rad, float tail) {
      GraphicsPath p = new GraphicsPath();
      float d = rad * 2, cx = r.X + r.Width / 2f;
      p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
      p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
      p.AddLine(cx + tail * 0.8f, r.Bottom, cx, r.Bottom + tail); p.AddLine(cx, r.Bottom + tail, cx - tail * 0.8f, r.Bottom);
      p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
      p.CloseFigure(); return p;
    }

    public void ForceBubble(string text) { lock (sync) { say = text; needBubble = true; bubbleUntil = DateTime.UtcNow.AddSeconds(8); } Animator.Wake(); }
    public Rectangle Bounds { get { lock (sync) return new Rectangle(shownX, shownY, cw, ch); } }
    public Rectangle BubbleBounds { get { lock (sync) return bubbleShown ? new Rectangle(bShownX, bShownY, bw, bh) : Rectangle.Empty; } }
  }

  // =================================================================== 读状态文件
  class StateReader {
    readonly string path;
    readonly Action<Dictionary<string, object>> onState;
    readonly FileSystemWatcher watcher;
    readonly System.Threading.Timer debounce, fallback;
    string last = "";
    readonly object gate = new object();
    public StateReader(string path, Action<Dictionary<string, object>> onState) {
      this.path = path; this.onState = onState;
      debounce = new System.Threading.Timer(delegate { Read(); }, null, Timeout.Infinite, Timeout.Infinite);
      // 有变化时 Windows 叫我们；另外每 3 秒自己看一眼，以防漏掉通知
      fallback = new System.Threading.Timer(delegate { Read(); }, null, 3000, 3000);
      watcher = new FileSystemWatcher(Path.GetDirectoryName(path), Path.GetFileName(path));
      watcher.NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName;
      FileSystemEventHandler h = delegate { debounce.Change(25, Timeout.Infinite); };
      watcher.Changed += h; watcher.Created += h;
      watcher.Renamed += delegate { debounce.Change(25, Timeout.Infinite); };
      watcher.EnableRaisingEvents = true;
    }
    public void Read() {
      lock (gate) {
        string text;
        try {
          using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
          using (StreamReader sr = new StreamReader(fs, System.Text.Encoding.UTF8)) text = sr.ReadToEnd();
        } catch { return; }
        if (text == last || text.Length < 2) return;
        Dictionary<string, object> d;
        try { d = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 }.DeserializeObject(text) as Dictionary<string, object>; }
        catch { debounce.Change(60, Timeout.Infinite); return; } // 可能刚好写到一半，等一下再读
        if (d == null) return;
        last = text;
        onState(d);
      }
    }
  }

  // =================================================================== 🫧 Clawd 中心的柜台（--hub 模式）
  // 一个只给你自己用的小网站：127.0.0.1 + 随机暗号。以前是 PowerShell（约 73 MB），现在住在这个小程序里。
  //   GET  /        → tools/hub/index.html（店面）
  //   GET  /state   → Clawd 写的状态文件
  //   POST /action  → 印一行 CLAWD_ACTION:{...} 给 Clawd
  //   POST /bye     → 店面说要走了：10 秒内没再来就关门；150 秒没人来看也关门
  static class HubServer {
    public static int Run(string root, string state, string data, bool noBrowser) {
      System.Net.HttpListener listener = null; int port = 0;
      for (int p = 47800; p < 47900 && listener == null; p++) {
        System.Net.HttpListener l = new System.Net.HttpListener();
        l.Prefixes.Add("http://127.0.0.1:" + p + "/");
        try { l.Start(); listener = l; port = p; } catch { l.Close(); }
      }
      if (listener == null) { Say("CLAWD_HUB_ERROR:no-port"); return 1; }
      string token = Guid.NewGuid().ToString("N");
      string url = "http://127.0.0.1:" + port + "/?t=" + token;
      Say("CLAWD_HUB:{\"port\":" + port + "}");
      Say("CLAWD_HUB_URL:" + url);
      if (!noBrowser) OpenWindow(url, data);

      string page = Path.Combine(root, "tools", "hub", "index.html");
      DateTime started = DateTime.UtcNow, lastSeen = DateTime.MinValue;
      System.Text.UTF8Encoding utf8 = new System.Text.UTF8Encoding(false);
      while (true) {
        System.Threading.Tasks.Task<System.Net.HttpListenerContext> task = listener.GetContextAsync();
        bool stop = false;
        while (!task.Wait(1000)) {
          DateTime now = DateTime.UtcNow;
          if (lastSeen == DateTime.MinValue && (now - started).TotalSeconds > 60) { stop = true; break; }
          if (lastSeen != DateTime.MinValue && (now - lastSeen).TotalSeconds > 150) { stop = true; break; }
        }
        if (stop) break;
        System.Net.HttpListenerContext ctx = task.Result;
        try {
          string path = ctx.Request.Url.AbsolutePath;
          if (ctx.Request.QueryString["t"] != token) { Send(ctx, 403, "text/plain", "no", utf8); continue; }
          lastSeen = DateTime.UtcNow;
          if (path == "/" && ctx.Request.HttpMethod == "GET") {
            Send(ctx, 200, "text/html; charset=utf-8", File.ReadAllText(page, utf8), utf8);
          } else if (path == "/state") {
            string json = "{}";
            if (state != "" && File.Exists(state)) {
              try {
                using (FileStream fs = new FileStream(state, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (StreamReader sr = new StreamReader(fs, utf8)) json = sr.ReadToEnd();
              } catch { json = ""; }
            }
            if (json == "") Send(ctx, 503, "text/plain", "busy", utf8); else Send(ctx, 200, "application/json; charset=utf-8", json, utf8);
          } else if (path == "/action" && ctx.Request.HttpMethod == "POST") {
            string body;
            using (StreamReader sr = new StreamReader(ctx.Request.InputStream, utf8)) body = sr.ReadToEnd().Trim();
            // 只收一行 JSON，换行去掉，免得传话被打断
            if (body.StartsWith("{") && body.Length < 2000) Say("CLAWD_ACTION:" + body.Replace("\r", " ").Replace("\n", " "));
            Send(ctx, 204, "", "", utf8);
          } else if (path == "/bye") {
            Send(ctx, 204, "", "", utf8);
            lastSeen = DateTime.UtcNow.AddSeconds(-140); // 可能只是重新整理：10 秒内没再来才关门
          } else {
            Send(ctx, 404, "text/plain", "not found", utf8);
          }
        } catch {
          try { ctx.Response.Abort(); } catch { }
        }
      }
      listener.Stop();
      Say("CLAWD_HUB_CLOSED");
      return 0;
    }

    static void Send(System.Net.HttpListenerContext ctx, int code, string type, string body, System.Text.Encoding enc) {
      System.Net.HttpListenerResponse res = ctx.Response;
      res.StatusCode = code;
      res.Headers["Cache-Control"] = "no-store";
      if (type != "") res.ContentType = type;
      byte[] bytes = enc.GetBytes(body);
      res.ContentLength64 = bytes.Length;
      if (bytes.Length > 0) res.OutputStream.Write(bytes, 0, bytes.Length);
      res.Close();
    }

    static void Say(string line) { Console.Out.WriteLine(line); Console.Out.Flush(); }

    /** 用 Edge 的应用模式打开店面（没有网址栏，像一个独立 app） */
    public static void OpenWindow(string url, string data) {
      string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
      string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
      string edge = null;
      foreach (string dir in new[] { pf86, pf }) {
        string p = Path.Combine(dir, "Microsoft", "Edge", "Application", "msedge.exe");
        if (File.Exists(p)) { edge = p; break; }
      }
      if (edge == null) { Process.Start(url); return; } // 没有 Edge 就用默认浏览器
      string profile = Path.Combine(data, "edge-hub"); // 单独的资料夹：不会混进你平常的 Edge
      string args = "--app=" + url + " --user-data-dir=\"" + profile + "\" --window-size=1180,780 --no-first-run --no-default-browser-check --disable-extensions"
        // 省内存：只要一个网页进程、不预先准备备用进程、不用显卡、不做后台联网 / 同步 / 组件更新
        + " --renderer-process-limit=1 --disable-features=SpareRendererForSitePerProcess,msEdgeSidebarV2,msShoppingExp"
        + " --disable-gpu --disable-background-networking --disable-component-update --disable-sync --disable-default-apps --no-pings";
      ProcessStartInfo si = new ProcessStartInfo(edge, args);
      si.UseShellExecute = false;
      Process.Start(si);
    }
  }

  // =================================================================== 主程序
  static class Program {
    [STAThread]
    static int Main(string[] args) {
      string state = "", selftest = "", root = "", data = "", openUrl = "";
      bool hub = false, noBrowser = false;
      for (int i = 0; i < args.Length; i++) {
        string next = i + 1 < args.Length ? args[i + 1] : "";
        if (args[i] == "--state") state = next;
        if (args[i] == "--selftest") selftest = next;
        if (args[i] == "--root") root = next;
        if (args[i] == "--data") data = next;
        if (args[i] == "--open-url") openUrl = next;
        if (args[i] == "--hub") hub = true;
        if (args[i] == "--no-browser") noBrowser = true;
      }
      // 柜台还开着、只是窗口被关了：只重新打开窗口（只接受自己的柜台网址）
      if (openUrl != "") {
        if (!System.Text.RegularExpressions.Regex.IsMatch(openUrl, "^http://127\\.0\\.0\\.1:\\d+/\\?t=[0-9a-f]+$")) return 2;
        HubServer.OpenWindow(openUrl, data == "" ? Path.GetTempPath() : data);
        return 0;
      }
      if (hub) return HubServer.Run(root, state, data == "" ? Path.GetTempPath() : data, noBrowser);
      if (state == "") { Console.Error.WriteLine("usage: clawd-desktop --state <file>"); return 2; }
      try { Native.SetProcessDPIAware(); } catch { }
      using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) U.S = g.DpiX / 96f;

      // 只能有一个：旧的可能正在关（例如刚 /reload-plugins），最多等 5 秒
      Mutex mutex = new Mutex(false, "Local\\ClawdDesktop");
      bool got;
      try { got = mutex.WaitOne(5000); } catch (AbandonedMutexException) { got = true; }
      if (!got) { Console.Out.WriteLine("CLAWD_DESKTOP_BUSY"); Console.Out.Flush(); return 0; }

      Application.EnableVisualStyles();
      Control ui = new Control(); ui.CreateControl(); // 用来把事情交回界面线程
      Island island = new Island();
      Pet pet = new Pet();
      pet.PosFile = Path.Combine(Path.GetDirectoryName(state), "pet-pos.txt");
      Animator.Start();

      Action<Dictionary<string, object>> apply = delegate (Dictionary<string, object> d) {
        if (U.Bool(d, "quit")) { ui.BeginInvoke((MethodInvoker)delegate { Application.Exit(); }); return; }
        long now = (long)U.Num(d, "now");
        island.Apply(U.Obj(d, "island"), now);
        pet.Apply(U.Obj(d, "pet"));
      };
      StateReader reader = new StateReader(state, apply);
      ui.BeginInvoke((MethodInvoker)delegate { reader.Read(); });

      if (selftest != "") SelfTest(ui, island, pet, selftest);
      Console.Out.WriteLine("CLAWD_DESKTOP_READY"); Console.Out.Flush();
      Application.Run();
      mutex.ReleaseMutex();
      return 0;
    }

    // 截图测试：收起 → 展开 → 桌宠 + 泡泡，然后结束
    static void SelfTest(Control ui, Island island, Pet pet, string dir) {
      int step = 0;
      System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
      t.Interval = 900;
      t.Tick += delegate {
        step++;
        if (step == 1) Shot(island.Bounds, Path.Combine(dir, "island-small.png"));
        if (step == 1) island.SetExpanded(true);
        if (step == 2) { Shot(island.Bounds, Path.Combine(dir, "island-big.png")); pet.ForceBubble("嗨！拖我去哪里都可以哦"); }
        if (step == 3) { Rectangle a = pet.Bounds, b = pet.BubbleBounds; Shot(Rectangle.Union(a, b), Path.Combine(dir, "pet.png")); }
        if (step >= 4) { t.Stop(); Application.Exit(); }
      };
      t.Start();
    }
    static void Shot(Rectangle r, string file) {
      if (r.Width <= 0 || r.Height <= 0) return;
      using (Bitmap b = new Bitmap(r.Width, r.Height)) using (Graphics g = Graphics.FromImage(b)) {
        g.CopyFromScreen(r.Location, Point.Empty, r.Size);
        b.Save(file, ImageFormat.Png);
      }
    }
  }
}
