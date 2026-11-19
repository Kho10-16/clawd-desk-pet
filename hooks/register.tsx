import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

import type { Dex, Mood, Pet, Pomo, Prefs, Progress, Slot, WeekView } from '../types'
import { buildWeek, loadDays, loadToday, logProject, logToday, logTool, top, weekMarkdown } from './report'
import { ALL_DONE_COINS, ALL_DONE_MARK, ALL_DONE_XP, questsFor } from './quests'
import { ABOVE, LINES, MOOD_LABEL, clawdSvg, clawdText } from './art'
import {
  BADGES,
  COIN_BADGE,
  COIN_DAILY,
  COIN_LEVEL,
  COIN_POMO,
  COIN_TOOL,
  COIN_TURN,
  FOODS,
  EDIT_TOOLS,
  FOOD_TOOL,
  FOOD_TURN,
  FORM_LABEL,
  FORM_NEXT,
  HUNGRY_BELOW,
  ITEMS,
  KIND_SAY,
  SIZE_PX,
  SKITS_BY_FORM,
  SKITS_COMMON,
  SKITS_NIGHT,
  SPEED_MUL,
  SLOT_LABEL,
  STREAK_DOUBLE_AT,
  XP_DAILY,
  XP_EDIT,
  XP_POMO,
  XP_TOOL,
  XP_TURN,
  dayKey,
  emptyProgress,
  formOf,
  fullnessAt,
  isNightAt,
  levelOf,
  toolKind,
  xpForLevel,
} from './rules'
import type { Ctx, Food, Form, Skit } from './rules'

const PANE = 'desk-pet'
const TITLE = 'Clawd'
const STORE_KEY = 'progress-v2'
const SLOTS: Slot[] = ['head', 'face', 'neck']

// =====================================================================
// 状态
//   $.store  = 长期存档，所有聊天共用，是"唯一真相"
//   pet atom = 这个聊天里的镜像 + 心情、动画帧这些临时状态
// =====================================================================

const initial: Pet = {
  ...emptyProgress,
  mood: 'idle',
  moodUntil: 0,
  lastActive: 0,
  tool: '',
  say: '嗨！我是 Clawd',
  skit: '',
  skitUntil: 0,
  nextSkitAt: 0,
  pomoLeft: 0,
}

// shape 换成 pet-7：存档里加了 nightNagAt（夜间提醒），旧结构作废
const pet = atom({ plugin: 'desk-pet', key: 'pet' } as const, initial, {
  shape: 'pet-7',
})

// 动画帧单独放：只有终端文字版会读它。
// 如果放在 pet 里，每 0.7 秒一变，所有面板都会重画 → 滚动条被弹回顶部。
const frameAtom = atom({ plugin: 'desk-pet', key: 'frame' } as const, 0)

// ---------- 📋 周报面板 ----------
const WEEK_PANE = 'desk-pet-week'
const weekView = atom(
  { plugin: 'desk-pet', key: 'week' } as const,
  { offset: 0, note: '', refresh: 0 } as WeekView,
  { shape: 'week-1' },
)

// =====================================================================
// ⚙️ 设置窗口：在 Claude 外面弹一个 Windows 原生窗口（tools/settings.ps1）
//   像传纸条：现在的设置从 stdin 递进去 → 你在窗口里改 → 保存时窗口印出
//   一行 CLAWD_SETTINGS:{...} → Clawd 读到就存档，所有聊天同步
// =====================================================================

let settingsOpen = false // 同一时间只开一个窗口

/** 返回 true = 窗口已弹出（不等你关掉窗口） */
async function openSettingsWindow($: EngineInterface): Promise<boolean> {
  if (settingsOpen) {
    $.ui.toast('Clawd：设置窗口已经开着啦（可能在别的窗口后面）')
    return true
  }
  const { platform } = await $.session.info()
  if (platform !== 'windows' && platform !== 'macos') {
    $.ui.toast('Clawd：设置窗口目前只支持 Windows 和 macOS')
    return false
  }
  settingsOpen = true
  const current = (await loadProgress($)).prefs

  // Windows：PowerShell 窗口，设置从 stdin 递进去
  // macOS：osascript（JavaScript）画的原生 Cocoa 窗口，设置当参数递进去
  // 两边保存时都印出同一种 CLAWD_SETTINGS:{...}
  let argv: string[]
  let input: string | undefined
  if (platform === 'windows') {
    const root = $.plugin.root.replace(/\//g, '\\')
    argv = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', `${root}\\tools\\settings.ps1`, '-Root', root]
    input = JSON.stringify(current)
  } else {
    const root = $.plugin.root
    argv = ['osascript', '-l', 'JavaScript', `${root}/tools/settings-mac.js`, root, JSON.stringify(current)]
  }

  // 在后台等窗口关掉：窗口开多久都没关系，不会卡住 Claude
  void (async () => {
    let out = ''
    try {
      const child = $.process.spawn(input === undefined ? { argv } : { argv, input })
      for await (const piece of child) {
        if (piece.stream === 'stdout') out += piece.text
      }
      const line = out.split(/\r?\n/).find(l => l.startsWith('CLAWD_SETTINGS:'))
      if (!line) return // 按了取消 / 关掉窗口
      const next = cleanPrefs(JSON.parse(line.slice('CLAWD_SETTINGS:'.length)) as Partial<Prefs>)
      await commit($, s => ({ ...s, prefs: { ...s.prefs, ...next } }))
      await setMood($, 'happy', { holdMs: 3000, say: '设置已保存 ✨' })
    } catch {
      $.ui.toast('Clawd：设置窗口出了点问题，设置没有改')
    } finally {
      settingsOpen = false
    }
  })()
  return true
}

/** 只收下认得的、合法的值（窗口那边就算传来奇怪的东西也不会弄坏存档） */
function cleanPrefs(x: Partial<Prefs>): Partial<Prefs> {
  const d = emptyProgress.prefs
  const pickOne = <T extends string>(v: unknown, ok: readonly T[], fallback: T): T =>
    typeof v === 'string' && (ok as readonly string[]).includes(v) ? (v as T) : fallback
  const num = (v: unknown, ok: number[], fallback: number) => (typeof v === 'number' && ok.includes(v) ? v : fallback)
  return {
    focus: typeof x.focus === 'boolean' ? x.focus : d.focus,
    sound: typeof x.sound === 'boolean' ? x.sound : d.sound,
    showText: typeof x.showText === 'boolean' ? x.showText : d.showText,
    volume: pickOne(x.volume, ['low', 'mid', 'high'] as const, d.volume),
    speed: pickOne(x.speed, ['slow', 'normal', 'fast'] as const, d.speed),
    size: pickOne(x.size, ['small', 'medium', 'large'] as const, d.size),
    longTaskSec: num(x.longTaskSec, [10, 30, 60, 120], d.longTaskSec),
    sleepMin: num(x.sleepMin, [0, 1, 2, 5, 10], d.sleepMin),
    internStart: typeof x.internStart === 'string' && /^(\d{4}-\d{2}-\d{2})?$/.test(x.internStart) ? x.internStart : d.internStart,
    pomoMin: num(x.pomoMin, [15, 25, 30, 45, 50], d.pomoMin),
    breakMin: num(x.breakMin, [3, 5, 10], d.breakMin),
    longBreakMin: num(x.longBreakMin, [10, 15, 20, 30], d.longBreakMin),
    nightFrom: num(x.nightFrom, [0, 21, 22, 23, 24], d.nightFrom),
    nightRemindMin: num(x.nightRemindMin, [0, 15, 30, 60], d.nightRemindMin),
  }
}

/** Windows：用 PowerShell 把文字放进剪贴板（文字从 stdin 传进去，不会被当成命令） */
async function copyToClipboard($: EngineInterface, text: string): Promise<boolean> {
  try {
    const { platform } = await $.session.info()
    if (platform !== 'windows') return false
    const r = await $.process.run(
      ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', '[Console]::InputEncoding=[Text.Encoding]::UTF8; $input | Out-String | Set-Clipboard'],
      { stdin: text, timeoutMs: 10000 },
    )
    return r.exitCode === 0
  } catch {
    return false
  }
}

// ---------- 📖 图鉴：只是预览，不会解锁 ----------
const DEX_PANE = 'desk-pet-dex'
const dex = atom(
  { plugin: 'desk-pet', key: 'dex' } as const,
  { form: 'baby', act: 'idle', outfit: { head: '', face: '', neck: '' } } as Dex,
  { shape: 'dex-1' },
)

const DEX_FORMS: { id: Form; unlockLv: number }[] = [
  { id: 'baby', unlockLv: 1 },
  { id: 'teen', unlockLv: 5 },
  { id: 'gent', unlockLv: 10 },
  { id: 'shiny', unlockLv: 20 },
]

/** 图鉴里能预览的动作：心情 + 每种工具的专属动作 */
const DEX_ACTS: { value: string; label: string }[] = [
  { value: 'idle', label: '发呆' },
  { value: 'thinking', label: '思考' },
  { value: 'happy', label: '开心' },
  { value: 'love', label: '被摸头' },
  { value: 'sleepy', label: '睡觉' },
  { value: 'hungry', label: '饿了' },
  { value: 'sad', label: '难过' },
  { value: 'oops', label: '出错' },
  { value: 'waiting', label: '🪧 等你回复' },
  { value: 'work:Bash', label: '⌨️ 敲命令 (Bash)' },
  { value: 'work:Read', label: '📖 读代码 (Read)' },
  { value: 'work:Edit', label: '🔨 改代码 (Edit)' },
  { value: 'work:WebSearch', label: '🔭 上网查 (WebSearch)' },
  { value: 'work:TodoWrite', label: '📋 列计划 (TodoWrite)' },
  { value: "work:other", label: "⚙ 其他工具" },
  ...[...SKITS_COMMON, ...Object.values(SKITS_BY_FORM).flat()].map(s => ({ value: `skit:${s.id}`, label: `🎭 ${s.name}` })),
  { value: 'night:idle', label: '🌙 夜里发呆（睡衣 + 睡帽）' },
  { value: 'night:sleepy', label: '🌙 夜里睡觉' },
  ...SKITS_NIGHT.map(s => ({ value: `nskit:${s.id}`, label: `🌙 ${s.name}` })),
]

/** "work:Edit" → 心情 working + 工具 Edit；"happy" → 心情 happy */
/** "work:Edit" → 干活 + Edit；"skit:tea" → 发呆 + 小剧场 tea；"happy" → 心情 happy */
function parseAct(act: string): { mood: Mood; tool: string; skit: string; night: boolean } {
  if (act.startsWith("work:")) return { mood: "working", tool: act.slice(5), skit: "", night: false }
  if (act.startsWith("skit:")) return { mood: "idle", tool: "", skit: act.slice(5), night: false }
  if (act.startsWith("nskit:")) return { mood: "idle", tool: "", skit: act.slice(6), night: true }
  if (act.startsWith("night:")) return { mood: act.slice(6) as Mood, tool: "", skit: "", night: true }
  return { mood: act as Mood, tool: "", skit: "", night: false }
}

async function loadProgress($: EngineInterface): Promise<Progress> {
  const saved = (await $.store.get(STORE_KEY)) as Partial<Progress> | undefined
  return {
    ...emptyProgress,
    ...saved,
    outfit: { ...emptyProgress.outfit, ...saved?.outfit },
    prefs: { ...emptyProgress.prefs, ...saved?.prefs },
    pomo: { ...emptyProgress.pomo, ...saved?.pomo },
  }
}

// =====================================================================
// 提示音
//   Windows：用系统自带的 PowerShell 播放（$.audio 在 Windows 上没有播放器）
//   其他系统：用 $.audio.play
// =====================================================================

type Sound = 'achievement' | 'done' | 'coin' | 'nudge'

/** 动画时长倍数 = 设置里的速度 ×（专注模式再慢一倍） */
function tempoOf(prefs: Prefs): number {
  return SPEED_MUL[prefs.speed] * (prefs.focus ? 2 : 1)
}

async function playSound($: EngineInterface, sound: Sound) {
  try {
    const { volume } = (await loadProgress($)).prefs
    const name = `${sound}-${volume}.wav` // 每个声音都有 low / mid / high 三个文件
    const { platform } = await $.session.info()
    if (platform === 'windows') {
      const file = `${$.plugin.root}\\sounds\\${name}`.replace(/\//g, '\\').replace(/'/g, "''")
      await $.process.run(
        ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `(New-Object Media.SoundPlayer '${file}').PlaySync()`],
        { timeoutMs: 10000 },
      )
    } else {
      await $.audio.play({ asset: `sounds/${name}` })
    }
  } catch {
    // 放不出声音也没关系，别影响 Claude 干活
  }
}

/**
 * 修改长期存档的唯一入口：
 *   1. 先读存档里最新的值（别的聊天可能刚改过）
 *   2. 在它上面做修改
 *   3. 检查升级 / 徽章 / 新装扮
 *   4. 写回存档，并同步到这个聊天的画面
 * 这样多个聊天同时开着，也是在同一份进度上"累加"，不会互相覆盖。
 */
async function commit(
  $: EngineInterface,
  change: (s: Progress, now: number) => Progress,
  opts: { isUse?: boolean } = {},
): Promise<number> {
  const now = await $.clock.now()
  const d = new Date(now)
  const ctx: Ctx = { hour: d.getHours(), month: d.getMonth() + 1, isUse: opts.isUse ?? false }

  const before = await loadProgress($)
  const after = change(before, now)
  const news: string[] = []

  // 升级 / 进化
  const lb = levelOf(before.xp)
  const la = levelOf(after.xp)
  if (la > lb) {
    const f = formOf(la)
    news.push(f !== formOf(lb) ? `进化啦！Lv.${la} ${FORM_LABEL[f]} 🎉` : `升级啦！Lv.${la} 🎉`)
    after.coins += la * COIN_LEVEL // 升级奖励金币
  }

  // 徽章
  const newBadges = BADGES.filter(b => !after.badges.includes(b.id) && b.test(after, ctx))
  if (newBadges.length > 0) {
    after.badges = [...after.badges, ...newBadges.map(b => b.id)]
    for (const b of newBadges) news.push(`🏅 解锁徽章「${b.name}」`)
    after.coins += newBadges.length * COIN_BADGE // 每枚徽章奖励金币
  }

  // 装扮（放在徽章后面，因为"金牌"要看徽章数量）
  const newItems = ITEMS.filter(i => !after.wardrobe.includes(i.id) && i.test(after, ctx))
  if (newItems.length > 0) {
    after.wardrobe = [...after.wardrobe, ...newItems.map(i => i.id)]
    for (const i of newItems) {
      news.push(`👗 新装扮「${i.name}」`)
      // 那个位置空着的话，自动穿上
      if (after.outfit[i.slot] === '') after.outfit = { ...after.outfit, [i.slot]: i.id }
    }
  }

  await $.store.set(STORE_KEY, after)
  await update($, pet, p => ({
    ...p,
    ...after,
    say: news.length > 0 ? (news[news.length - 1] ?? p.say) : p.say,
  }))
  // 专注模式不弹提示（消息还是会记在 /pet 面板里）
  if (!after.prefs.focus) {
    for (const n of news) $.ui.toast(`Clawd：${n}`)
  }
  // 🏆 有新成就就响成就音（不等它放完）
  if (news.length > 0 && after.prefs.sound) void playSound($, 'achievement')
  return news.length
}

/** 真正"使用"了 Claude Code：加经验、喂饱食度、记统计 */
function gain(
  $: EngineInterface,
  g: { xp?: number; coins?: number; food?: number; turns?: number; tools?: number; edits?: number },
) {
  return commit(
    $,
    (s, now) => ({
      ...s,
      xp: s.xp + (g.xp ?? 0),
      coins: s.coins + (g.coins ?? 0),
      turns: s.turns + (g.turns ?? 0),
      tools: s.tools + (g.tools ?? 0),
      edits: s.edits + (g.edits ?? 0),
      ...(g.food ? { fullness: Math.min(100, fullnessAt(s, now) + g.food), lastFed: now } : {}),
    }),
    { isUse: true },
  )
}

// =====================================================================
// 🛒 商店：花金币
//   钱够才扣，在存档最新的值上判断（两个聊天同时买也不会扣成负数）
// =====================================================================

async function buyFood($: EngineInterface, f: Food) {
  let ok = false
  let short = 0
  await commit($, (s, now) => {
    if (s.coins < f.price) {
      short = f.price - s.coins
      return s
    }
    ok = true
    return { ...s, coins: s.coins - f.price, fullness: Math.min(100, fullnessAt(s, now) + f.food), lastFed: now }
  })
  if (ok) {
    await setMood($, 'happy', { holdMs: 4000, say: f.say })
    if ((await loadProgress($)).prefs.sound) void playSound($, 'coin')
  } else {
    await setMood($, 'sad', { holdMs: 3000, say: `还差 ${short} 💰……多干点活吧` })
  }
}

async function buyItem($: EngineInterface, id: string) {
  const item = ITEMS.find(i => i.id === id)
  if (!item || item.price === undefined) return
  const price = item.price
  let ok = false
  let short = 0
  await commit($, s => {
    if (s.wardrobe.includes(id)) return s
    if (s.coins < price) {
      short = price - s.coins
      return s
    }
    ok = true
    return {
      ...s,
      coins: s.coins - price,
      wardrobe: [...s.wardrobe, id],
      outfit: { ...s.outfit, [item.slot]: id }, // 买了马上穿上
    }
  })
  if (ok) {
    await setMood($, 'happy', { holdMs: 5000, say: `买到「${item.name}」啦！马上穿上 ✨` })
    if ((await loadProgress($)).prefs.sound) void playSound($, 'coin')
  } else if (short > 0) {
    await setMood($, 'sad', { holdMs: 3000, say: `还差 ${short} 💰……多干点活吧` })
  }
}

/** 每天第一次使用：打卡 */
async function checkIn($: EngineInterface) {
  const now = await $.clock.now()
  const today = dayKey(now)
  if ((await loadProgress($)).lastDay === today) return

  let streak = 1
  let bonus = 0
  await commit(
    $,
    s => {
      if (s.lastDay === today) return s // 别的聊天刚好先打过卡
      streak = s.lastDay === dayKey(now - 86400000) ? s.streak + 1 : 1
      bonus = XP_DAILY * (streak >= STREAK_DOUBLE_AT ? 2 : 1)
      return { ...s, streak, lastDay: today, xp: s.xp + bonus, coins: s.coins + COIN_DAILY }
    },
    { isUse: true },
  )
  if (bonus > 0) $.ui.toast(`Clawd：打卡成功，连续 ${streak} 天 🔥 +${bonus} XP`)
}

/** 从存档同步到画面（别的聊天升级了，这里也能看到） */
async function sync($: EngineInterface) {
  const s = await loadProgress($)
  const p = await read($, pet)
  // 存档没变就什么都不写，免得面板白白重画
  if (JSON.stringify(s) === JSON.stringify({ ...emptyProgress, ...pickProgress(p) })) return
  await update($, pet, q => ({ ...q, ...s }))
}

/** 从 Pet 里只取出要存档的那部分 */
function pickProgress(p: Pet): Progress {
  const out = {} as Record<string, unknown>
  for (const k of Object.keys(emptyProgress)) out[k] = (p as unknown as Record<string, unknown>)[k]
  return out as Progress
}

function pick(list: string[], seed: number): string {
  return list.length === 0 ? '' : (list[seed % list.length] ?? '')
}

function bar(frac: number, len: number): string {
  const filled = Math.max(0, Math.min(len, Math.round(frac * len)))
  return '█'.repeat(filled) + '░'.repeat(len - filled)
}

async function setMood(
  $: EngineInterface,
  mood: Mood,
  opts: { holdMs?: number; tool?: string; say?: string } = {},
) {
  const now = await $.clock.now()
  await update($, pet, p => ({
    ...p,
    mood,
    moodUntil: opts.holdMs ? now + opts.holdMs : 0,
    lastActive: now,
    tool: opts.tool ?? p.tool,
    say: opts.say ?? pick(LINES[mood], Math.floor(now / 1000)),
    // 一有正事，小剧场马上停，过一阵子再演
    skit: '',
    skitUntil: 0,
    nextSkitAt: now + randomBetween(SKIT_GAP_MIN, SKIT_GAP_MAX),
  }))
}

// =====================================================================
// 🎭 发呆小剧场：闲着的时候，每隔一阵子随机演一段
// =====================================================================

const SKIT_GAP_MIN = 20000 // 两段小剧场之间最少隔 20 秒
const SKIT_GAP_MAX = 45000 // 最多隔 45 秒

function randomBetween(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo))
}

function chooseSkit(form: Form, night = false): Skit {
  // 🌙 夜里：只演困困的戏（打哈欠、伸懒腰 + 夜间专属）
  const sleepyOnes = SKITS_COMMON.filter(k => k.id === 'yawn' || k.id === 'stretch')
  const list = night ? [...SKITS_NIGHT, ...sleepyOnes] : [...SKITS_COMMON, ...SKITS_BY_FORM[form]]
  return list[Math.floor(Math.random() * list.length)] ?? SKITS_COMMON[0]!
}

// =====================================================================
// 🌙 夜间模式：换睡衣、动作变慢、温柔提醒你去睡觉
// =====================================================================

const NIGHT_IDLE = ['夜深了……', '月亮出来啦 🌙', '再写一点点就睡吧？', '好安静的晚上']
const NIGHT_NAGS = [
  '已经 {t} 了，Clawd 都打哈欠了……早点睡吧 🌙',
  '{t} 了！剩下的明天再写也不迟～',
  '熬夜会变熊猫眼哦 🐼（现在 {t}）',
  'Clawd 困了……你也该休息啦（{t}）',
]

function clockText(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 抢"这一次提醒"：多个聊天同时开着，只有先抢到的那个会提醒（存在存档里） */
async function claimNightNag($: EngineInterface, now: number): Promise<boolean> {
  const cur = await loadProgress($)
  const gap = cur.prefs.nightRemindMin * 60000
  if (gap === 0 || now - cur.nightNagAt < gap) return false
  let got = false as boolean
  await commit($, x => {
    if (now - x.nightNagAt < gap) return x
    got = true
    return { ...x, nightNagAt: now }
  })
  return got
}

// =====================================================================
// 🍅 番茄钟：专注 → 休息 → 专注……（存在存档里，所有聊天共用同一个）
// =====================================================================

const POMO_IDLE: Pomo = { phase: 'idle', endsAt: 0, round: 0, turnsAtStart: 0, prevFocus: false }

/** 开始一个番茄：25 分钟专注，自动打开专注模式 */
async function startPomo($: EngineInterface) {
  const now = await $.clock.now()
  await commit($, s => ({
    ...s,
    pomo: {
      phase: 'focus',
      endsAt: now + s.prefs.pomoMin * 60000,
      round: s.pomo.round,
      turnsAtStart: s.turns,
      // 如果是从休息直接开下一个，保留最初的专注模式开关
      prevFocus: s.pomo.phase === 'idle' ? s.prefs.focus : s.pomo.prevFocus,
    },
    prefs: { ...s.prefs, focus: true },
  }))
  const { prefs } = await loadProgress($)
  await setMood($, 'happy', { holdMs: 4000, say: `🍅 开始专注 ${prefs.pomoMin} 分钟！我会安静陪着你` })
}

/** 停掉番茄钟，专注模式还原成开始前的样子 */
async function stopPomo($: EngineInterface, say = '番茄钟停下来了') {
  await commit($, s => ({ ...s, pomo: { ...POMO_IDLE }, prefs: { ...s.prefs, focus: s.pomo.prevFocus } }))
  await setMood($, 'idle', { say })
}

/**
 * 时间到了：专注 → 休息，或者 休息 → 结束。
 * 几个聊天同时开着时，只有第一个发现"时间到"的聊天会真的切换（其他的看到 endsAt 变了就不动）。
 */
async function finishPomoPhase($: EngineInterface, expectedEndsAt: number) {
  const now = await $.clock.now()
  let what = 'none' as 'none' | 'focusDone' | 'breakDone' // 用 as：TS 看不出它会在下面的函数里被改
  let earned = false
  let breakMin = 0
  let isLong = false

  await commit(
    $,
    s => {
      if (s.pomo.phase === 'idle' || s.pomo.endsAt !== expectedEndsAt) return s // 别的聊天已经处理过了
      if (s.pomo.phase === 'focus') {
        what = 'focusDone'
        earned = s.turns > s.pomo.turnsAtStart // 这段时间真的有和 Claude 完成对话
        const round = s.pomo.round + 1
        isLong = round % 4 === 0
        breakMin = isLong ? s.prefs.longBreakMin : s.prefs.breakMin
        return {
          ...s,
          coins: s.coins + (earned ? COIN_POMO : 0),
          xp: s.xp + (earned ? XP_POMO : 0),
          pomoTotal: s.pomoTotal + (earned ? 1 : 0),
          pomo: { ...s.pomo, phase: 'break', endsAt: now + breakMin * 60000, round: isLong ? 0 : round },
        }
      }
      // 休息结束
      what = 'breakDone'
      return { ...s, pomo: { ...POMO_IDLE, round: s.pomo.round }, prefs: { ...s.prefs, focus: s.pomo.prevFocus } }
    },
    { isUse: true },
  )

  const { prefs } = await loadProgress($)
  if (what === 'focusDone') {
    if (earned) await logToday($, d => {
      d.pomos = (d.pomos ?? 0) + 1
    })
    const msg = earned
      ? `🍅 番茄完成！+${COIN_POMO}💰 +${XP_POMO} XP。${isLong ? '连续 4 个了，' : ''}休息 ${breakMin} 分钟，喝口水、站起来走走吧`
      : `🍅 时间到！这段时间没有完成对话，就不发奖励啦。休息 ${breakMin} 分钟吧`
    $.ui.toast(`Clawd：${msg}`) // 番茄钟的提醒就算在专注模式也要弹
    await setMood($, 'happy', { holdMs: 8000, say: msg })
    if (prefs.sound) void playSound($, 'achievement')
  } else if (what === 'breakDone') {
    $.ui.toast('Clawd：☕ 休息结束！要开始下一个番茄吗？（/clawd-pomo）')
    await setMood($, 'happy', { holdMs: 8000, say: '☕ 休息结束！准备好开始下一个番茄了吗？' })
    if (prefs.sound) void playSound($, 'nudge')
  }
}

// =====================================================================
// 📅 每日任务：每次小账本记了一笔，就看看今天的任务有没有新完成的
// =====================================================================

/** 返回这次新领了几个奖 */
async function checkQuests($: EngineInterface): Promise<number> {
  const now = await $.clock.now()
  const today = dayKey(now)
  const quests = questsFor(today)
  const log = await loadToday($)
  const news: string[] = []
  let isAllDone = false

  await commit(
    $,
    s => {
      // 新的一天：清空昨天的完成记录
      const done = s.questDay === today ? [...s.questDone] : []
      let { coins, xp, questFullDays } = s
      for (const q of quests) {
        if (!done.includes(q.key) && q.measure(log) >= q.target) {
          done.push(q.key)
          coins += q.coins
          xp += q.xp
          news.push(`✅ 每日任务「${q.text}」完成！+${q.coins}💰 +${q.xp} XP`)
        }
      }
      const allFinished = quests.every(q => done.includes(q.key))
      if (allFinished && !done.includes(ALL_DONE_MARK)) {
        done.push(ALL_DONE_MARK)
        coins += ALL_DONE_COINS
        xp += ALL_DONE_XP
        questFullDays++
        isAllDone = true
        news.push(`🏆 今天的任务全部完成！大奖 +${ALL_DONE_COINS}💰 +${ALL_DONE_XP} XP`)
      }
      return { ...s, questDay: today, questDone: done, coins, xp, questFullDays }
    },
    { isUse: true },
  )

  if (news.length > 0) {
    const { prefs } = await loadProgress($)
    if (!prefs.focus) for (const n of news) $.ui.toast(`Clawd：${n}`)
    await setMood($, 'happy', { holdMs: 5000, say: news[news.length - 1] })
    if (prefs.sound) void playSound($, isAllDone ? 'achievement' : 'coin')
  }
  return news.length
}

// =====================================================================
// 👋 等你回复：Claude 问你问题、或者等你批准权限时，Clawd 举牌子 + 叮咚一声
// =====================================================================

/** 正在等你回复的东西：问题用 tool_use_id，权限用 "perm:工具名" */
const waitingFor = new Set<string>()

async function startWaiting($: EngineInterface, key: string, tool: string, say: string) {
  waitingFor.add(key)
  await setMood($, 'waiting', { tool, say })
  if ((await loadProgress($)).prefs.sound) void playSound($, 'nudge')
}

/** 返回 true = 刚才真的有在等你（牌子举起来过） */
function stopWaiting(key: string): boolean {
  return waitingFor.delete(key)
}

// =====================================================================
// 主体：接上 Claude Code 的各种事件
// =====================================================================

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // 旧版只存了摸头次数，搬过来
    if ((await $.store.get(STORE_KEY)) === undefined) {
      const old = (await $.store.get('progress')) as { pets?: number } | undefined
      if (old?.pets) await $.store.set(STORE_KEY, { ...emptyProgress, pets: old.pets })
    }
    const now = await $.clock.now()
    await sync($)
    await update($, pet, p => ({ ...p, lastActive: p.lastActive || now }))

    await $.command.register({ name: 'pet', description: '打开 Clawd 养成面板' })
    await $.command.register({ name: 'clawd-focus', description: '开关 Clawd 的专注模式' })
    await $.command.register({ name: 'clawd-dex', description: '打开 Clawd 图鉴：预览所有形态、动作和装扮' })
    await $.command.register({ name: 'clawd-week', description: '打开 Clawd 周报：本周统计 + 一键生成周报草稿' })
    await $.command.register({ name: 'clawd-settings', description: '弹出 Clawd 设置窗口（Windows）' })
    await $.command.register({ name: 'clawd-pomo', description: '🍅 开始 / 停止番茄钟' })
    void $.ui.open({ id: PANE, title: TITLE })

    // 心跳：每 0.7 秒检查一次心情过期、肚子饿、睡觉、要不要演小剧场；约每 7 秒从存档同步一次
    let ticks = 0
    $.clock.every(700, async () => {
      ticks++
      await update($, frameAtom, f => (f + 1) % 1000) // 只有终端文字版读它
      if (ticks % 10 === 0) await sync($)
      const t = await $.clock.now()
      const p = await read($, pet)
      const seed = Math.floor(t / 1000)

      const night = isNightAt(p.prefs.nightFrom, t)

      let { mood, moodUntil, say, skit, skitUntil, nextSkitAt } = p
      if (moodUntil !== 0 && t > moodUntil) {
        mood = 'idle'
        moodUntil = 0
        say = pick(night ? NIGHT_IDLE : LINES.idle, seed)
      }
      const isHungry = fullnessAt(p, t) < HUNGRY_BELOW
      if (mood === 'idle' && isHungry) {
        mood = 'hungry'
        say = pick(LINES.hungry, seed)
      } else if (mood === 'hungry' && !isHungry) {
        mood = 'idle'
      }
      if ((mood === 'idle' || mood === 'hungry') && p.prefs.sleepMin > 0 && t - p.lastActive > p.prefs.sleepMin * 60000) {
        mood = 'sleepy'
        say = pick(LINES.sleepy, seed)
      }

      // 🎭 小剧场：演完就收场；发呆够久了就随机开演（专注模式不演）
      if (skit !== '' && (t > skitUntil || mood !== 'idle')) {
        skit = ''
        nextSkitAt = t + randomBetween(SKIT_GAP_MIN, SKIT_GAP_MAX)
        if (mood === 'idle') say = pick(night ? NIGHT_IDLE : LINES.idle, seed)
      } else if (skit === '' && mood === 'idle' && !p.prefs.focus) {
        if (nextSkitAt === 0) nextSkitAt = t + randomBetween(SKIT_GAP_MIN, SKIT_GAP_MAX)
        else if (t >= nextSkitAt) {
          const s = chooseSkit(formOf(levelOf(p.xp)), night)
          skit = s.id
          skitUntil = t + s.ms
          say = s.say
        }
      }

      // 🌙 该睡觉提醒：你最近 5 分钟内还在用（真的在熬夜）才提醒；专注模式、番茄专注中不打扰
      const nagGap = p.prefs.nightRemindMin * 60000
      if (
        night && nagGap > 0 && !p.prefs.focus && p.pomo.phase !== 'focus' &&
        p.lastActive > 0 && t - p.lastActive < 5 * 60000 && t - p.nightNagAt >= nagGap &&
        (await claimNightNag($, t))
      ) {
        const line = (NIGHT_NAGS[seed % NIGHT_NAGS.length] ?? NIGHT_NAGS[0]!).replace('{t}', clockText(t))
        $.ui.toast(`Clawd：${line}`)
        say = line
        // 发呆的话，顺便打个大哈欠
        if (mood === 'idle') {
          const yawn = SKITS_COMMON.find(k => k.id === 'yawn')
          if (yawn) {
            skit = yawn.id
            skitUntil = t + yawn.ms
          }
        }
      }

      // 🍅 番茄钟：时间到了就切换；剩余分钟数变了才更新（每分钟重画一次就够）
      if (p.pomo.phase !== 'idle' && t >= p.pomo.endsAt) await finishPomoPhase($, p.pomo.endsAt)
      const pomoLeft = p.pomo.phase === 'idle' ? 0 : Math.max(1, Math.ceil((p.pomo.endsAt - t) / 60000))
      if (pomoLeft !== p.pomoLeft) await update($, pet, q => ({ ...q, pomoLeft }))

      // 真的有变化才写，免得面板每 0.7 秒重画一次
      const changed =
        mood !== p.mood || moodUntil !== p.moodUntil || say !== p.say ||
        skit !== p.skit || skitUntil !== p.skitUntil || nextSkitAt !== p.nextSkitAt
      // 如果这期间 Claude 刚好开始干活（lastActive 变了），就别覆盖它
      if (changed) {
        await update($, pet, q =>
          q.lastActive !== p.lastActive ? q : { ...q, mood, moodUntil, say, skit, skitUntil, nextSkitAt },
        )
      }
    })

    return next(e)
  })

  on('command.run', { command: 'pet' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Clawd 出来啦！' }
  })

  on('command.run', { command: 'clawd-dex' }, async $ => {
    await $.ui.open({ id: DEX_PANE, title: 'Clawd 图鉴' })
    return { text: '📖 图鉴打开啦：随便看，不会解锁哦' }
  })

  // /clawd-pomo：没在计时 → 开始；休息中 → 直接开下一个；专注中 → 停止
  on('command.run', { command: 'clawd-pomo' }, async $ => {
    const { pomo, prefs } = await loadProgress($)
    if (pomo.phase === 'focus') {
      await stopPomo($)
      return { text: '🍅 番茄钟停止了（这个番茄不算完成）' }
    }
    await startPomo($)
    return { text: `🍅 开始专注 ${prefs.pomoMin} 分钟！再输入一次 /clawd-pomo 可以停止` }
  })

  on('command.run', { command: 'clawd-settings' }, async $ => {
    const opened = await openSettingsWindow($)
    return { text: opened ? '⚙️ 正在打开设置窗口……（会弹在屏幕中间；如果几秒后还没出现，告诉我）' : '设置窗口没能打开' }
  })

  on('command.run', { command: 'clawd-week' }, async $ => {
    await update($, weekView, w => ({ ...w, refresh: w.refresh + 1, note: '' }))
    await $.ui.open({ id: WEEK_PANE, title: 'Clawd 周报' })
    return { text: '📋 周报面板打开啦' }
  })

  // /clawd-focus：开关专注模式（/focus 是 Claude Code 自带的命令，不能用）
  on('command.run', { command: 'clawd-focus' }, async $ => {
    const isOn = !(await loadProgress($)).prefs.focus
    await commit($, s => ({ ...s, prefs: { ...s.prefs, focus: isOn } }))
    return { text: isOn ?'🤫 专注模式已开启：Clawd 会安静陪着你' : '🦀 专注模式已关闭' }
  })

  // 记录每一轮从什么时候开始，用来判断是不是"长任务"
  let turnStartedAt = 0

  // 你发消息 → 每日打卡 + 开始思考
  on('prompt.submit', async ($, e, next) => {
    turnStartedAt = await $.clock.now()
    await setMood($, 'thinking')
    await checkIn($)
    // 📋 小账本：记下今天在哪个项目里工作
    const cwd = await $.session.cwd()
    await logToday($, d => logProject(d, cwd))
    await checkQuests($)
    return next(e)
  }).catch(($, e, next) => next(e)) // 桌宠出错也绝不挡住你的消息

  // 👋 等你回复（startWaiting / stopWaiting 在文件上方）
  // 权限对话框真的弹出来给你看时（自动批准的不会触发）→ 举牌子
  on('classic.PermissionRequest', async ($, e, next) => {
    await startWaiting($, `perm:${e.tool_name}`, e.tool_name, `Claude 在等你批准 ${e.tool_name}！`)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Claude 用工具 → 专属动作；成功了才算经验
  on('tool.call', async ($, e, next) => {
    if (e.tool === 'AskUserQuestion') {
      // Claude 问你问题：一定要你回答，马上举牌子
      await startWaiting($, e.tool_use_id, e.tool, 'Claude 有问题想问你！')
    } else {
      await setMood($, 'working', { tool: e.tool, say: KIND_SAY[toolKind(e.tool)] })
    }
    const ran = await next(e)
    // 工具结束了（你回答了 / 批准后跑完了 / 拒绝了）→ 放下牌子
    const wasWaiting = stopWaiting(e.tool_use_id) || stopWaiting(`perm:${e.tool}`)
    const failed = ran.deny !== undefined || ran.isError === true
    // 📋 小账本：记下用了什么工具、改了哪个文件、有没有出错
    const filePath = (e as { file_path?: unknown }).file_path
    await logToday($, d => logTool(d, e.tool, !failed, typeof filePath === 'string' ? filePath : undefined))
    if (failed && wasWaiting && ran.deny !== undefined) {
      // 你拒绝了：不是出错，别冒烟
      await setMood($, 'sad', { holdMs: 3000, say: '好吧，那就不做了～' })
    } else if (failed) {
      await setMood($, 'oops', { holdMs: 4000, say: `${e.tool} 冒烟了……` })
    } else {
      const isEdit = EDIT_TOOLS.includes(e.tool)
      await setMood($, 'thinking')
      await gain($, { xp: XP_TOOL + (isEdit ? XP_EDIT : 0), coins: COIN_TOOL, food: FOOD_TOOL, tools: 1, edits: isEdit ? 1 : 0 })
      await checkQuests($)
    }
    return ran
  }).catch(($, e, next) => next(e)) // 桌宠出错也绝不挡住 Claude 的工具

  // 一轮结束 → 成功回答才有经验
  on('turn.complete', async ($, e, next) => {
    if (e.reason === 'answer') {
      await setMood($, 'happy', { holdMs: 10000 })
      const gained = await gain($, { xp: XP_TURN, coins: COIN_TURN, food: FOOD_TURN, turns: 1 })
      await logToday($, d => {
        d.turns++
      })
      const unlocked = gained + (await checkQuests($)) // 任务完成也算"已经响过声音"
      // ✅ 长任务完成 → 响完成音（如果刚好解锁了成就，成就音已经响过，就不重复）
      const seconds = turnStartedAt ? ((await $.clock.now()) - turnStartedAt) / 1000 : 0
      const { prefs } = await loadProgress($)
      if (unlocked === 0 && prefs.sound && seconds >= prefs.longTaskSec) void playSound($, 'done')
    } else {
      await setMood($, 'sad', { holdMs: 8000 })
    }
    return next(e)
  })

  // =====================================================================
  // 画面
  // =====================================================================

  // ---------- 侧边面板：完整养成信息 + 衣柜 ----------
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Select } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const p = await read($, pet)
    const frame = Svg ? 0 : await read($, frameAtom) // 桌面版不读帧，就不会每 0.7 秒重画
    const now = await $.clock.now()

    const lv = levelOf(p.xp)
    const form = formOf(lv)
    const lo = xpForLevel(lv)
    const hi = xpForLevel(lv + 1)
    const full = fullnessAt(p, now)
    const isHungry = full < HUNGRY_BELOW
    const [row1, row2, row3] = clawdText(p.mood, frame)
    // 📅 今日任务
    const today = dayKey(now)
    const quests = questsFor(today)
    const todayLog = await loadToday($)
    const questDone = p.questDay === today ? p.questDone : []

    const wear = (slot: Slot, id: string) =>
      commit($, s => ({ ...s, outfit: { ...s.outfit, [slot]: id } }))

    return (
      <Box flexDirection="column">
        <Text>💬 {p.say}</Text>
        <Text> </Text>
        {Svg ? (
          <Svg source={clawdSvg(p.mood, form, isHungry, p.tool, p.outfit, tempoOf(p.prefs), p.skit, p.pomo.phase, isNightAt(p.prefs.nightFrom, now))} alt="Clawd" width={120} height={104} />
        ) : (
          <Box flexDirection="column">
            <Text mono color="claude">{ABOVE[p.mood][frame % 2] || ' '}</Text>
            <Text mono color="claude">   {row1}</Text>
            <Text mono color="claude">   {row2}</Text>
            <Text mono color="claude">   {row3}</Text>
          </Box>
        )}
        <Text> </Text>

        <Text weight="bold">
          Lv.{lv} <Text color="claude">{FORM_LABEL[form]}</Text>
          <Text dimColor> · {MOOD_LABEL[p.mood]}</Text>
        </Text>
        <Text>
          经验 <Text mono color="claude">{bar((p.xp - lo) / (hi - lo), 12)}</Text>
          <Text dimColor> {p.xp - lo}/{hi - lo}</Text>
        </Text>
        <Text>
          饱食 <Text mono color={isHungry ? 'error' : 'success'}>{bar(full / 100, 12)}</Text>
          <Text dimColor> {Math.round(full)}%</Text>
        </Text>
        <Text>
          打卡 🔥 连续 {p.streak} 天
          {p.streak >= STREAK_DOUBLE_AT ? <Text color="claude"> (经验 ×2)</Text> : ''}
        </Text>
        <Text>
          金币 <Text color="warning">💰 {p.coins}</Text>
        </Text>
        <Text dimColor>下一形态：{FORM_NEXT[form]}</Text>
        <Text> </Text>

        {/* ===================== 🍅 番茄钟 ===================== */}
        <Text weight="bold">
          🍅 番茄钟{' '}
          {p.pomo.phase === 'focus' ? (
            <Text color="error">专注中 · 还剩 {p.pomoLeft} 分钟</Text>
          ) : p.pomo.phase === 'break' ? (
            <Text color="success">休息中 · 还剩 {p.pomoLeft} 分钟</Text>
          ) : (
            <Text dimColor>没在计时</Text>
          )}
        </Text>
        <Text dimColor>
          这一轮 {'🍅'.repeat(p.pomo.round)}{'⚪'.repeat(Math.max(0, 4 - p.pomo.round))}（满 4 个长休息）· 累计完成 {p.pomoTotal} 个
        </Text>
        <Box flexDirection="row" gap={1}>
          {p.pomo.phase === 'focus' ? (
            <Button key="pomo-stop" label="⏹ 停止" hotkey="t" onPress={() => stopPomo($)} />
          ) : (
            <Button
              key="pomo-start"
              label={p.pomo.phase === 'break' ? '▶ 不休息了，开始下一个' : `▶ 开始专注 ${p.prefs.pomoMin} 分钟`}
              hotkey="t"
              variant="primary"
              onPress={() => startPomo($)}
            />
          )}
          {p.pomo.phase === 'break' ? (
            <Button key="pomo-end" label="结束番茄钟" onPress={() => stopPomo($, '今天辛苦啦～')} />
          ) : null}
        </Box>
        <Text dimColor>专注期间真的和 Claude 完成过对话，才算完成番茄：+{COIN_POMO}💰 +{XP_POMO} XP</Text>
        <Text> </Text>

        {/* ===================== 📅 今日任务 ===================== */}
        <Text weight="bold">
          📅 今日任务 {quests.filter(q => questDone.includes(q.key)).length}/{quests.length}
          {questDone.includes(ALL_DONE_MARK) ? <Text color="success"> 🏆 全部完成！</Text> : ''}
        </Text>
        {quests.map(q => {
          const have = Math.min(q.target, q.measure(todayLog))
          const isDone = questDone.includes(q.key)
          return (
            <Text key={`quest-${q.key}`} dimColor={isDone}>
              {isDone ? '✅' : '⬜'} {q.text}{' '}
              <Text mono color={isDone ? 'success' : 'claude'}>{bar(have / q.target, 8)}</Text>
              <Text dimColor>
                {' '}
                {have}/{q.target} · +{q.coins}💰
              </Text>
            </Text>
          )
        })}
        <Text dimColor>
          全部完成再送 +{ALL_DONE_COINS}💰 +{ALL_DONE_XP} XP · 每天 0 点换新任务 · 已全勤 {p.questFullDays} 天
        </Text>
        <Text> </Text>

        <Box flexDirection="row" gap={1}>
          <Button
            key="pat"
            label="摸摸头"
            hotkey="p"
            onPress={async () => {
              await setMood($, 'love', { holdMs: 4000 })
              await commit($, s => ({ ...s, pets: s.pets + 1 }))
              await logToday($, d => {
                d.pets = (d.pets ?? 0) + 1
              })
              await checkQuests($)
            }}
          />
          <Button
            key="snack"
            label="喂零食"
            hotkey="f"
            onPress={() => setMood($, 'happy', { holdMs: 4000, say: '好吃！不过要多干活才能长大哦' })}
          />
          <Button key="wake" label="叫醒" hotkey="w" onPress={() => setMood($, 'idle', { say: '我醒啦！' })} />
          <Button
            key="open-dex"
            label="📖 图鉴"
            hotkey="d"
            onPress={() => void $.ui.open({ id: DEX_PANE, title: 'Clawd 图鉴' })}
          />
          <Button
            key="open-week"
            label="📋 周报"
            hotkey="r"
            onPress={async () => {
              await update($, weekView, w => ({ ...w, refresh: w.refresh + 1, note: '' }))
              await $.ui.open({ id: WEEK_PANE, title: 'Clawd 周报' })
            }}
          />
        </Box>
        <Text> </Text>

        {/* ===================== ⚙️ 设置：全部在弹出的 Windows 窗口里改 ===================== */}
        <Box flexDirection="row" gap={1} alignItems="center">
          <Button key="open-settings" label="⚙️ 打开设置窗口" hotkey="s" onPress={() => void openSettingsWindow($)} />
          <Text dimColor>
            {p.prefs.focus ? '🤫 专注中' : '🦀 普通'} · {p.prefs.sound ? '🔔 有声' : '🔕 静音'}
          </Text>
        </Box>
        <Text> </Text>

        {/* ===================== 🛒 商店 ===================== */}
        <Text weight="bold">
          🛒 商店 <Text color="warning">💰 {p.coins}</Text>
        </Text>
        <Text dimColor>
          赚金币：对话 +{COIN_TURN} · 工具 +{COIN_TOOL} · 打卡 +{COIN_DAILY} · 徽章 +{COIN_BADGE} · 升级 +等级×{COIN_LEVEL}
        </Text>
        <Text dimColor>🍙 吃的（恢复饱食度）</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {FOODS.map(f => (
            <Button
              key={`food-${f.id}`}
              label={`${f.name} +${f.food}% · ${f.price}💰`}
              dimColor={p.coins < f.price}
              onPress={() => buyFood($, f)}
            />
          ))}
        </Box>
        <Text dimColor>👗 限定装扮（买了就是你的）</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {ITEMS.filter(i => i.price !== undefined).map(i =>
            p.wardrobe.includes(i.id) ? (
              <Text key={`owned-${i.id}`} dimColor>
                ✅ {i.name}
              </Text>
            ) : (
              <Button
                key={`buy-${i.id}`}
                label={`${i.name} · ${i.price}💰`}
                dimColor={p.coins < (i.price ?? 0)}
                onPress={() => buyItem($, i.id)}
              />
            ),
          )}
        </Box>
        <Text dimColor>想先看看戴上什么样？去 📖 图鉴里试穿</Text>
        <Text> </Text>

        <Text weight="bold">
          👗 衣柜 {p.wardrobe.length}/{ITEMS.length}
        </Text>
        {SLOTS.map(slot => {
          const owned = ITEMS.filter(i => i.slot === slot && p.wardrobe.includes(i.id))
          const locked = ITEMS.filter(i => i.slot === slot && !p.wardrobe.includes(i.id))
          return (
            <Box key={`slot-${slot}`} flexDirection="column">
              <Text dimColor>{SLOT_LABEL[slot]}</Text>
              <Box flexDirection="row" flexWrap="wrap" gap={1}>
                <Button
                  key={`none-${slot}`}
                  label={p.outfit[slot] === '' ? '✓ 不戴' : '不戴'}
                  onPress={() => wear(slot, '')}
                />
                {owned.map(i => (
                  <Button
                    key={`wear-${i.id}`}
                    label={p.outfit[slot] === i.id ? `✓ ${i.name}` : i.name}
                    onPress={() => wear(slot, i.id)}
                  />
                ))}
              </Box>
              {locked.map(i => (
                <Text dimColor>🔒 {i.hint}</Text>
              ))}
            </Box>
          )
        })}
        <Text> </Text>

        <Text weight="bold">
          🏅 徽章 {p.badges.length}/{BADGES.length}
        </Text>
        {BADGES.map(b => (p.badges.includes(b.id) ? <Text>🏅 {b.name}</Text> : <Text dimColor>🔒 {b.hint}</Text>))}
        <Text> </Text>

        <Text weight="bold">📊 统计</Text>
        <Text dimColor>
          对话 {p.turns} 轮 · 工具 {p.tools} 次 · 改文件 {p.edits} 次 · 摸头 {p.pets} 次
        </Text>
      </Box>
    )
  })

  // ---------- 📋 周报面板：一周统计 + 生成周报草稿 ----------
  on('ui.render', { component: 'Pane', requestId: WEEK_PANE }, async ($, e) => {
    const { Box, Text, Button, Select } = $.ui.resolve(e)
    const v = await read($, weekView) // 只订阅周报自己的状态，不会被心跳打扰
    const now = await $.clock.now()
    const prog = await loadProgress($)
    const all = await loadDays($)
    const w = buildWeek(all, now, v.offset, prog.prefs.internStart)
    const md = weekMarkdown(w)
    const maxTurns = Math.max(1, ...w.days.map(d => d.log.turns))
    const today = dayKey(now)

    const setNote = (note: string) => update($, weekView, x => ({ ...x, note }))
    const fileName = `${w.start}_${w.end}.md`

    return (
      <Box flexDirection="column">
        <Text weight="bold">
          📋 {w.internWeek ? `实习第 ${w.internWeek} 周` : `第 ${w.week} 周`}
          <Text dimColor>（{w.start} ~ {w.end}）</Text>
        </Text>
        <Box flexDirection="row" gap={1}>
          <Select
            key="week-pick"
            label="看哪一周"
            value={String(v.offset)}
            options={[0, -1, -2, -3].map(o => ({ value: String(o), label: o === 0 ? '本周' : o === -1 ? '上周' : `${-o} 周前` }))}
            onSelect={x => update($, weekView, s => ({ ...s, offset: Number(x), note: '' }))}
          />
          <Button key="week-refresh" label="↻ 刷新" onPress={() => update($, weekView, s => ({ ...s, refresh: s.refresh + 1 }))} />
        </Box>
        <Text> </Text>

        <Text weight="bold">📊 每天的对话轮数</Text>
        {w.days.map(d => (
          <Text key={`day-${d.key}`} mono>
            {d.label} <Text color="claude">{bar(d.log.turns / maxTurns, 14)}</Text>
            <Text dimColor>
              {' '}
              {d.log.turns} 轮 · {d.log.tools} 次操作{d.key === today ? ' ← 今天' : ''}
            </Text>
          </Text>
        ))}
        <Text> </Text>

        <Text weight="bold">本周合计</Text>
        <Text>
          开发 {w.activeDays} 天 · 对话 {w.total.turns} 轮 · 操作 {w.total.tools} 次 · 改文件 {w.total.edits} 次 · 出错 {w.total.fails} 次
        </Text>
        <Text dimColor>项目：{w.total.projects.length ? w.total.projects.join('、') : '（还没有记录）'}</Text>
        <Text dimColor>
          改得最多的文件：
          {top(w.total.files, 5).map(([f, n]) => `${f}×${n}`).join('、') || '（还没有记录）'}
        </Text>
        <Text> </Text>

        <Text weight="bold">📝 周报草稿</Text>
        <Text dimColor>格式：周数和日期 / 目前进度 / 遇到的困难 / 下周计划 / 截图。（填写）的地方要你自己补上</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button
            key="week-copy"
            label="📋 复制到剪贴板"
            variant="primary"
            onPress={async () => setNote((await copyToClipboard($, md)) ? '✅ 已复制！去周报里直接粘贴吧' : '❌ 复制失败（只支持 Windows），可以用"存成文件"')}
          />
          <Button
            key="week-save"
            label="💾 存成文件"
            onPress={async () => {
              const path = `${$.plugin.root}/reports/${fileName}`
              try {
                await $.fs.write(path, md)
                await setNote(`✅ 已存到 ${path}`)
              } catch {
                await setNote('❌ 存文件失败')
              }
            }}
          />
        </Box>
        {v.note ? <Text color={v.note.startsWith('✅') ? 'success' : 'error'}>{v.note}</Text> : null}
        <Text> </Text>
        <Box borderStyle="round" borderDimColor paddingX={1} flexDirection="column">
          {md.split('\n').map((line, i) => (
            <Text key={`md-${i}`} weight={line.startsWith('#') ? 'bold' : undefined} dimColor={line.includes('（填写') || line.includes('（补充')}>
              {line || ' '}
            </Text>
          ))}
        </Box>
        <Text> </Text>

        <Box flexDirection="row" gap={1} alignItems="center">
          <Text dimColor>实习开始日期：{prog.prefs.internStart || '没设'}</Text>
          <Button key="week-settings" label="⚙️ 去设置窗口改" onPress={() => void openSettingsWindow($)} />
        </Box>
        <Text dimColor>设了之后标题会显示"实习第 X 周"；改完按「↻ 刷新」</Text>
      </Box>
    )
  })

  // ---------- 📖 图鉴面板：预览所有形态 × 动作 × 装扮 ----------
  on('ui.render', { component: 'Pane', requestId: DEX_PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Select } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    // 读存档而不是 pet：pet 一变图鉴就会重画、滚动条会跳回顶部
    const p = await loadProgress($)
    const d = await read($, dex)
    const myLv = levelOf(p.xp)
    const { mood, tool, skit, night } = parseAct(d.act)
    const tempo = tempoOf(p.prefs)
    const setDex = (change: Partial<Dex>) => update($, dex, x => ({ ...x, ...change }))

    if (!Svg) {
      return <Text dimColor>图鉴需要在 Claude 桌面 app 里看（终端画不出像素图）。</Text>
    }

    return (
      <Box flexDirection="column">
        <Text dimColor>只是预览，不会解锁。要真正得到，还是得靠使用 Claude Code 哦～</Text>
        <Text> </Text>

        {/* 四个形态并排：点一下选中 */}
        <Text weight="bold">四个形态</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {DEX_FORMS.map(f => (
            <Box key={`dex-form-${f.id}`} flexDirection="column" alignItems="center">
              <Svg
                source={clawdSvg(mood, f.id, false, tool, d.outfit, tempo, skit, 'idle', night)}
                alt={FORM_LABEL[f.id]}
                width={72}
                height={62}
              />
              <Button
                key={`pick-${f.id}`}
                label={`${d.form === f.id ? '✓ ' : ''}${FORM_LABEL[f.id]}`}
                onPress={() => setDex({ form: f.id })}
              />
              <Text size="caption" dimColor>
                {myLv >= f.unlockLv ? '✅ 已拥有' : `🔒 Lv.${f.unlockLv}`}
              </Text>
            </Box>
          ))}
        </Box>
        <Text> </Text>

        {/* 选中的形态放大看 */}
        <Text weight="bold">
          {FORM_LABEL[d.form]} · {DEX_ACTS.find(a => a.value === d.act)?.label ?? d.act}
        </Text>
        <Svg source={clawdSvg(mood, d.form, false, tool, d.outfit, tempo, skit, 'idle', night)} alt="Clawd 预览" width={160} height={139} />
        <Text> </Text>

        <Select
          key="dex-act"
          label="🎬 动作"
          value={d.act}
          options={DEX_ACTS}
          onSelect={v => setDex({ act: v })}
        />
        {SLOTS.map(slot => (
          <Select
            key={`dex-${slot}`}
            label={`👗 ${SLOT_LABEL[slot]}`}
            value={d.outfit[slot]}
            options={[
              { value: '', label: '不戴' },
              ...ITEMS.filter(i => i.slot === slot).map(i => ({
                value: i.id,
                label: p.wardrobe.includes(i.id) ? `${i.name} ✅` : `${i.name} 🔒 ${i.hint}`,
              })),
            ]}
            onSelect={v => setDex({ outfit: { ...d.outfit, [slot]: v } })}
          />
        ))}
        <Box flexDirection="row" gap={1}>
          <Button
            key="dex-mine"
            label="换成我现在的样子"
            onPress={() => setDex({ form: formOf(myLv), outfit: { ...p.outfit } })}
          />
          <Button
            key="dex-clear"
            label="脱掉全部装扮"
            onPress={() => setDex({ outfit: { head: '', face: '', neck: '' } })}
          />
        </Box>
      </Box>
    )
  })

  // ---------- 聊天框右上角：Clawd + 一句话 ----------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const frame = Svg ? 0 : await read($, frameAtom) // 桌面版不读帧，就不会每 0.7 秒重画
    const p = await read($, pet)
    const now = await $.clock.now()
    const lv = levelOf(p.xp)
    const isHungry = fullnessAt(p, now) < HUNGRY_BELOW
    const [row1, row2, row3] = clawdText(p.mood, frame)
    const deco = ABOVE[p.mood][frame % 2] ?? ''

    return (
      <Box flexDirection="row" justifyContent="flex-end" alignItems="flex-end" gap={1}>
        {/* 番茄钟计时中：只显示剩余时间（就算在专注模式也要看得到） */}
        {p.pomo.phase !== 'idle' ? (
          <Text size="caption" color={p.pomo.phase === 'focus' ? 'error' : 'success'}>
            {p.pomo.phase === 'focus' ? '🍅' : '☕'} {p.pomoLeft} 分
          </Text>
        ) : p.prefs.focus ? (
          /* 专注模式：不说话，只留一个小小的 🤫 */
          <Text size="caption" dimColor>🤫</Text>
        ) : !p.prefs.showText ? null : (
          <Box flexDirection="column" alignItems="flex-end">
            <Text size="footnote">
              <Text dimColor>{p.say} </Text>
              <Text color="claude">{deco.trim()}</Text>
            </Text>
            <Text size="caption" dimColor>
              Lv.{lv} · {MOOD_LABEL[p.mood]}
              {isHungry ? ' · 🍙 饿了' : ''}
              {p.streak > 1 ? ` · 🔥${p.streak}` : ''}
              {isNightAt(p.prefs.nightFrom, now) ? ' · 🌙' : ''}
              {` · 📅${p.questDay === dayKey(now) ? p.questDone.filter(k => k !== ALL_DONE_MARK).length : 0}/3`}
            </Text>
          </Box>
        )}
        {Svg ? (
          <Svg source={clawdSvg(p.mood, formOf(lv), isHungry, p.tool, p.outfit, tempoOf(p.prefs), p.skit, p.pomo.phase, isNightAt(p.prefs.nightFrom, now))} alt="Clawd" width={SIZE_PX[p.prefs.size]} height={Math.round((SIZE_PX[p.prefs.size] * 13) / 15)} />
        ) : (
          <Box flexDirection="column">
            <Text mono color="claude">{row1}</Text>
            <Text mono color="claude">{row2}</Text>
            <Text mono color="claude">{row3}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
