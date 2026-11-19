// =====================================================================
// 📅 每日任务：每天固定抽 3 个小任务，完成就领金币和经验
//   进度直接用周报的"小账本"（DayLog）算，不用另外记
// =====================================================================

import type { DayLog } from './report'

/** 一种任务的模板：同一种任务有几档难度 */
type QuestTemplate = {
  id: string
  /** {n} 会换成目标数字 */
  text: string
  /** 今天做到多少了 */
  measure: (d: DayLog) => number
  /** 几档难度的目标 */
  targets: number[]
}

const TEMPLATES: QuestTemplate[] = [
  { id: 'turns', text: '完成 {n} 轮对话', measure: d => d.turns, targets: [3, 5, 8] },
  { id: 'edits', text: '修改文件 {n} 次', measure: d => d.edits, targets: [3, 6, 10] },
  { id: 'tools', text: '成功执行 {n} 次操作', measure: d => d.tools, targets: [15, 30, 50] },
  { id: 'read', text: '读代码 {n} 次', measure: d => d.kinds.read ?? 0, targets: [5, 10, 20] },
  { id: 'type', text: '跑命令 {n} 次', measure: d => d.kinds.type ?? 0, targets: [3, 6, 10] },
  { id: 'search', text: '上网查资料 {n} 次', measure: d => d.kinds.search ?? 0, targets: [1, 2, 3] },
  { id: 'pets', text: '摸摸 Clawd {n} 次', measure: d => d.pets ?? 0, targets: [3, 5, 8] },
  { id: 'projects', text: '在 {n} 个不同项目里工作', measure: d => d.projects.length, targets: [2, 2, 3] },
]

/** 难度越高奖励越多 */
const REWARD_COINS = [15, 20, 30]
const REWARD_XP = [10, 15, 20]

/** 3 个全部完成的额外大奖 */
export const ALL_DONE_COINS = 30
export const ALL_DONE_XP = 20
/** 存在"已完成"列表里，代表"大奖已经领过" */
export const ALL_DONE_MARK = 'ALL'

export type Quest = {
  /** 例如 "turns:5"：同一天里不会重复 */
  key: string
  text: string
  target: number
  coins: number
  xp: number
  measure: (d: DayLog) => number
}

/**
 * 用日期当"随机种子"：同一天算出来的任务永远一样，
 * 所以几个聊天同时开着，看到的也是同一组任务。
 */
function seedOf(day: string): number {
  let h = 2166136261
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return h
}

/** 一个很小的伪随机数生成器：给同一个种子，永远吐出同一串数字 */
function rng(seed: number): () => number {
  let s = seed || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

export function questsFor(day: string): Quest[] {
  const rand = rng(seedOf(day))
  const pool = [...TEMPLATES]
  const out: Quest[] = []
  while (out.length < 3 && pool.length > 0) {
    const t = pool.splice(Math.floor(rand() * pool.length), 1)[0]!
    const level = Math.floor(rand() * t.targets.length)
    const target = t.targets[level]!
    out.push({
      key: `${t.id}:${target}`,
      text: t.text.replace('{n}', String(target)),
      target,
      coins: REWARD_COINS[level]!,
      xp: REWARD_XP[level]!,
      measure: t.measure,
    })
  }
  return out
}
