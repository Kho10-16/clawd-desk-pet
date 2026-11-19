// =====================================================================
// 🍅 番茄日记 + 📝 任务清单（借鉴 Focus To-Do）
//
// 像一本番茄日记：每个番茄一行——几点开始、专注多久、做完了还是中途停了、在做哪个任务。
// 任务清单：每个任务预计几个番茄，做的时候自动记"实际用了几个"。
// 统计（今天 / 本周 / 一天里哪个时段最专注 / 专注日历 / 历史）全部由这本日记算出来。
//
// 全部存在你电脑本地（$.store），不调用 AI，不花 token。
// =====================================================================

import type { EngineInterface } from 'claude-code'
import { dayKey } from './rules'

/** 一个番茄的记录 */
export type PomoRecord = {
  start: number
  end: number
  /** 计划专注几分钟 */
  plannedMin: number
  /** true = 时间到、完整完成；false = 中途停掉 */
  done: boolean
  /** 期间有没有真的和 Claude 完成对话（有才发奖励） */
  earned: boolean
  taskId: string
}

export type Task = {
  id: string
  title: string
  /** 预计要几个番茄 */
  estimate: number
  done: boolean
  createdAt: number
  doneAt: number
  /** 实际完成了几个番茄 */
  pomos: number
  /** 一共专注了多久（毫秒，中途停掉的也算） */
  focusMs: number
}

export type TaskBook = { list: Task[]; current: string }

const LOG_KEY = 'pomo-log-v1'
const TASK_KEY = 'tasks-v1'
const KEEP_DAYS = 400 // 日记保留一年多一点
const MAX_TASKS = 200

export async function loadPomoLog($: EngineInterface): Promise<PomoRecord[]> {
  return ((await $.store.get(LOG_KEY)) as PomoRecord[] | undefined) ?? []
}

/** 记一笔（先读最新的再加，好几个聊天同时开也不会互相覆盖） */
export async function addPomoRecord($: EngineInterface, r: PomoRecord) {
  const cutoff = r.end - KEEP_DAYS * 86400000
  const log = (await loadPomoLog($)).filter(x => x.end >= cutoff)
  // 同一个番茄（同一个开始时间）只记一次
  if (log.some(x => x.start === r.start)) return
  log.push(r)
  await $.store.set(LOG_KEY, log)
}

export async function loadTasks($: EngineInterface): Promise<TaskBook> {
  const b = (await $.store.get(TASK_KEY)) as Partial<TaskBook> | undefined
  return { list: b?.list ?? [], current: b?.current ?? '' }
}

/** 改任务清单的唯一入口：读最新 → 改 → 写回 */
export async function updateTasks($: EngineInterface, change: (b: TaskBook) => TaskBook): Promise<TaskBook> {
  const next = change(await loadTasks($))
  // 太多就把最早完成的删掉
  if (next.list.length > MAX_TASKS) {
    const doneOld = next.list.filter(t => t.done).sort((a, b) => a.doneAt - b.doneAt)
    const drop = new Set(doneOld.slice(0, next.list.length - MAX_TASKS).map(t => t.id))
    next.list = next.list.filter(t => !drop.has(t.id))
  }
  await $.store.set(TASK_KEY, next)
  return next
}

export function newTaskId(now: number): string {
  return `t${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

// ---------- 统计 ----------

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

function focusMsOf(r: PomoRecord): number {
  return Math.max(0, r.end - r.start)
}

/** 往回数：今天算第 0 天 */
function dayStart(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function pomoStats(log: PomoRecord[], book: TaskBook, now: number) {
  const today = dayKey(now)
  const todayStart = dayStart(now)
  const byDay = new Map<string, { pomos: number; focusMs: number }>()
  for (const r of log) {
    const k = dayKey(r.start)
    const v = byDay.get(k) ?? { pomos: 0, focusMs: 0 }
    if (r.done) v.pomos++
    v.focusMs += focusMsOf(r)
    byDay.set(k, v)
  }
  const dayOf = (k: string) => byDay.get(k) ?? { pomos: 0, focusMs: 0 }

  // 今天
  const todayLog = log.filter(r => r.start >= todayStart)
  const tasksDoneToday = book.list.filter(t => t.done && t.doneAt >= todayStart).length

  // 最近 7 天（含今天）
  const week = Array.from({ length: 7 }, (_, i) => {
    const ms = todayStart - (6 - i) * 86400000 + 3600000
    const k = dayKey(ms)
    const v = dayOf(k)
    return { label: i === 6 ? '今天' : `周${WEEKDAY[new Date(ms).getDay()]}`, pomos: v.pomos, focusMin: Math.round(v.focusMs / 60000) }
  })

  // 最近 30 天：一天里每个小时完成了几个番茄（看你什么时候最专注）
  const hours = Array.from({ length: 24 }, () => 0)
  for (const r of log) if (r.done && r.start >= todayStart - 29 * 86400000) hours[new Date(r.start).getHours()]! += 1

  // 专注日历：12 周 × 7 天，一列是一周（周一在最上面），最后一列是这一周
  const sinceMonday = (new Date(todayStart).getDay() + 6) % 7
  const calStart = todayStart - (sinceMonday + 11 * 7) * 86400000
  const calendar = Array.from({ length: 12 * 7 }, (_, i) => {
    const ms = calStart + i * 86400000 + 3600000 // +1 小时，避开夏令时边界
    const k = dayKey(ms)
    return { key: k, pomos: dayOf(k).pomos, future: k > today }
  })

  // 连续专注天数（今天还没做的话，从昨天往回数）
  let streak = 0
  for (let i = dayOf(today).pomos > 0 ? 0 : 1; ; i++) {
    if (dayOf(dayKey(todayStart - i * 86400000 + 3600000)).pomos > 0) streak++
    else break
  }

  const title = (id: string) => book.list.find(t => t.id === id)?.title ?? ''
  const history = [...log]
    .sort((a, b) => b.start - a.start)
    .slice(0, 20)
    .map(r => ({ start: r.start, min: Math.round(focusMsOf(r) / 60000), done: r.done, task: title(r.taskId) }))

  // 各个任务花了多少时间（最近 7 天）
  const weekStart = todayStart - 6 * 86400000
  const perTask = new Map<string, number>()
  for (const r of log) if (r.start >= weekStart) perTask.set(r.taskId, (perTask.get(r.taskId) ?? 0) + focusMsOf(r))
  const taskShare = [...perTask.entries()]
    .map(([id, ms]) => ({ title: id ? title(id) || '（已删除的任务）' : '（没指定任务）', min: Math.round(ms / 60000) }))
    .filter(x => x.min > 0)
    .sort((a, b) => b.min - a.min)
    .slice(0, 6)

  const totalDone = log.filter(r => r.done).length
  return {
    today: {
      pomos: todayLog.filter(r => r.done).length,
      stopped: todayLog.filter(r => !r.done).length,
      focusMin: Math.round(todayLog.reduce((n, r) => n + focusMsOf(r), 0) / 60000),
      tasksDone: tasksDoneToday,
    },
    week,
    weekFocusMin: week.reduce((n, d) => n + d.focusMin, 0),
    hours,
    calendar,
    streak,
    history,
    taskShare,
    total: { pomos: totalDone, focusMin: Math.round(log.reduce((n, r) => n + focusMsOf(r), 0) / 60000) },
  }
}
