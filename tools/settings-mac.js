// =====================================================================
// Clawd 设置窗口 · macOS 版
// 用 Mac 自带的 osascript（JavaScript for Automation）+ Cocoa 画一个真正的原生窗口：
// 开关是系统的 NSSwitch、下拉是 NSPopUpButton、「保存」是蓝色默认按钮——不用装任何东西。
//
// 和 Windows 版（settings.ps1）一样像传纸条：
//   1. Clawd 把"现在的设置"（JSON）当第 2 个参数递进来
//   2. 这里弹出窗口让你改
//   3. 按「保存」→ 印出一行 CLAWD_SETTINGS:{...}；按「取消」或关窗口 → 什么都不印
//
// 自己单独试：  osascript -l JavaScript tools/settings-mac.js "$PWD" '{}'
// ⚠️ 选项、默认值要和 settings.ps1、rules.ts 保持一致
// =====================================================================

ObjC.import('Cocoa')

const DEFAULTS = {
  focus: false, sound: true, volume: 'mid', longTaskSec: 30, sleepMin: 2,
  speed: 'normal', showText: true, size: 'medium', internStart: '',
  pomoMin: 25, breakMin: 5, longBreakMin: 15,
  nightFrom: 23, nightRemindMin: 30,
}

// 下拉选单的选项：[显示的字, 存起来的值]
const OPTS = {
  volume: [['低', 'low'], ['中', 'mid'], ['高', 'high']],
  longTaskSec: [['10 秒', 10], ['30 秒', 30], ['1 分钟', 60], ['2 分钟', 120]],
  sleepMin: [['1 分钟', 1], ['2 分钟', 2], ['5 分钟', 5], ['10 分钟', 10], ['永远不睡', 0]],
  speed: [['慢', 'slow'], ['正常', 'normal'], ['快', 'fast']],
  size: [['小', 'small'], ['中', 'medium'], ['大', 'large']],
  pomoMin: [['15 分钟', 15], ['25 分钟', 25], ['30 分钟', 30], ['45 分钟', 45], ['50 分钟', 50]],
  breakMin: [['3 分钟', 3], ['5 分钟', 5], ['10 分钟', 10]],
  longBreakMin: [['10 分钟', 10], ['15 分钟', 15], ['20 分钟', 20], ['30 分钟', 30]],
  nightFrom: [['晚上 9 点', 21], ['晚上 10 点', 22], ['晚上 11 点', 23], ['半夜 12 点', 24], ['关闭', 0]],
  nightRemindMin: [['每 15 分钟', 15], ['每 30 分钟', 30], ['每 1 小时', 60], ['不提醒', 0]],
}

// 每一页 = 一个分页标签；每一行 = [种类, 设置名, 标题, 小字说明]
const PAGES = [
  { title: '专注与打扰', note: '专注模式也可以用 /clawd-focus 快速开关。', rows: [
    ['switch', 'focus', '专注模式', '不说话、不弹提示、动画放慢'],
    ['switch', 'showText', '聊天框上方显示文字', '关掉之后只剩 Clawd 自己'],
  ] },
  { title: '提示音', note: '声音都是 Clawd 自己合成的，不会用到网络。', rows: [
    ['switch', 'sound', '开启提示音', ''],
    ['popup', 'volume', '音量', ''],
    ['popup', 'longTaskSec', '完成音', '任务超过这么久，做完时响一声'],
    ['try', '', '试听', ''],
  ] },
  { title: '外观', note: '', rows: [
    ['popup', 'speed', '动画速度', ''],
    ['popup', 'size', '聊天框上方的大小', ''],
    ['popup', 'sleepMin', '多久没动静就睡觉', ''],
  ] },
  { title: '番茄钟', note: '用 /clawd-pomo 开始或停止。专注期间完成过对话，才会得到 +15 金币和 +10 XP。', rows: [
    ['popup', 'pomoMin', '一个番茄专注', ''],
    ['popup', 'breakMin', '短休息', ''],
    ['popup', 'longBreakMin', '长休息', '每完成 4 个番茄，休息久一点'],
  ] },
  { title: '夜间模式', note: '只有你最近 5 分钟还在用 Claude 时才会提醒；专注模式和番茄专注中不打扰。', rows: [
    ['popup', 'nightFrom', '换睡衣的时间', '从这时开始，一直到早上 6 点'],
    ['popup', 'nightRemindMin', '提醒你去睡觉', ''],
  ] },
  { title: '周报', note: '格式像 2026-10-06，留空 = 不设。周报用 /clawd-week 打开。', rows: [
    ['date', 'internStart', '实习开始日期', '用来算"实习第几周"'],
  ] },
]

const SOUNDS = [['成就', 'achievement'], ['完成', 'done'], ['金币', 'coin'], ['提醒', 'nudge']]

function run(argv) {
  const root = argv[0] || '.'
  let cur = {}
  try { cur = JSON.parse(argv[1] || '{}') || {} } catch (e) { cur = {} }
  const pref = k => (k in cur ? cur[k] : DEFAULTS[k])

  const app = $.NSApplication.sharedApplication
  app.setActivationPolicy(0) // 0 = 普通 app：会出现在最前面、能打字
  addEditMenu(app)

  const W = 600, H = 400
  const win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0, 0, W, H), 1 | 2, 2, false) // 有标题栏 + 能关
  win.title = 'Clawd 设置'
  win.releasedWhenClosed = false
  win.level = 3 // 浮在其他窗口上面
  const content = win.contentView

  // ---------- 控件都记在这里，保存 / 恢复默认时用 ----------
  const controls = {} // 设置名 → { kind, view }
  let result = ''
  const players = [] // 正在播放的声音（留着引用，免得放到一半被回收）

  // 按钮按下去时要叫谁：注册一个小小的 Objective-C 类来接电话
  // （每次 osascript 都是全新的进程，所以直接注册就好）
  {
    ObjC.registerSubclass({
      name: 'ClawdTarget',
      methods: {
        'save:': { types: ['void', ['id']], implementation: () => doSave() },
        'cancel:': { types: ['void', ['id']], implementation: () => { result = ''; app.stopModal; win.orderOut(null) } },
        'reset:': { types: ['void', ['id']], implementation: () => applyValues(DEFAULTS) },
        'play:': { types: ['void', ['id']], implementation: sender => playSound(sender.tag) },
        'windowWillClose:': { types: ['void', ['id']], implementation: () => app.stopModal },
      },
    })
  }
  const target = $.ClawdTarget.alloc.init
  win.delegate = target

  // ---------- 分页 ----------
  const tabs = $.NSTabView.alloc.initWithFrame($.NSMakeRect(16, 52, W - 32, H - 64))
  content.addSubview(tabs)
  const pageW = W - 32 - 28 // 分页里面能用的宽度

  for (const page of PAGES) {
    const item = $.NSTabViewItem.alloc.initWithIdentifier($(page.title))
    item.label = page.title
    const v = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, pageW, H - 110))
    item.view = v
    let y = H - 110 - 12 // 从上往下排（Mac 的坐标原点在左下角，所以 y 越来越小）
    page.rows.forEach((row, i) => {
      const [kind, key, title, sub] = row
      const rowH = sub ? 48 : 36
      y -= rowH
      const label = $.NSTextField.labelWithString(title)
      label.font = $.NSFont.systemFontOfSize(13)
      label.frame = $.NSMakeRect(12, y + (sub ? 22 : 9), pageW - 220, 18)
      v.addSubview(label)
      if (sub) {
        const s = $.NSTextField.labelWithString(sub)
        s.font = $.NSFont.systemFontOfSize(11)
        s.textColor = $.NSColor.secondaryLabelColor
        s.frame = $.NSMakeRect(12, y + 5, pageW - 220, 16)
        v.addSubview(s)
      }
      const right = pageW - 12
      if (kind === 'switch') {
        const sw = newSwitch()
        sw.frame = $.NSMakeRect(right - 42, y + (rowH - 22) / 2, 42, 22)
        sw.state = pref(key) ? 1 : 0
        v.addSubview(sw)
        controls[key] = { kind, view: sw }
      } else if (kind === 'popup') {
        const pop = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(right - 150, y + (rowH - 26) / 2, 150, 26), false)
        for (const [name] of OPTS[key]) pop.addItemWithTitle(name)
        v.addSubview(pop)
        controls[key] = { kind, view: pop }
      } else if (kind === 'date') {
        const tf = $.NSTextField.alloc.initWithFrame($.NSMakeRect(right - 150, y + (rowH - 22) / 2, 150, 22))
        tf.placeholderString = '2026-10-06'
        tf.alignment = 2 // 靠右
        v.addSubview(tf)
        controls[key] = { kind, view: tf }
      } else if (kind === 'try') {
        let x = right
        for (let k = SOUNDS.length - 1; k >= 0; k--) {
          const b = $.NSButton.buttonWithTitleTargetAction('▶ ' + SOUNDS[k][0], target, 'play:')
          b.controlSize = 1 // 小号按钮
          b.font = $.NSFont.systemFontOfSize(11)
          b.sizeToFit
          const bw = b.frame.size.width
          x -= bw
          b.frame = $.NSMakeRect(x, y + (rowH - 24) / 2, bw, 24)
          b.tag = k
          v.addSubview(b)
          x -= 4
        }
      }
      // 行和行之间一条细线
      if (i < page.rows.length - 1) {
        const line = $.NSBox.alloc.initWithFrame($.NSMakeRect(12, y, pageW - 24, 1))
        line.boxType = 2 // 分隔线
        v.addSubview(line)
      }
    })
    if (page.note) {
      const n = $.NSTextField.wrappingLabelWithString(page.note)
      n.font = $.NSFont.systemFontOfSize(11)
      n.textColor = $.NSColor.secondaryLabelColor
      n.frame = $.NSMakeRect(12, y - 46, pageW - 24, 36)
      v.addSubview(n)
    }
    tabs.addTabViewItem(item)
  }
  applyValues(cur)

  // ---------- 底部按钮 ----------
  const save = $.NSButton.buttonWithTitleTargetAction('保存', target, 'save:')
  save.keyEquivalent = '\r' // Enter = 保存（Mac 会把它画成蓝色的默认按钮）
  save.frame = $.NSMakeRect(W - 16 - 90, 12, 90, 32)
  content.addSubview(save)
  const cancel = $.NSButton.buttonWithTitleTargetAction('取消', target, 'cancel:')
  cancel.keyEquivalent = '\u001b' // Esc = 取消
  cancel.frame = $.NSMakeRect(W - 16 - 90 - 8 - 90, 12, 90, 32)
  content.addSubview(cancel)
  const reset = $.NSButton.buttonWithTitleTargetAction('恢复默认', target, 'reset:')
  reset.frame = $.NSMakeRect(16, 12, 100, 32)
  content.addSubview(reset)

  win.center
  win.makeKeyAndOrderFront(null)
  app.activateIgnoringOtherApps(true)
  app.runModalForWindow(win) // 一直等到按了保存 / 取消 / 关窗口
  return result

  // ---------- 下面是用到的小帮手 ----------
  function newSwitch() {
    // macOS 10.15+ 有真正的开关 NSSwitch；更旧的系统退回成勾选框
    if (!$.NSClassFromString($('NSSwitch')).isNil()) return $.NSSwitch.alloc.initWithFrame($.NSMakeRect(0, 0, 42, 22))
    const c = $.NSButton.alloc.initWithFrame($.NSMakeRect(0, 0, 42, 22))
    c.setButtonType(3) // 勾选框
    c.title = ''
    return c
  }

  function applyValues(values) {
    for (const key of Object.keys(controls)) {
      const { kind, view } = controls[key]
      const val = key in values ? values[key] : DEFAULTS[key]
      if (kind === 'switch') view.state = val ? 1 : 0
      else if (kind === 'date') view.stringValue = String(val || '')
      else {
        let idx = OPTS[key].findIndex(o => String(o[1]) === String(val))
        if (idx < 0) idx = OPTS[key].findIndex(o => String(o[1]) === String(DEFAULTS[key]))
        view.selectItemAtIndex(Math.max(0, idx))
      }
    }
  }

  function readValues() {
    const out = {}
    for (const key of Object.keys(DEFAULTS)) {
      const c = controls[key]
      if (!c) { out[key] = pref(key); continue }
      if (c.kind === 'switch') out[key] = c.view.state === 1
      else if (c.kind === 'date') out[key] = ObjC.unwrap(c.view.stringValue).trim()
      else out[key] = OPTS[key][c.view.indexOfSelectedItem][1]
    }
    return out
  }

  function doSave() {
    const values = readValues()
    if (values.internStart !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(values.internStart)) {
      tabs.selectTabViewItemAtIndex(PAGES.length - 1)
      const alert = $.NSAlert.alloc.init
      alert.messageText = '实习开始日期的格式要像 2026-10-06'
      alert.runModal
      return
    }
    result = 'CLAWD_SETTINGS:' + JSON.stringify(values)
    app.stopModal
    win.orderOut(null)
  }

  function playSound(i) {
    const s = SOUNDS[i]
    if (!s) return
    const vol = OPTS.volume[controls.volume.view.indexOfSelectedItem][1]
    const path = root + '/sounds/' + s[1] + '-' + vol + '.wav'
    const snd = $.NSSound.alloc.initWithContentsOfFileByReference($(path), true)
    if (snd.isNil()) return
    players.push(snd)
    snd.play
  }
}

/** 加一个「编辑」菜单：没有它，日期框里 ⌘C / ⌘V 不能用 */
function addEditMenu(app) {
  const bar = $.NSMenu.alloc.init
  const appItem = $.NSMenuItem.alloc.init
  bar.addItem(appItem)
  const appMenu = $.NSMenu.alloc.init
  appMenu.addItemWithTitleActionKeyEquivalent('关闭', 'performClose:', 'w')
  appItem.submenu = appMenu
  const editItem = $.NSMenuItem.alloc.init
  bar.addItem(editItem)
  const edit = $.NSMenu.alloc.initWithTitle('编辑')
  for (const [t, a, k] of [['剪切', 'cut:', 'x'], ['拷贝', 'copy:', 'c'], ['粘贴', 'paste:', 'v'], ['全选', 'selectAll:', 'a']]) {
    edit.addItemWithTitleActionKeyEquivalent(t, a, k)
  }
  editItem.submenu = edit
  app.mainMenu = bar
}
