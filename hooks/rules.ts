// =====================================================================
// 养成规则：经验、等级、形态、徽章、装扮。想调数值就改这个文件。
// =====================================================================

import type { Prefs, Progress, Slot } from '../types'

export const XP_TURN = 5 // 完成一轮对话
export const XP_TOOL = 1 // 成功调用一次工具
export const XP_EDIT = 2 // 成功改文件，额外加
export const XP_DAILY = 20 // 每日首次打卡
export const STREAK_DOUBLE_AT = 7 // 连续几天起打卡经验 ×2

export const FOOD_TURN = 10 // 完成一轮对话恢复的饱食度
export const FOOD_TOOL = 1 // 每次工具调用恢复的饱食度
export const HUNGER_PER_HOUR = 2 // 每小时掉多少饱食度（100 → 0 约 2 天）
export const HUNGRY_BELOW = 30 // 低于这个值就饿了

export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

// ---------- 💰 金币：和经验一样，只能靠使用赚 ----------
export const COIN_TURN = 3 // 完成一轮对话
export const COIN_TOOL = 1 // 成功调用一次工具
export const COIN_DAILY = 10 // 每日打卡
export const COIN_BADGE = 20 // 每解锁一枚徽章
export const COIN_LEVEL = 10 // 升级奖励 = 新等级 × 10
export const COIN_POMO = 15 // 完成一个番茄（期间真的有在干活）
export const XP_POMO = 10

// ---------- 🍙 商店里的吃的：用金币换饱食度 ----------
export type Food = { id: string; name: string; price: number; food: number; say: string }
export const FOODS: Food[] = [
  { id: 'fish', name: '🐟 小鱼干', price: 10, food: 15, say: '嚼嚼嚼，小鱼干真香！' },
  { id: 'cake', name: '🍰 小蛋糕', price: 25, food: 40, say: '甜甜的，好幸福～' },
  { id: 'feast', name: '🍱 豪华便当', price: 50, food: 100, say: '吃得饱饱的，干劲满满！' },
]

// ---------- 每种工具对应一个专属动作 ----------
export type ToolKind = 'type' | 'read' | 'build' | 'search' | 'plan' | 'other'

export function toolKind(tool: string): ToolKind {
  if (['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'Monitor'].includes(tool)) return 'type'
  if (['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'].includes(tool)) return 'read'
  if (EDIT_TOOLS.includes(tool)) return 'build'
  if (['WebSearch', 'WebFetch'].includes(tool) || /browser|chrome/i.test(tool)) return 'search'
  if (/todo|plan|^Task/i.test(tool)) return 'plan'
  return 'other'
}

export const KIND_SAY: Record<ToolKind, string> = {
  type: '噼里啪啦敲命令 ⌨️',
  read: '戴上眼镜认真读 📖',
  build: '叮叮当当改代码 🔨',
  search: '举起望远镜上网查 🔭',
  plan: '拿小本本列计划 📋',
  other: '忙着干活！',
}

// ---------- 等级 ----------
/** 升到第 n 级需要的总经验：15 × (n-1)²  → Lv2=15, Lv5=240, Lv10=1215, Lv20=5415 */
export function xpForLevel(n: number): number {
  return 15 * (n - 1) * (n - 1)
}
export function levelOf(xp: number): number {
  return Math.floor(Math.sqrt(xp / 15)) + 1
}

// ---------- 成长形态：像进化一样 ----------
export type Form = 'baby' | 'teen' | 'gent' | 'shiny'
export function formOf(level: number): Form {
  if (level >= 20) return 'shiny'
  if (level >= 10) return 'gent'
  if (level >= 5) return 'teen'
  return 'baby'
}
export const FORM_LABEL: Record<Form, string> = {
  baby: '宝宝期',
  teen: '成长期',
  gent: '绅士期',
  shiny: '闪耀期',
}
export const FORM_NEXT: Record<Form, string> = {
  baby: 'Lv.5 长出小钳子',
  teen: 'Lv.10 解锁小礼帽',
  gent: 'Lv.20 全身发光',
  shiny: '已经是完全体！',
}

// ---------- 判断条件时用到的"当下情况" ----------
export type Ctx = {
  hour: number
  month: number
  /** 这次变化是不是来自"真正使用"（对话 / 工具） */
  isUse: boolean
}

// ---------- 成就徽章 ----------
export type Badge = { id: string; name: string; hint: string; test: (p: Progress, c: Ctx) => boolean }

export const BADGES: Badge[] = [
  { id: 'hello', name: '初次见面', hint: '完成第一轮对话', test: p => p.turns >= 1 },
  { id: 'turn100', name: '话痨搭档', hint: '完成 100 轮对话', test: p => p.turns >= 100 },
  { id: 'tool100', name: '勤劳小手', hint: '工具调用 100 次', test: p => p.tools >= 100 },
  { id: 'tool1000', name: '工具大师', hint: '工具调用 1000 次', test: p => p.tools >= 1000 },
  { id: 'edit50', name: '代码工匠', hint: '改文件 50 次', test: p => p.edits >= 50 },
  { id: 'streak3', name: '三天不断', hint: '连续打卡 3 天', test: p => p.streak >= 3 },
  { id: 'streak7', name: '一周全勤', hint: '连续打卡 7 天', test: p => p.streak >= 7 },
  { id: 'streak30', name: '月度之星', hint: '连续打卡 30 天', test: p => p.streak >= 30 },
  { id: 'night', name: '夜猫子', hint: '凌晨 0~5 点还在写代码', test: (_p, c) => c.isUse && c.hour < 5 },
  { id: 'lv5', name: '长出钳子', hint: '达到 Lv.5', test: p => levelOf(p.xp) >= 5 },
  { id: 'lv10', name: '小绅士', hint: '达到 Lv.10', test: p => levelOf(p.xp) >= 10 },
  { id: 'lv20', name: '闪闪发光', hint: '达到 Lv.20', test: p => levelOf(p.xp) >= 20 },
  { id: 'pet50', name: '被宠爱的螃蟹', hint: '摸头 50 次', test: p => p.pets >= 50 },
  { id: 'quest7', name: '任务达人', hint: '累计 7 天完成全部每日任务', test: p => p.questFullDays >= 7 },
  { id: 'pomo25', name: '番茄达人', hint: '累计完成 25 个番茄', test: p => p.pomoTotal >= 25 },
]

// ---------- 🎭 发呆小剧场 ----------
export type Skit = { id: string; name: string; say: string; ms: number }

/** 所有形态都会演的 */
export const SKITS_COMMON: Skit[] = [
  { id: 'stretch', name: '伸懒腰', say: '伸——个——懒腰～', ms: 4000 },
  { id: 'yawn', name: '打哈欠', say: '哈啊——好困', ms: 3500 },
  { id: 'walk', name: '散步', say: '走两步，活动活动', ms: 5000 },
  { id: 'look', name: '东张西望', say: '咦？有什么动静？', ms: 4000 },
  { id: 'scratch', name: '挠头', say: '嗯……挠挠头', ms: 3500 },
]

/** 每个形态自己的拿手好戏 */
export const SKITS_BY_FORM: Record<Form, Skit[]> = {
  baby: [{ id: 'bigbubble', name: '吹大泡泡', say: '噗噗噗——吹个大泡泡！', ms: 4500 }],
  teen: [{ id: 'dance', name: '跳舞', say: '♪ 来跳个舞！', ms: 5000 }],
  gent: [{ id: 'tea', name: '喝红茶', say: '来杯红茶，优雅～', ms: 5000 }],
  shiny: [{ id: 'twirl', name: '闪耀登场', say: '✨ 闪亮登场！', ms: 4500 }],
}

/** 🌙 夜里才会演的（再加上打哈欠、伸懒腰） */
export const SKITS_NIGHT: Skit[] = [
  { id: 'moon', name: '看月亮', say: '月亮好圆……', ms: 5000 },
  { id: 'pillow', name: '抱枕头打瞌睡', say: '抱着枕头……眼皮好重……', ms: 5500 },
  { id: 'nod', name: '点头打盹', say: '嗯…嗯？我没睡！', ms: 4000 },
]

/** 🌙 夜间模式：nightFrom 点起到早上 6 点（24 = 半夜 12 点，0 = 关闭） */
export const NIGHT_END_HOUR = 6
export function isNightAt(nightFrom: number, ms: number): boolean {
  if (nightFrom === 0) return false
  const h = new Date(ms).getHours()
  return h < NIGHT_END_HOUR || (nightFrom < 24 && h >= nightFrom)
}

// ---------- 装扮：成就解锁的 + 商店买的 ----------
/** price 有值 = 商店限定，只能用金币买 */
export type Item = { id: string; slot: Slot; name: string; hint: string; test: (p: Progress, c: Ctx) => boolean; price?: number }

const shopOnly = () => false

export const SLOT_LABEL: Record<Slot, string> = { head: '头饰', face: '脸部', neck: '颈部' }

export const ITEMS: Item[] = [
  // 头饰
  { id: 'sprout', slot: 'head', name: '小嫩芽', hint: '完成 10 轮对话', test: p => p.turns >= 10 },
  { id: 'bow', slot: 'head', name: '蝴蝶结', hint: '摸头 20 次', test: p => p.pets >= 20 },
  { id: 'gradcap', slot: 'head', name: '学士帽', hint: '完成 100 轮对话', test: p => p.turns >= 100 },
  { id: 'headphones', slot: 'head', name: '耳机', hint: '工具调用 300 次', test: p => p.tools >= 300 },
  { id: 'tophat', slot: 'head', name: '小礼帽', hint: '达到 Lv.10', test: p => levelOf(p.xp) >= 10 },
  { id: 'crown', slot: 'head', name: '小皇冠', hint: '达到 Lv.20', test: p => levelOf(p.xp) >= 20 },
  { id: 'santa', slot: 'head', name: '圣诞帽', hint: '12 月里写一次代码', test: (_p, c) => c.isUse && c.month === 12 },
  // 脸部
  { id: 'blush', slot: 'face', name: '小腮红', hint: '摸头 10 次', test: p => p.pets >= 10 },
  { id: 'sunglasses', slot: 'face', name: '墨镜', hint: '连续打卡 3 天', test: p => p.streak >= 3 },
  { id: 'monocle', slot: 'face', name: '单片眼镜', hint: '改文件 100 次', test: p => p.edits >= 100 },
  // 颈部
  { id: 'bowtie', slot: 'neck', name: '小领结', hint: '达到 Lv.5', test: p => levelOf(p.xp) >= 5 },
  { id: 'scarf', slot: 'neck', name: '围巾', hint: '连续打卡 7 天', test: p => p.streak >= 7 },
  { id: 'medal', slot: 'neck', name: '金牌', hint: '收集 8 枚徽章', test: p => p.badges.length >= 8 },
  // 🛒 商店限定
  { id: 'mustache', slot: 'face', name: '小胡子', hint: '商店 50 💰', test: shopOnly, price: 50 },
  { id: 'party', slot: 'head', name: '派对帽', hint: '商店 60 💰', test: shopOnly, price: 60 },
  { id: 'bell', slot: 'neck', name: '小铃铛', hint: '商店 60 💰', test: shopOnly, price: 60 },
  { id: 'starglasses', slot: 'face', name: '星星眼镜', hint: '商店 80 💰', test: shopOnly, price: 80 },
  { id: 'catears', slot: 'head', name: '猫耳朵', hint: '商店 100 💰', test: shopOnly, price: 100 },
  { id: 'halo', slot: 'head', name: '天使光环', hint: '商店 200 💰', test: shopOnly, price: 200 },
]

// ---------- 存档的默认值 ----------
export const emptyProgress: Progress = {
  xp: 0,
  fullness: 80,
  lastFed: 0,
  streak: 0,
  lastDay: '',
  turns: 0,
  tools: 0,
  edits: 0,
  pets: 0,
  badges: [],
  wardrobe: [],
  outfit: { head: '', face: '', neck: '' },
  coins: 0,
  questDay: '',
  questDone: [],
  questFullDays: 0,
  pomo: { phase: 'idle', endsAt: 0, round: 0, turnsAtStart: 0, prevFocus: false },
  pomoTotal: 0,
  nightNagAt: 0,
  prefs: {
    focus: false,
    sound: true,
    volume: 'mid',
    longTaskSec: 30,
    sleepMin: 2,
    speed: 'normal',
    showText: true,
    size: 'medium',
    internStart: '',
    pomoMin: 25,
    breakMin: 5,
    longBreakMin: 15,
    nightFrom: 23,
    nightRemindMin: 30,
  },
}

// ---------- 设置界面用到的选项 ----------
/** 动画速度 → 时长倍数（越大越慢） */
export const SPEED_MUL: Record<Prefs['speed'], number> = { slow: 1.6, normal: 1, fast: 0.65 }
/** Clawd 大小 → 宽度(px)，高度按比例 */
export const SIZE_PX: Record<Prefs['size'], number> = { small: 42, medium: 60, large: 84 }

/** 现在这一刻的饱食度：从上次吃东西起，每小时往下掉 */
export function fullnessAt(p: Progress, now: number): number {
  if (p.lastFed === 0) return p.fullness
  const hours = (now - p.lastFed) / 3600000
  return Math.max(0, Math.min(100, p.fullness - hours * HUNGER_PER_HOUR))
}

export function dayKey(ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
