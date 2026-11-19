# =====================================================================
# Clawd 设置窗口（Windows 原生窗口，用系统自带的 PowerShell + WinForms）
# 外观仿 macOS「系统设置」：左边侧边栏 + 右边白色圆角卡片 + 苹果风开关
#
# 工作方式（像传纸条）：
#   1. Clawd 把"现在的设置"（JSON）从 stdin 递进来
#   2. 这里弹出窗口让你改
#   3. 按「保存」→ 把新设置印成一行 CLAWD_SETTINGS:{...} 递回给 Clawd
#      按「取消」或关掉窗口 → 什么都不递，设置不变
#
# 自己单独试：  '{}' | powershell -ExecutionPolicy Bypass -STA -File tools\settings.ps1 -Root .
# 自动测试：    加 -SelfTest（自动按保存）；再加 -Shot <文件夹> 会把每一页截图存起来
# =====================================================================

param([string]$Root = (Split-Path -Parent $PSScriptRoot), [switch]$SelfTest, [string]$Shot = '')

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ---------- 0. 自己画的苹果风控件（C#，PowerShell 现场编译） ----------
# 比喻：WinForms 自带的控件像"统一发的校服"，这里我们自己裁衣服——
# 每个控件都在 OnPaint 里一笔一笔画出圆角、开关、箭头。
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ClawdUI {
  public static class UI {
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    public static float S = 1f;
    public static Color Bg = Color.FromArgb(242, 242, 247);      // 窗口底色（苹果的浅灰）
    public static Color Side = Color.FromArgb(232, 232, 237);    // 侧边栏
    public static Color CardBg = Color.White;
    public static Color Sep = Color.FromArgb(226, 226, 231);     // 分隔线
    public static Color Border = Color.FromArgb(209, 209, 214);
    public static Color Text1 = Color.FromArgb(28, 28, 30);
    public static Color Text2 = Color.FromArgb(142, 142, 147);
    public static Color Blue = Color.FromArgb(0, 122, 255);
    public static Color Green = Color.FromArgb(52, 199, 89);
    public static Color Off = Color.FromArgb(222, 222, 227);
    public static Color Orange = Color.FromArgb(217, 119, 87);
    public static string FontName = "Microsoft YaHei UI";

    // 告诉 Windows "我自己会处理高分辨率"，字就不会被放大得糊糊的
    public static void Init() {
      try { SetProcessDPIAware(); } catch { }
      using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) { S = g.DpiX / 96f; }
    }
    public static int P(float v) { return (int)Math.Round(v * S); }
    public static Font F(float pt, FontStyle st) { return new Font(FontName, pt, st); }
    public static void Smooth(Graphics g) {
      g.SmoothingMode = SmoothingMode.AntiAlias;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
    }
    public static GraphicsPath Round(RectangleF r, float rad) {
      GraphicsPath p = new GraphicsPath();
      float d = Math.Min(rad * 2, Math.Min(r.Width, r.Height));
      if (d <= 0) { p.AddRectangle(r); return p; }
      p.AddArc(r.X, r.Y, d, d, 180, 90);
      p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
      p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
      p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
      p.CloseFigure();
      return p;
    }
    public static void FillRound(Graphics g, Color c, RectangleF r, float rad) {
      using (GraphicsPath p = Round(r, rad)) using (SolidBrush b = new SolidBrush(c)) g.FillPath(b, p);
    }
    public static void DrawRound(Graphics g, Color c, RectangleF r, float rad) {
      using (GraphicsPath p = Round(r, rad)) using (Pen pen = new Pen(c, Math.Max(1f, S))) g.DrawPath(pen, p);
    }
    public static void Text(Graphics g, string s, Font f, Color c, Rectangle r, TextFormatFlags extra) {
      TextRenderer.DrawText(g, s, f, r, c, TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | extra);
    }
  }

  public class Base : Control {
    public Base() {
      SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
      SetStyle(ControlStyles.Selectable, false);
      Cursor = Cursors.Hand;
    }
  }

  // ---------- 开关：绿色药丸 + 白色圆点，会滑过去 ----------
  public class Toggle : Base {
    bool on; float pos; Timer t;
    public event EventHandler Changed;
    public Toggle() {
      Size = new Size(UI.P(42), UI.P(25));
      BackColor = UI.CardBg;
      t = new Timer(); t.Interval = 12;
      t.Tick += delegate {
        float target = on ? 1f : 0f;
        if (Math.Abs(pos - target) <= 0.15f) { pos = target; t.Stop(); }
        else pos += pos < target ? 0.15f : -0.15f;
        Invalidate();
      };
    }
    public bool Checked {
      get { return on; }
      set {
        if (on == value) return;
        on = value;
        if (IsHandleCreated && Visible) t.Start(); else { pos = on ? 1f : 0f; Invalidate(); }
        if (Changed != null) Changed(this, EventArgs.Empty);
      }
    }
    protected override void OnClick(EventArgs e) { Checked = !Checked; base.OnClick(e); }
    static Color Mix(Color a, Color b, float k) {
      return Color.FromArgb((int)(a.R + (b.R - a.R) * k), (int)(a.G + (b.G - a.G) * k), (int)(a.B + (b.B - a.B) * k));
    }
    protected override void OnPaint(PaintEventArgs e) {
      Graphics g = e.Graphics; g.Clear(BackColor); UI.Smooth(g);
      float w = Width - 1, h = Height - 1;
      UI.FillRound(g, Mix(UI.Off, UI.Green, pos), new RectangleF(0, 0, w, h), h / 2);
      float m = UI.S * 2f, k = h - m * 2, x = m + (w - m * 2 - k) * pos;
      using (SolidBrush sh = new SolidBrush(Color.FromArgb(38, 0, 0, 0))) g.FillEllipse(sh, x, m + UI.S, k, k);
      g.FillEllipse(Brushes.White, x, m, k, k);
    }
  }

  // ---------- 下拉菜单的颜色：选中时蓝底白字（像 Mac 的菜单） ----------
  class MenuColors : ProfessionalColorTable {
    public override Color ToolStripDropDownBackground { get { return Color.White; } }
    public override Color MenuBorder { get { return UI.Border; } }
    public override Color ImageMarginGradientBegin { get { return Color.White; } }
    public override Color ImageMarginGradientMiddle { get { return Color.White; } }
    public override Color ImageMarginGradientEnd { get { return Color.White; } }
  }
  class MenuLook : ToolStripProfessionalRenderer {
    public MenuLook() : base(new MenuColors()) { RoundedEdges = true; }
    protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e) {
      if (!e.Item.Selected) return;
      UI.Smooth(e.Graphics);
      UI.FillRound(e.Graphics, UI.Blue, new RectangleF(UI.P(4), 1, e.Item.Width - UI.P(6), e.Item.Height - 2), UI.P(5));
    }
    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e) {
      e.TextColor = e.Item.Selected ? Color.White : UI.Text1;
      base.OnRenderItemText(e);
    }
    protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e) {
      Color c = e.Item.Selected ? Color.White : UI.Text1;
      Rectangle r = new Rectangle(UI.P(6), 0, UI.P(20), e.Item.Height);
      TextRenderer.DrawText(e.Graphics, "✓", e.Item.Font, r, c, TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter);
    }
  }

  // ---------- 弹出式按钮：Mac 那种「文字 + 蓝色小上下箭头」 ----------
  public class Picker : Base {
    string[] items; int sel;
    public event EventHandler Changed;
    public Picker(string[] items, int sel) {
      this.items = items; this.sel = sel;
      BackColor = UI.CardBg;
      Font = UI.F(9.5f, FontStyle.Regular);
      int maxw = 0;
      foreach (string s in items) maxw = Math.Max(maxw, TextRenderer.MeasureText(s, Font).Width);
      Size = new Size(maxw + UI.P(42), UI.P(26));
    }
    public int SelectedIndex {
      get { return sel; }
      set { sel = value; Invalidate(); if (Changed != null) Changed(this, EventArgs.Empty); }
    }
    protected override void OnClick(EventArgs e) {
      base.OnClick(e);
      ContextMenuStrip m = new ContextMenuStrip();
      m.Renderer = new MenuLook();
      m.Font = Font;
      m.ShowImageMargin = false;
      m.ShowCheckMargin = true;
      for (int i = 0; i < items.Length; i++) {
        ToolStripMenuItem it = new ToolStripMenuItem(items[i]);
        it.Checked = i == sel;
        it.Padding = new Padding(0, UI.P(2), 0, UI.P(2));
        int idx = i;
        it.Click += delegate { SelectedIndex = idx; };
        m.Items.Add(it);
      }
      m.Closed += delegate { BeginInvoke((MethodInvoker)delegate { m.Dispose(); }); };
      m.Show(this, new Point(0, Height + UI.P(2)));
    }
    protected override void OnPaint(PaintEventArgs e) {
      Graphics g = e.Graphics; g.Clear(BackColor); UI.Smooth(g);
      RectangleF r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 2.5f);
      using (SolidBrush sh = new SolidBrush(Color.FromArgb(18, 0, 0, 0))) using (GraphicsPath p = UI.Round(new RectangleF(r.X, r.Y + UI.S, r.Width, r.Height), UI.P(6))) g.FillPath(sh, p);
      UI.FillRound(g, Color.White, r, UI.P(6));
      UI.DrawRound(g, UI.Border, r, UI.P(6));
      UI.Text(g, items[sel], Font, UI.Text1, new Rectangle(UI.P(10), 0, Width - UI.P(36), Height - 1), TextFormatFlags.VerticalCenter);
      // 右边的蓝色小方块 + 上下两个小箭头
      float bw = UI.P(17), bh = Height - UI.P(8), bx = Width - bw - UI.P(4), by = UI.P(3);
      UI.FillRound(g, UI.Blue, new RectangleF(bx, by, bw, bh), UI.P(4));
      float cx = bx + bw / 2, cy = by + bh / 2, a = UI.S * 3f, gap = UI.S * 1.6f;
      using (Pen pen = new Pen(Color.White, UI.S * 1.4f)) {
        pen.StartCap = LineCap.Round; pen.EndCap = LineCap.Round; pen.LineJoin = LineJoin.Round;
        g.DrawLines(pen, new PointF[] { new PointF(cx - a, cy - gap), new PointF(cx, cy - gap - a), new PointF(cx + a, cy - gap) });
        g.DrawLines(pen, new PointF[] { new PointF(cx - a, cy + gap), new PointF(cx, cy + gap + a), new PointF(cx + a, cy + gap) });
      }
    }
  }

  // ---------- 圆角按钮：Primary = 蓝底白字；否则白底灰边 ----------
  public class Pill : Base {
    public bool Primary; public bool Small; bool hover, down;
    public Pill(string text, bool primary, bool small) {
      Text = text; Primary = primary; Small = small;
      Font = UI.F(small ? 8.5f : 9.5f, primary ? FontStyle.Bold : FontStyle.Regular);
      Size tz = TextRenderer.MeasureText(text, Font);
      Size = small ? new Size(tz.Width + UI.P(18), UI.P(24)) : new Size(Math.Max(tz.Width + UI.P(30), UI.P(80)), UI.P(30));
    }
    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; down = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { down = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnPaint(PaintEventArgs e) {
      Graphics g = e.Graphics; g.Clear(BackColor); UI.Smooth(g);
      RectangleF r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 2.5f);
      float rad = UI.P(Small ? 6 : 8);
      using (SolidBrush sh = new SolidBrush(Color.FromArgb(Primary ? 40 : 16, 0, 0, 0))) using (GraphicsPath p = UI.Round(new RectangleF(r.X, r.Y + UI.S, r.Width, r.Height), rad)) g.FillPath(sh, p);
      Color fill;
      if (Primary) fill = down ? Color.FromArgb(0, 96, 210) : hover ? Color.FromArgb(28, 136, 255) : UI.Blue;
      else fill = down ? Color.FromArgb(228, 228, 233) : hover ? Color.FromArgb(246, 246, 248) : Color.White;
      UI.FillRound(g, fill, r, rad);
      if (!Primary) UI.DrawRound(g, UI.Border, r, rad);
      UI.Text(g, Text, Font, Primary ? Color.White : UI.Text1, new Rectangle(0, 0, Width, Height - 1), TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter);
    }
  }

  // ---------- 纯文字的蓝色按钮（像 Mac 的「恢复默认」链接） ----------
  public class LinkBtn : Base {
    bool hover;
    public LinkBtn(string text) {
      Text = text; Font = UI.F(9.5f, FontStyle.Regular);
      Size tz = TextRenderer.MeasureText(text, Font);
      Size = new Size(tz.Width + UI.P(4), UI.P(30));
    }
    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnPaint(PaintEventArgs e) {
      e.Graphics.Clear(BackColor);
      UI.Text(e.Graphics, Text, Font, hover ? Color.FromArgb(0, 96, 210) : UI.Blue, new Rectangle(0, 0, Width, Height), TextFormatFlags.VerticalCenter);
    }
  }

  // ---------- 卡片：白色圆角，一行一个设置，中间有细分隔线 ----------
  public class Card : Base {
    class Row { public string T; public string Sub; public Control C; public int H; }
    List<Row> rows = new List<Row>();
    Font f1 = UI.F(10f, FontStyle.Regular), f2 = UI.F(8.5f, FontStyle.Regular);
    public Card() { BackColor = UI.Bg; Cursor = Cursors.Default; }
    public void AddRow(string title, string sub, Control c) {
      Row r = new Row(); r.T = title; r.Sub = sub; r.C = c;
      r.H = UI.P(string.IsNullOrEmpty(sub) ? 46 : 58);
      rows.Add(r);
      if (c != null) { c.BackColor = UI.CardBg; Controls.Add(c); }
      Relayout();
    }
    void Relayout() {
      int y = 0;
      foreach (Row r in rows) {
        if (r.C != null) r.C.Location = new Point(Width - UI.P(14) - r.C.Width, y + (r.H - r.C.Height) / 2);
        y += r.H;
      }
      if (Height != y) Height = y;
      Invalidate();
    }
    protected override void OnResize(EventArgs e) { base.OnResize(e); if (rows.Count > 0) Relayout(); }
    protected override void OnPaint(PaintEventArgs e) {
      Graphics g = e.Graphics; g.Clear(BackColor); UI.Smooth(g);
      UI.FillRound(g, UI.CardBg, new RectangleF(0, 0, Width - 0.5f, Height - 0.5f), UI.P(10));
      int y = 0;
      for (int i = 0; i < rows.Count; i++) {
        Row r = rows[i];
        int left = UI.P(14);
        int right = (r.C != null ? r.C.Left - UI.P(12) : Width - UI.P(14));
        if (string.IsNullOrEmpty(r.Sub)) {
          UI.Text(g, r.T, f1, UI.Text1, new Rectangle(left, y, right - left, r.H), TextFormatFlags.VerticalCenter);
        } else {
          UI.Text(g, r.T, f1, UI.Text1, new Rectangle(left, y + UI.P(9), right - left, UI.P(22)), TextFormatFlags.VerticalCenter);
          UI.Text(g, r.Sub, f2, UI.Text2, new Rectangle(left, y + UI.P(31), right - left, UI.P(18)), TextFormatFlags.VerticalCenter);
        }
        y += r.H;
        if (i < rows.Count - 1) using (Pen p = new Pen(UI.Sep, 1)) g.DrawLine(p, left, y, Width, y);
      }
    }
  }

  // ---------- 一页：大标题 + 卡片 + 灰色小注解，从上往下排 ----------
  public class Page : Panel {
    public string Title;
    List<Control> parts = new List<Control>();
    Font tf = UI.F(15f, FontStyle.Bold);
    public Page(string title, int w, int h) {
      Title = title; Size = new Size(w, h); BackColor = UI.Bg; DoubleBuffered = true;
    }
    public Card AddCard() {
      Card c = new Card(); c.Width = Width; Controls.Add(c); parts.Add(c); return c;
    }
    public void AddNote(string text) {
      Label l = new Label();
      l.Text = text; l.AutoSize = true; l.MaximumSize = new Size(Width - UI.P(28), 0);
      l.Font = UI.F(8.5f, FontStyle.Regular); l.ForeColor = UI.Text2; l.BackColor = UI.Bg;
      Controls.Add(l); parts.Add(l);
    }
    public void Relayout() {
      int y = UI.P(60);
      Control prev = null;
      foreach (Control c in parts) {
        if (c is Card) { y += prev == null ? 0 : UI.P(20); c.Location = new Point(0, y); }
        else { y += UI.P(7); c.Location = new Point(UI.P(14), y); }
        y += c.Height; prev = c;
      }
    }
    protected override void OnPaint(PaintEventArgs e) {
      e.Graphics.Clear(BackColor);
      UI.Text(e.Graphics, Title, tf, UI.Text1, new Rectangle(0, UI.P(14), Width, UI.P(34)), TextFormatFlags.VerticalCenter);
    }
  }

  // ---------- 左边的侧边栏：Clawd 头像 + 彩色小图标的分类 ----------
  public class Sidebar : Base {
    class Item { public string Name; public string Glyph; public Color Color; public Control Page; }
    List<Item> items = new List<Item>();
    int sel = 0, top, itemH;
    Font fName = UI.F(10f, FontStyle.Regular), fBig = UI.F(12.5f, FontStyle.Bold), fSmall = UI.F(8.5f, FontStyle.Regular);
    Font fIcon = new Font("Segoe MDL2 Assets", 9.5f);
    static string[] SPRITE = {
      "..XXXXXXXXX..",
      "..XXXXXXXXX..",
      "..XXEXXXEXX..",
      "..XXEXXXEXX..",
      "LLXXXXXXXXXRR",
      "..XXXXXXXXX..",
      "...A.B.A.B...",
      "...A.B.A.B...",
    };
    public Sidebar() { BackColor = UI.Side; Cursor = Cursors.Default; top = UI.P(92); itemH = UI.P(36); }
    public void Add(string name, string glyph, Color color, Control page) {
      Item it = new Item(); it.Name = name; it.Glyph = glyph; it.Color = color; it.Page = page;
      items.Add(it); page.Visible = items.Count - 1 == sel; Invalidate();
    }
    public int Count { get { return items.Count; } }
    public int SelectedIndex {
      get { return sel; }
      set { sel = value; for (int i = 0; i < items.Count; i++) items[i].Page.Visible = i == sel; Invalidate(); }
    }
    int HitTest(int y) { int i = (y - top) / itemH; return (y >= top && i < items.Count) ? i : -1; }
    protected override void OnMouseMove(MouseEventArgs e) { Cursor = HitTest(e.Y) >= 0 ? Cursors.Hand : Cursors.Default; base.OnMouseMove(e); }
    protected override void OnMouseDown(MouseEventArgs e) { int i = HitTest(e.Y); if (i >= 0) SelectedIndex = i; base.OnMouseDown(e); }
    protected override void OnPaint(PaintEventArgs e) {
      Graphics g = e.Graphics; g.Clear(BackColor);
      // 像素 Clawd 头像
      float cell = UI.S * 3.4f, ox = UI.P(18), oy = UI.P(26);
      using (SolidBrush ob = new SolidBrush(UI.Orange)) using (SolidBrush eb = new SolidBrush(Color.FromArgb(26, 26, 26))) {
        for (int y = 0; y < SPRITE.Length; y++)
          for (int x = 0; x < SPRITE[y].Length; x++) {
            char ch = SPRITE[y][x];
            if (ch == '.') continue;
            g.FillRectangle(ch == 'E' ? eb : ob, ox + x * cell, oy + y * cell, cell + 0.5f, cell + 0.5f);
          }
      }
      int tx = (int)(ox + 13 * cell) + UI.P(10);
      UI.Text(g, "Clawd", fBig, UI.Text1, new Rectangle(tx, UI.P(24), Width - tx, UI.P(24)), TextFormatFlags.VerticalCenter);
      UI.Text(g, "桌宠设置", fSmall, UI.Text2, new Rectangle(tx, UI.P(48), Width - tx, UI.P(18)), TextFormatFlags.VerticalCenter);
      UI.Smooth(g);
      for (int i = 0; i < items.Count; i++) {
        Item it = items[i];
        int y = top + i * itemH;
        if (i == sel) UI.FillRound(g, UI.Blue, new RectangleF(UI.P(10), y + UI.P(1), Width - UI.P(20), itemH - UI.P(2)), UI.P(7));
        RectangleF ic = new RectangleF(UI.P(18), y + (itemH - UI.P(22)) / 2f, UI.P(22), UI.P(22));
        UI.FillRound(g, it.Color, ic, UI.P(6));
        if (i == sel) UI.DrawRound(g, Color.FromArgb(90, 255, 255, 255), ic, UI.P(6));
        TextRenderer.DrawText(g, it.Glyph, fIcon, Rectangle.Round(ic), Color.White, TextFormatFlags.NoPadding | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        UI.Text(g, it.Name, fName, i == sel ? Color.White : UI.Text1, new Rectangle(UI.P(50), y, Width - UI.P(60), itemH), TextFormatFlags.VerticalCenter);
      }
      using (Pen p = new Pen(Color.FromArgb(216, 216, 221), 1)) g.DrawLine(p, Width - 1, 0, Width - 1, Height);
    }
  }
}
'@

[ClawdUI.UI]::Init()
[Windows.Forms.Application]::EnableVisualStyles()
function P([double]$v) { return [ClawdUI.UI]::P($v) }

# ---------- 1. 读进来现在的设置 ----------
$raw = [Console]::In.ReadToEnd()
try { $cur = $raw | ConvertFrom-Json } catch { $cur = $null }
if ($null -eq $cur) { $cur = [pscustomobject]@{} }

$defaults = [ordered]@{
  focus = $false; sound = $true; volume = 'mid'; longTaskSec = 30; sleepMin = 2
  speed = 'normal'; showText = $true; size = 'medium'; internStart = ''
  pomoMin = 25; breakMin = 5; longBreakMin = 15
  nightFrom = 23; nightRemindMin = 30
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
$pomoOpts   = @(@('15 分钟', 15), @('25 分钟', 25), @('30 分钟', 30), @('45 分钟', 45), @('50 分钟', 50))
$breakOpts  = @(@('3 分钟', 3), @('5 分钟', 5), @('10 分钟', 10))
$longOpts2  = @(@('10 分钟', 10), @('15 分钟', 15), @('20 分钟', 20), @('30 分钟', 30))
$nightOpts  = @(@('晚上 9 点', 21), @('晚上 10 点', 22), @('晚上 11 点', 23), @('半夜 12 点', 24), @('关闭', 0))
$nagOpts    = @(@('每 15 分钟', 15), @('每 30 分钟', 30), @('每 1 小时', 60), @('不提醒', 0))

function New-Picker($opts, $value) {
  $names = [string[]]@($opts | ForEach-Object { [string]$_[0] })
  $idx = 0
  for ($i = 0; $i -lt $opts.Count; $i++) { if ("$($opts[$i][1])" -eq "$value") { $idx = $i } }
  $p = [ClawdUI.Picker]::new($names, $idx)
  $p.Tag = $opts
  return $p
}
function New-Toggle($value) { $t = [ClawdUI.Toggle]::new(); $t.Checked = [bool]$value; return $t }
function Get-ComboValue($p) { return $p.Tag[$p.SelectedIndex][1] }
function Set-Combo($p, $value) {
  for ($i = 0; $i -lt $p.Tag.Count; $i++) { if ("$($p.Tag[$i][1])" -eq "$value") { $p.SelectedIndex = $i } }
}

# ---------- 2. 画窗口 ----------
$W = P 760; $H = P 430; $sideW = P 210; $GUT = P 26
$form = New-Object Windows.Forms.Form
$form.Text = 'Clawd 设置'
$form.Font = [ClawdUI.UI]::F(9.5, 'Regular')
$form.AutoScaleMode = 'None'
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ShowIcon = $false  # 苹果的窗口标题栏没有小图标
$form.TopMost = $true
$form.ClientSize = New-Object Drawing.Size($W, $H)
$form.BackColor = [ClawdUI.UI]::Bg
$form.KeyPreview = $true

$side = [ClawdUI.Sidebar]::new()
$side.Location = New-Object Drawing.Point(0, 0)
$side.Size = New-Object Drawing.Size($sideW, $H)
$form.Controls.Add($side)

$pageW = $W - $sideW - $GUT * 2
$pageH = $H - (P 64)
function New-Page($title, $name, $glyph, $r, $g, $b) {
  $pg = [ClawdUI.Page]::new($title, $pageW, $pageH)
  $pg.Location = New-Object Drawing.Point(($sideW + $GUT), 0)
  $form.Controls.Add($pg)
  $side.Add($name, $glyph, [Drawing.Color]::FromArgb($r, $g, $b), $pg)
  return $pg
}

# 每一页（侧边栏的一格）—— 图标是 Windows 自带的 Segoe MDL2 Assets 字体
$pgFocus = New-Page '专注与打扰' '专注与打扰' ([string][char]0xE7ED) 88 86 214
$c = $pgFocus.AddCard()
$focus    = New-Toggle (Get-Pref 'focus');    $c.AddRow('专注模式', '不说话、不弹提示、动画放慢', $focus)
$showText = New-Toggle (Get-Pref 'showText'); $c.AddRow('聊天框上方显示文字', '关掉之后只剩 Clawd 自己', $showText)
$pgFocus.AddNote('专注模式也可以用 /clawd-focus 快速开关。')

$pgSound = New-Page '提示音' '提示音' ([string][char]0xE767) 255 45 85
$c = $pgSound.AddCard()
$sound  = New-Toggle (Get-Pref 'sound');               $c.AddRow('开启提示音', '', $sound)
$volume = New-Picker $volumeOpts (Get-Pref 'volume');  $c.AddRow('音量', '', $volume)
$long   = New-Picker $longOpts (Get-Pref 'longTaskSec'); $c.AddRow('完成音', '任务超过这么久，做完时响一声', $long)
# 试听：按当前选的音量播放
$tryBox = New-Object Windows.Forms.Panel
$x = 0
foreach ($t in @(@('成就', 'achievement'), @('完成', 'done'), @('金币', 'coin'), @('提醒', 'nudge'))) {
  $b = [ClawdUI.Pill]::new('▶ ' + $t[0], $false, $true)
  $b.BackColor = [ClawdUI.UI]::CardBg
  $b.Location = New-Object Drawing.Point($x, 0)
  $snd = $t[1]
  $b.Add_Click({
    $file = Join-Path $Root ("sounds\{0}-{1}.wav" -f $snd, (Get-ComboValue $volume))
    if (Test-Path $file) { (New-Object Media.SoundPlayer $file).Play() }
  }.GetNewClosure())
  $tryBox.Controls.Add($b)
  $x += $b.Width + (P 6)
}
$tryBox.Size = New-Object Drawing.Size(($x - (P 6)), (P 26))
$c2 = $pgSound.AddCard()
$c2.AddRow('试听', '', $tryBox)
$pgSound.AddNote('声音都是 Clawd 自己合成的，不会用到网络。')

$pgLook = New-Page 'Clawd 的样子' '外观' ([string][char]0xE771) 255 149 0
$c = $pgLook.AddCard()
$speed = New-Picker $speedOpts (Get-Pref 'speed');    $c.AddRow('动画速度', '', $speed)
$size  = New-Picker $sizeOpts (Get-Pref 'size');      $c.AddRow('聊天框上方的大小', '', $size)
$sleep = New-Picker $sleepOpts (Get-Pref 'sleepMin'); $c.AddRow('多久没动静就睡觉', '', $sleep)

$pgPomo = New-Page '番茄钟' '番茄钟' ([string][char]0xE916) 255 59 48
$c = $pgPomo.AddCard()
$pomoMin  = New-Picker $pomoOpts (Get-Pref 'pomoMin');       $c.AddRow('一个番茄专注', '', $pomoMin)
$breakMin = New-Picker $breakOpts (Get-Pref 'breakMin');     $c.AddRow('短休息', '', $breakMin)
$longMin  = New-Picker $longOpts2 (Get-Pref 'longBreakMin'); $c.AddRow('长休息', '每完成 4 个番茄，休息久一点', $longMin)
$pgPomo.AddNote('用 /clawd-pomo 开始或停止。专注期间完成过对话，才会得到 +15 金币和 +10 XP。')

$pgNight = New-Page '夜间模式' '夜间模式' ([string][char]0xE708) 0 64 221
$c = $pgNight.AddCard()
$nightFrom = New-Picker $nightOpts (Get-Pref 'nightFrom');      $c.AddRow('换睡衣的时间', '从这时开始，一直到早上 6 点', $nightFrom)
$nightNag  = New-Picker $nagOpts (Get-Pref 'nightRemindMin');   $c.AddRow('提醒你去睡觉', '', $nightNag)
$pgNight.AddNote('只有你最近 5 分钟还在用 Claude 时才会提醒；专注模式和番茄专注中不打扰。')

$pgWeek = New-Page '周报' '周报' ([string][char]0xE787) 52 199 89
$c = $pgWeek.AddCard()
$intern = New-Object Windows.Forms.TextBox
$intern.BorderStyle = 'None'
$intern.TextAlign = 'Right'
$intern.Font = [ClawdUI.UI]::F(10, 'Regular')
$intern.Width = P 130
$intern.Text = [string](Get-Pref 'internStart')
$c.AddRow('实习开始日期', '用来算"实习第几周"', $intern)
$pgWeek.AddNote('格式像 2026-10-06，留空 = 不设。周报用 /clawd-week 打开。')

foreach ($pg in @($pgFocus, $pgSound, $pgLook, $pgPomo, $pgNight, $pgWeek)) { $pg.Relayout() }

# ---------- 3. 底部按钮 ----------
$btnY = $H - (P 50)
$save = [ClawdUI.Pill]::new('保存', $true, $false)
$cancel = [ClawdUI.Pill]::new('取消', $false, $false)
$reset = [ClawdUI.LinkBtn]::new('恢复默认')
foreach ($b in @($save, $cancel, $reset)) { $b.BackColor = [ClawdUI.UI]::Bg; $form.Controls.Add($b) }
$save.Location = New-Object Drawing.Point(($W - $GUT - $save.Width), $btnY)
$cancel.Location = New-Object Drawing.Point(($save.Left - (P 10) - $cancel.Width), $btnY)
$reset.Location = New-Object Drawing.Point(($sideW + $GUT), $btnY)

$reset.Add_Click({
  $focus.Checked = $defaults.focus
  $showText.Checked = $defaults.showText
  $sound.Checked = $defaults.sound
  Set-Combo $volume $defaults.volume
  Set-Combo $long $defaults.longTaskSec
  Set-Combo $speed $defaults.speed
  Set-Combo $size $defaults.size
  Set-Combo $sleep $defaults.sleepMin
  Set-Combo $pomoMin $defaults.pomoMin
  Set-Combo $breakMin $defaults.breakMin
  Set-Combo $longMin $defaults.longBreakMin
  Set-Combo $nightFrom $defaults.nightFrom
  Set-Combo $nightNag $defaults.nightRemindMin
  $intern.Text = ''
})

$script:result = $null
$doSave = {
  $d = $intern.Text.Trim()
  if ($d -ne '' -and $d -notmatch '^\d{4}-\d{2}-\d{2}$') {
    $side.SelectedIndex = $side.Count - 1
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
    pomoMin     = [int](Get-ComboValue $pomoMin)
    breakMin    = [int](Get-ComboValue $breakMin)
    longBreakMin = [int](Get-ComboValue $longMin)
    nightFrom   = [int](Get-ComboValue $nightFrom)
    nightRemindMin = [int](Get-ComboValue $nightNag)
  }
  $form.Close()
}
$save.Add_Click($doSave)
$cancel.Add_Click({ $form.Close() })
# Enter = 保存，Esc = 取消
$form.Add_KeyDown({
  param($s, $e)
  if ($e.KeyCode -eq 'Escape') { $form.Close() }
  elseif ($e.KeyCode -eq 'Return') { $e.SuppressKeyPress = $true; & $doSave }
})

# 窗口弹出来时放到最前面
# Claude 启动这个脚本时带着"隐藏窗口"的标记（为了不闪出命令行黑框），
# Windows 会把程序第一次显示的窗口藏起来。所以窗口出现后，再明确叫它显示一次。
Add-Type -Namespace ClawdWin -Name User32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, string l);
'@
$form.Add_Shown({
  [void][ClawdWin.User32]::ShowWindow($form.Handle, 5)  # 5 = SW_SHOW
  [void][ClawdWin.User32]::SetForegroundWindow($form.Handle)
  $form.Activate()
  # 日期框里的灰色提示字（EM_SETCUEBANNER）
  [void][ClawdWin.User32]::SendMessage($intern.Handle, 0x1501, [IntPtr]1, '2026-10-06')
  $form.ActiveControl = $null
  if ($SelfTest) {
    # -SelfTest：报告窗口有没有真的看得见，然后自动按保存
    [Console]::Error.WriteLine("visible=" + [ClawdWin.User32]::IsWindowVisible($form.Handle))
    if ($Shot -ne '') {
      for ($i = 0; $i -lt $side.Count; $i++) {
        $side.SelectedIndex = $i
        $form.Refresh(); [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 150
        $bmp = New-Object Drawing.Bitmap($form.Width, $form.Height)
        $gr = [Drawing.Graphics]::FromImage($bmp)
        $gr.CopyFromScreen($form.Location, [Drawing.Point]::Empty, $form.Size)
        $bmp.Save((Join-Path $Shot "page$i.png"), [Drawing.Imaging.ImageFormat]::Png)
        $gr.Dispose(); $bmp.Dispose()
      }
      $side.SelectedIndex = 0
    }
    & $doSave
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
