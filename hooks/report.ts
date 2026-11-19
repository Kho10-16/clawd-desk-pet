// =====================================================================
// 📋 周报小助手：Clawd 每天记一本"小账本"，周末整理成周报草稿
//   数据只存在你电脑本地（$.store），不调用 AI，不花 token
// =====================================================================

import type { EngineInterface } from 'claude-code'

import { dayKey, toolKind } from './rules'
import type { ToolKind } from './rules'

/** 一天的账本 */
export type DayLog = {
  turns: number // 完成的对话轮数
  tools: number // 成功的工具调用
  edits: number // 改文件次数
  fails: number // 出错的工具调用
  kinds: Partial<Record<ToolKind, number>> // 各类动作次数
  failTools: Record<string, number> // 哪个工具出错了几次（写"遇到的困难"时参考）
  projects: string[] // 在哪些项目里工作
  files: Record<string, number> // 改了哪些文件、各几次
  pets?: number // 摸了 Clawd 几次（每日任务用；旧账本没有这一项）
  pomos?: number // 完成了几个番茄
}

const LOG_KEY = 'days-v1'
const KEEP_DAYS = 70 // 只保留最近 70 天，存档不会越来越大

function emptyDay(): DayLog {
  return { turns: 0, tools: 0, edits: 0, fails: 0, kinds: {}, failTools: {}, projects: [], files: {} }
}

/** 今天的账本（没有就是空的） */
export async function loadToday($: EngineInterface): Promise<DayLog> {
  const days = await loadDays($)
  return { ...emptyDay(), ...days[dayKey(await $.clock.now())] }
}

export async function loadDays($: EngineInterface): Promise<Record<string, DayLog>> {
  return ((await $.store.get(LOG_KEY)) as Record<string, DayLog> | undefined) ?? {}
}

/** 在今天的账本上记一笔（先读最新的再改，几个聊天同时记也不会互相覆盖） */
export async function logToday($: EngineInterface, change: (d: DayLog) => void) {
  const now = await $.clock.now()
  const today = dayKey(now)
  const days = await loadDays($)
  const d = { ...emptyDay(), ...days[today] }
  change(d)
  days[today] = d
  // 删掉太旧的
  const oldest = dayKey(now - KEEP_DAYS * 86400000)
  for (const k of Object.keys(days)) if (k < oldest) delete days[k]
  await $.store.set(LOG_KEY, days)
}

/** 取路径最后一段：D:\a\b\app.py → app.py */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export function logTool(d: DayLog, tool: string, ok: boolean, filePath?: string) {
  if (!ok) {
    d.fails++
    d.failTools[tool] = (d.failTools[tool] ?? 0) + 1
    return
  }
  d.tools++
  const k = toolKind(tool)
  d.kinds[k] = (d.kinds[k] ?? 0) + 1
  if (k === 'build') {
    d.edits++
    if (filePath) {
      const f = baseName(filePath)
      d.files[f] = (d.files[f] ?? 0) + 1
    }
  }
}

export function logProject(d: DayLog, cwd: string) {
  const name = baseName(cwd)
  // scratch 临时文件夹不算项目
  if (name && !name.startsWith('scratch-') && !d.projects.includes(name)) d.projects.push(name)
}

// =====================================================================
// 一周的统计
// =====================================================================

/** 这一天所在那周的周一（ms） */
function mondayOf(ms: number): number {
  const d = new Date(ms)
  const dow = (d.getDay() + 6) % 7 // 周一 = 0
  d.setHours(0, 0, 0, 0)
  return d.getTime() - dow * 86400000
}

/** ISO 周数（一年里的第几周） */
export function isoWeek(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const jan4 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
}

export type Week = {
  start: string // 周一
  end: string // 周日
  week: number // ISO 周数
  /** 实习第几周（设了实习开始日期才有） */
  internWeek: number | null
  days: { key: string; label: string; log: DayLog }[]
  total: DayLog
  activeDays: number
}

const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日']

/** offset = 0 本周，-1 上周 …… */
export function buildWeek(all: Record<string, DayLog>, now: number, offset: number, internStart: string): Week {
  const mon = mondayOf(now) + offset * 7 * 86400000
  const days = WEEKDAY.map((w, i) => {
    const key = dayKey(mon + i * 86400000 + 3600000) // +1 小时，避开夏令时边界
    return { key, label: `周${w}`, log: { ...emptyDay(), ...all[key] } }
  })
  const total = emptyDay()
  for (const { log } of days) {
    total.turns += log.turns
    total.tools += log.tools
    total.edits += log.edits
    total.fails += log.fails
    total.pomos = (total.pomos ?? 0) + (log.pomos ?? 0)
    for (const [k, v] of Object.entries(log.kinds)) total.kinds[k as ToolKind] = (total.kinds[k as ToolKind] ?? 0) + (v ?? 0)
    for (const [k, v] of Object.entries(log.failTools)) total.failTools[k] = (total.failTools[k] ?? 0) + v
    for (const p of log.projects) if (!total.projects.includes(p)) total.projects.push(p)
    for (const [k, v] of Object.entries(log.files)) total.files[k] = (total.files[k] ?? 0) + v
  }
  let internWeek: number | null = null
  if (/^\d{4}-\d{2}-\d{2}$/.test(internStart)) {
    const [y, m, d] = internStart.split('-').map(Number) as [number, number, number]
    const startMon = mondayOf(new Date(y, m - 1, d).getTime())
    internWeek = Math.floor((mon - startMon) / (7 * 86400000)) + 1
    if (internWeek < 1) internWeek = null
  }
  return {
    start: days[0]!.key,
    end: days[6]!.key,
    week: isoWeek(mon),
    internWeek,
    days,
    total,
    activeDays: days.filter(d => d.log.turns + d.log.tools > 0).length,
  }
}

/** 次数最多的前 n 个 */
export function top(rec: Record<string, number>, n: number): [string, number][] {
  return Object.entries(rec)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

const KIND_NAME: Record<ToolKind, string> = {
  type: '跑命令',
  read: '读代码',
  build: '改代码',
  search: '查资料',
  plan: '做计划',
  other: '其他操作',
}

// =====================================================================
// 生成周报草稿（Markdown），格式：周数和日期 / 目前进度 / 遇到的困难 / 下周计划 / 截图
// =====================================================================

export function weekMarkdown(w: Week): string {
  const t = w.total
  const title = w.internWeek ? `实习第 ${w.internWeek} 周` : `第 ${w.week} 周`
  const kinds = (Object.entries(t.kinds) as [ToolKind, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${KIND_NAME[k]} ${v} 次`)
    .join('、')
  const files = top(t.files, 8).map(([f, n]) => `\`${f}\`（${n} 次）`).join('、')
  const fails = top(t.failTools, 5).map(([f, n]) => `${f} ${n} 次`).join('、')
  const busiest = [...w.days].sort((a, b) => b.log.turns - a.log.turns)[0]

  const lines = [
    `# 实习周报 · ${title}（${w.start} ~ ${w.end}）`,
    '',
    '## 目前进度',
    '',
    `- 本周有 ${w.activeDays} 天在开发，和 Claude Code 完成了 ${t.turns} 轮对话，成功执行 ${t.tools} 次操作（${kinds || '无'}）`,
    t.projects.length ? `- 参与的项目：${t.projects.join('、')}` : '- 参与的项目：（填写）',
    t.edits ? `- 共修改文件 ${t.edits} 次，主要改动：${files || '（填写）'}` : '- 本周没有修改文件',
    t.pomos ? `- 用番茄钟专注了 ${t.pomos} 个番茄（约 ${Math.round((t.pomos * 25) / 60 * 10) / 10} 小时）` : "",
    busiest && busiest.log.turns > 0 ? `- 最忙的一天：${busiest.label}（${busiest.key}），${busiest.log.turns} 轮对话` : '',
    '- （补充：具体完成了哪些功能 / 页面）',
    '',
    '## 遇到的困难',
    '',
    t.fails ? `- 本周有 ${t.fails} 次操作出错（${fails}），可回想当时卡在哪里：` : '- 本周没有操作出错',
    '- （填写：遇到的问题，以及怎么解决的）',
    '',
    '## 下周计划',
    '',
    '- （填写）',
    '',
    '## 截图',
    '',
    '（在这里贴截图）',
    '',
  ]
  return lines.filter(l => l !== '' || true).join('\n').replace(/\n{3,}/g, '\n\n')
}
