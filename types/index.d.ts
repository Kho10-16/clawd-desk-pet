export type Mood =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'happy'
  | 'sad'
  | 'sleepy'
  | 'love'
  | 'hungry'
  | 'oops'
  | 'waiting'

/** 要长期保存（跨 session）的养成进度 */
export type Progress = {
  /** 经验值：只能靠真正使用 Claude Code 获得 */
  xp: number
  /** 饱食度 0~100，记录的是 lastFed 那一刻的值，之后每小时 -2 */
  fullness: number
  /** 最后一次"吃东西"（= 使用）的时间(ms) */
  lastFed: number
  /** 连续打卡天数 */
  streak: number
  /** 最后打卡的日期，如 "2026-11-19" */
  lastDay: string
  /** 完成的对话轮数 */
  turns: number
  /** 成功的工具调用次数 */
  tools: number
  /** 成功改文件的次数 */
  edits: number
  /** 被摸头次数 */
  pets: number
  /** 已解锁的徽章 id */
  badges: string[]
  /** 已解锁的装扮 id */
  wardrobe: string[]
  /** 正在穿戴的装扮，'' 表示这个位置不戴 */
  outfit: Outfit
  /** 偏好设置 */
  prefs: Prefs
  /** 💰 金币：干活赚，商店花 */
  coins: number
}

export type Prefs = {
  /** 专注模式：不说话、不弹提示、动画放慢 */
  focus: boolean
  /** 提示音开关 */
  sound: boolean
  /** 提示音音量 */
  volume: 'low' | 'mid' | 'high'
  /** 一轮超过几秒才算长任务（完成时响完成音） */
  longTaskSec: number
  /** 几分钟没动静就睡觉，0 = 永远不睡 */
  sleepMin: number
  /** 动画速度 */
  speed: 'slow' | 'normal' | 'fast'
  /** 聊天框上方显示文字 */
  showText: boolean
  /** 聊天框上方 Clawd 的大小 */
  size: 'small' | 'medium' | 'large'
  /** 实习开始日期 YYYY-MM-DD，周报用来算"实习第几周"；'' = 没设 */
  internStart: string
}

/** 周报面板的状态 */
export type WeekView = {
  /** 0 = 本周，-1 = 上周 …… */
  offset: number
  /** 刚刚导出 / 复制的提示 */
  note: string
  /** 每次按"刷新"加一，让面板重画 */
  refresh: number
}

export type Slot = 'head' | 'face' | 'neck'
export type Outfit = Record<Slot, string>

export type Pet = Progress & {
  mood: Mood
  /** 心情维持到这个时间点(ms)，之后回到 idle；0 表示不过期 */
  moodUntil: number
  /** 最后一次有动静的时间(ms)，用来判断要不要睡觉 */
  lastActive: number
  /** 正在用的工具名 */
  tool: string
  /** 对话文字 */
  say: string
  /** 正在演的发呆小剧场，'' = 没在演 */
  skit: string
  /** 小剧场演到这个时间点(ms)结束 */
  skitUntil: number
  /** 下一次小剧场最早什么时候开始(ms) */
  nextSkitAt: number
}

/** 图鉴面板里正在预览的东西（只是看看，不会解锁） */
export type Dex = {
  form: 'baby' | 'teen' | 'gent' | 'shiny'
  /** 心情名，或 "work:工具名" 表示干活动作 */
  act: string
  outfit: Outfit
}

declare module 'claude-code' {
  interface PluginState {
    /** frame = 动画帧计数，只有终端文字版会读（桌面版不读，免得每 0.7 秒重画面板） */
    'desk-pet': { pet: Shaped<Pet>; dex: Shaped<Dex>; frame: number; week: Shaped<WeekView> }
  }
}
