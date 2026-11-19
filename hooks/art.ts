// =====================================================================
// 美术：Clawd 本体、工具道具、装扮，全部用小方块拼出来（SVG）
// =====================================================================

import type { Mood, Outfit } from '../types'
import { toolKind } from './rules'
import type { Form, ToolKind } from './rules'

// ---------- 文字版 Clawd（终端用） ----------
const EYES_OPEN = ' ▐▛███▜▌ '
const EYES_SHUT = ' ▐█████▌ '
const BODY = '▝▜█████▛▘'
const FEET_STAND = '  ▘▘ ▝▝  '
const FEET_STEP = '  ▝▘ ▘▝  '
const FEET_AIR = '         '

export function clawdText(mood: Mood, frame: number): [string, string, string] {
  const f = frame % 2
  const blink = frame % 6 === 5
  switch (mood) {
    case 'working':
      return [EYES_OPEN, BODY, f ? FEET_STEP : FEET_STAND]
    case 'happy':
      return f ? [FEET_AIR, EYES_OPEN, BODY] : [EYES_OPEN, BODY, FEET_STAND]
    case 'sleepy':
    case 'love':
    case 'sad':
    case 'hungry':
    case 'oops':
      return [EYES_SHUT, BODY, FEET_STAND]
    default:
      return [blink ? EYES_SHUT : EYES_OPEN, BODY, FEET_STAND]
  }
}

// 文字版头顶装饰
export const ABOVE: Record<Mood, [string, string]> = {
  idle: ['', ''],
  thinking: ['  .  ', '  . . .'],
  working: ['  ⚙', '    ⚙'],
  happy: ['  ✧', '    ♪'],
  sad: ['  ;', ''],
  sleepy: ['     z', '       zZ'],
  love: ['   ♡', '  ♡   ♡'],
  hungry: ['  …', '   …'],
  oops: ['  ✗', '  ✗ ~'],
  waiting: ['  !', '  ?'],
}

export const LINES: Record<Mood, string[]> = {
  idle: ['今天也要加油写代码！', '有什么要做的吗？', '我在这儿陪你～'],
  thinking: ['让我想想……', '嗯……思考中', 'Claude 在动脑筋！'],
  working: [],
  happy: ['搞定啦！', '完成！夸夸我', '又解决一个问题 ✨'],
  sad: ['呜……出问题了', '没关系，再试一次', '被打断了……'],
  sleepy: ['好困……zzz', '你去哪了……', '打个盹先'],
  love: ['嘿嘿，好舒服', '再摸一下！', '最喜欢你了'],
  hungry: ['好饿……陪我写点代码吧', '肚子咕咕叫……', '用用 Claude Code 就能喂饱我'],
  oops: ['哎呀，搞砸了……', '冒烟了！', '再来一次！'],
  waiting: ['Claude 在等你回复！', '快回来看看～', '有事找你！'],
}

export const MOOD_LABEL: Record<Mood, string> = {
  idle: '发呆',
  thinking: '思考中',
  working: '干活中',
  happy: '开心',
  sad: '难过',
  sleepy: '睡觉',
  love: '被摸头',
  hungry: '饿了',
  oops: '出错了',
  waiting: '等你回复',
}

// ---------- 像素版 Clawd ----------
// 像十字绣：每个字符是一个像素格子。
//   X = 橙色身体   E = 眼睛   A / B = 两组小脚
const SPRITE_BABY = [
  '.............',
  '.............',
  '.............',
  '...XXXXXXX...',
  '...XEXXXEX...',
  '...XEXXXEX...',
  '...XXXXXXX...',
  '...A.B.A.B...',
]
const SPRITE_ADULT = [
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '..XXEXXXEXX..',
  '..XXEXXXEXX..',
  'LLXXXXXXXXXRR', // L / R = 左右两只小钳子（可以单独动）
  '..XXXXXXXXX..',
  '...A.B.A.B...',
  '...A.B.A.B...',
]

const ORANGE = '#D97757'
const EYE = '#1a1a1a'

/** 把一行里连续的同一种字符合并成一个长方形 */
function rects(sprite: string[], ch: string, fill: string, opts: { onlyRows?: number[]; dy?: number } = {}): string {
  let out = ''
  sprite.forEach((row, y) => {
    if (opts.onlyRows && !opts.onlyRows.includes(y)) return
    let x = 0
    while (x < row.length) {
      if (row[x] !== ch) {
        x++
        continue
      }
      const start = x
      while (row[x] === ch) x++
      out += `<rect x="${start}" y="${y + (opts.dy ?? 0)}" width="${x - start}" height="1" fill="${fill}"/>`
    }
  })
  return out
}

/** 画一个小方块（坐标可以是小数） */
function px(x: number, y: number, w: number, h: number, fill: string, style = ''): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${style ? ` style="${style}"` : ''}/>`
}

const CSS = `
  * { shape-rendering: crispEdges; }
  .fill-box { transform-box: fill-box; transform-origin: center; }
  @keyframes bob   { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-0.5px) } }
  @keyframes jump  { 0%,100% { transform: translateY(0) } 40% { transform: translateY(-2px) } }
  @keyframes blink { 0%,90%,100% { transform: scaleY(1) } 94% { transform: scaleY(0.1) } }
  @keyframes step  { 0%,49% { transform: translateY(0) } 50%,100% { transform: translateY(-1px) } }
  @keyframes rise  { 0% { transform: translateY(0); opacity: 0 } 20% { opacity: 1 } 100% { transform: translateY(-4px); opacity: 0 } }
  @keyframes fade  { 0%,100% { opacity: .15 } 50% { opacity: 1 } }
  @keyframes drop  { 0% { transform: translateY(0); opacity: 1 } 100% { transform: translateY(3px); opacity: 0 } }
  @keyframes sway  { 0%,100% { transform: translateX(0) } 50% { transform: translateX(0.5px) } }
  @keyframes droop { 0%,100% { transform: translateY(0.3px) } 50% { transform: translateY(0.8px) } }
  @keyframes swing { 0%,100% { transform: rotate(-40deg) } 50% { transform: rotate(15deg) } }
  @keyframes scan  { 0%,100% { transform: translateX(-0.3px) } 50% { transform: translateX(0.3px) } }
  @keyframes shake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-0.4px) } 75% { transform: translateX(0.4px) } }
  @keyframes wiggle { 0%,100% { transform: rotate(-8deg) } 50% { transform: rotate(8deg) } }
  @keyframes wobble { 0%,100% { transform: translate(-0.4px,0) } 25% { transform: translate(0,-0.4px) } 50% { transform: translate(0.4px,0) } 75% { transform: translate(0,-0.4px) } }
  @keyframes hop   { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-0.9px) } }
  @keyframes bigjump { 0%,100% { transform: translateY(0) scaleY(1) } 10% { transform: translateY(0.3px) scaleY(.9) } 45% { transform: translateY(-3px) scaleY(1.05) } }
  @keyframes bowdown { 0%,70%,100% { transform: translateY(0) scaleY(1) } 80%,88% { transform: translateY(0.3px) scaleY(.88) } }
  @keyframes float { 0%,100% { transform: translateY(-0.4px) } 50% { transform: translateY(-1.6px) } }
  @keyframes clawup { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-1px) } }
  @keyframes clawhigh { 0%,100% { transform: translateY(-1.5px) } 50% { transform: translateY(-2.2px) } }
  @keyframes hatlift { 0%,60%,100% { transform: translateY(0) } 72%,88% { transform: translateY(-1.6px) } }
  @keyframes orbit { from { transform: rotate(0) } to { transform: rotate(360deg) } }
  @keyframes bubble { 0%,100% { transform: scale(.3) } 70% { transform: scale(1.2) } 75% { transform: scale(0) } }
  @keyframes shadow { 0%,100% { transform: scaleX(1) } 50% { transform: scaleX(.7) } }
  @keyframes burst { 0% { transform: scale(0); opacity: 1 } 100% { transform: scale(1.6); opacity: 0 } }
  @keyframes stretch { 0%,100% { transform: scaleY(1) } 50% { transform: scaleY(1.15) } }
  @keyframes walk  { 0%,100% { transform: translateX(-1.5px) } 50% { transform: translateX(1.5px) } }
  @keyframes look  { 0%,100% { transform: translateX(-0.6px) } 50% { transform: translateX(0.6px) } }
  @keyframes yawnm { 0%,100% { transform: scaleY(.2) } 50% { transform: scaleY(1.3) } }
  @keyframes flipA { 0% { opacity: 1 } 50% { opacity: .25 } }
  @keyframes flipB { 0% { opacity: .25 } 50% { opacity: 1 } }
  @keyframes glow  { 0%,100% { filter: drop-shadow(0 0 0.3px #ffd27a) } 50% { filter: drop-shadow(0 0 1.4px #ffd27a) } }
`

/** 身体的位置：宝宝和大 Clawd 不一样，装扮要跟着对齐 */
type Geom = { headTop: number; eyeTop: number; left: number; right: number }

// =====================================================================
// 工具道具
// =====================================================================

function propSvg(kind: ToolKind, eyeTop: number): { front: string; ground: string; fx: string } {
  switch (kind) {
    case 'type': {
      // ⌨️ 身前一块小键盘，按键轮流亮起
      const keys = [0, 1, 2, 3, 4]
        .map(i => px(1.8 + i * 2, 7.9, 1.3, 0.6, '#cfcfcf', `animation:fade .45s infinite ${i * 0.11}s`))
        .join('')
      return { front: '', ground: px(1, 7.5, 11, 1.4, '#4a4a4a') + keys, fx: '' }
    }
    case 'read': {
      // 📖 戴眼镜 + 捧一本书（书放在眼睛下方）
      const by = eyeTop + 2.7
      const glasses =
        `<rect x="3.6" y="${eyeTop - 0.4}" width="1.8" height="2.8" fill="none" stroke="#1a1a1a" stroke-width="0.35"/>` +
        `<rect x="7.6" y="${eyeTop - 0.4}" width="1.8" height="2.8" fill="none" stroke="#1a1a1a" stroke-width="0.35"/>` +
        px(5.4, eyeTop + 0.3, 2.2, 0.35, '#1a1a1a')
      const lines = [0, 1, 2]
        .map(
          i =>
            px(3.9, by + 0.4 + i * 0.5, 2.2, 0.25, '#9aa', `animation:fade 1.5s infinite ${i * 0.4}s`) +
            px(6.9, by + 0.4 + i * 0.5, 2.2, 0.25, '#9aa', `animation:fade 1.5s infinite ${0.2 + i * 0.4}s`),
        )
        .join('')
      const book = px(3.5, by, 3, 2.2, '#f4efe6') + px(6.5, by, 3, 2.2, '#e9e2d4') + px(6.4, by, 0.2, 2.2, '#9c8f7a') + lines
      return { front: glasses + book, ground: '', fx: '' }
    }
    case 'build': {
      // 🔨 右手抡小锤子，敲出火花
      const hammer =
        `<g style="transform-origin:12.5px 4.6px;animation:swing .4s ease-in-out infinite">` +
        px(12.2, 1.2, 0.7, 3.4, '#8b5a2b') +
        px(11, 0.2, 3.1, 1.3, '#9aa0a6') +
        `</g>`
      const sparks = `<text x="12.6" y="7" font-size="2" fill="#ffd27a" style="animation:fade .4s infinite">✦</text>`
      return { front: hammer, ground: '', fx: sparks }
    }
    case 'search': {
      // 🔭 举起望远镜，远处星星一闪一闪
      const scope =
        `<g style="transform-origin:9px 2.6px;transform:rotate(-30deg)">` +
        px(9, 2, 4.2, 1.1, '#8b6b4a') +
        px(12.8, 1.7, 1, 1.7, '#c9a14a') +
        `</g>`
      const stars =
        `<text x="12.3" y="-1.8" font-size="2" fill="#ffd27a" style="animation:fade 1s infinite">✧</text>` +
        `<text x="10" y="-2.8" font-size="1.4" fill="#ffd27a" style="animation:fade 1s infinite .5s">✧</text>`
      return { front: scope, ground: '', fx: stars }
    }
    case 'plan': {
      // 📋 捧着小本本，一项项打勾（本子放在眼睛下方）
      const by = eyeTop + 2.4
      const board = px(3.8, by, 5.4, 3.4, '#c9a26b') + px(4.3, by + 0.5, 4.4, 2.6, '#fafafa')
      const ticks = [0, 1, 2]
        .map(
          i =>
            px(4.7, by + 0.8 + i * 0.75, 0.5, 0.5, '#4caf50', `animation:fade 1.8s infinite ${i * 0.5}s`) +
            px(5.5, by + 0.95 + i * 0.75, 2.8, 0.25, '#999'),
        )
        .join('')
      return { front: board + ticks, ground: '', fx: '' }
    }
    default:
      return {
        front: '',
        ground: '',
        fx: `<text x="10.8" y="-0.5" font-size="2.4" fill="#aaa" style="animation:fade .8s infinite">⚙</text>`,
      }
  }
}

// =====================================================================
// 装扮：每件都是几块小方块
// =====================================================================

function itemSvg(id: string, g: Geom): string {
  const W = g.right - g.left + 1 // 身体宽度
  const nY = g.eyeTop + 2.2 // "脖子"的位置
  switch (id) {
    // ----- 头饰 -----
    case 'sprout': // 🌱 小嫩芽，会轻轻摇
      return (
        `<g style="transform-origin:6.5px ${g.headTop}px;animation:wiggle 2s ease-in-out infinite">` +
        px(6.3, g.headTop - 1.6, 0.4, 1.6, '#5aa75e') +
        px(5.1, g.headTop - 2.1, 1.2, 0.7, '#7ccf7f') +
        px(6.7, g.headTop - 2.5, 1.2, 0.7, '#7ccf7f') +
        `</g>`
      )
    case 'bow': // 🎀 蝴蝶结，歪戴在右边
      return (
        px(g.right - 2, g.headTop - 1.3, 1.1, 1.3, '#f48fb1') +
        px(g.right - 0.9, g.headTop - 0.9, 0.7, 0.6, '#e06c98') +
        px(g.right - 0.2, g.headTop - 1.3, 1.1, 1.3, '#f48fb1')
      )
    case 'gradcap': // 🎓 学士帽 + 金色流苏
      return (
        px(g.left + 1.5, g.headTop - 1.6, W - 3, 0.6, '#222') +
        px(g.left + 2.5, g.headTop - 1, W - 5, 1, '#222') +
        px(g.right - 1.2, g.headTop - 1.3, 0.35, 2, '#f2c94c')
      )
    case 'headphones': // 🎧 耳机
      return (
        px(g.left, g.headTop - 1, W, 0.5, '#555') +
        px(g.left - 0.5, g.headTop - 1, 0.5, g.eyeTop - g.headTop + 0.5, '#555') +
        px(g.right + 1, g.headTop - 1, 0.5, g.eyeTop - g.headTop + 0.5, '#555') +
        px(g.left - 0.9, g.eyeTop - 0.5, 1.2, 2.2, '#333') +
        px(g.right + 0.7, g.eyeTop - 0.5, 1.2, 2.2, '#333')
      )
    case 'tophat': // 🎩 小礼帽 + 金色丝带
      return (
        px(g.left + 2, g.headTop - 3, W - 4, 2, '#5a524c') +
        px(g.left + 2, g.headTop - 2, W - 4, 0.6, '#f0c27b') +
        px(g.left, g.headTop - 1, W, 1, '#5a524c')
      )
    case 'crown': // 👑 小皇冠
      return (
        px(g.left + 2, g.headTop - 2.2, 1, 1, '#f2c94c') +
        px(6, g.headTop - 2.6, 1, 1.4, '#f2c94c') +
        px(g.right - 2, g.headTop - 2.2, 1, 1, '#f2c94c') +
        px(g.left + 2, g.headTop - 1.3, W - 4, 1.3, '#f2c94c') +
        px(6.15, g.headTop - 1, 0.7, 0.6, '#e5534b')
      )
    case 'santa': // 🎅 圣诞帽
      return (
        px(g.left + 1, g.headTop - 2, W - 2, 1.3, '#d64545') +
        px(g.left + 3, g.headTop - 3, W - 4, 1.1, '#d64545') +
        px(g.right - 1, g.headTop - 3.6, 1.6, 0.8, '#d64545') +
        px(g.right + 0.5, g.headTop - 4, 1, 1, '#ffffff') +
        px(g.left, g.headTop - 0.9, W, 0.9, '#ffffff')
      )
    // ----- 脸部 -----
    case 'blush': // ☺ 小腮红
      return px(g.left + 0.2, g.eyeTop + 2, 1.6, 0.9, '#ff5c8a') + px(g.right - 0.8, g.eyeTop + 2, 1.6, 0.9, '#ff5c8a')
    case 'sunglasses': // 😎 墨镜
      return (
        px(3.4, g.eyeTop - 0.1, 2.2, 2.1, '#111') +
        px(7.4, g.eyeTop - 0.1, 2.2, 2.1, '#111') +
        px(5.6, g.eyeTop + 0.2, 1.8, 0.4, '#111') +
        px(3.7, g.eyeTop + 0.1, 0.5, 0.4, '#fff', 'opacity:.8') +
        px(7.7, g.eyeTop + 0.1, 0.5, 0.4, '#fff', 'opacity:.8')
      )
    case 'monocle': // 🧐 单片眼镜 + 金链
      return (
        `<circle cx="8.5" cy="${g.eyeTop + 1}" r="1.3" fill="none" stroke="#f2c94c" stroke-width="0.3"/>` +
        `<line x1="9.6" y1="${g.eyeTop + 1.7}" x2="10.6" y2="${g.eyeTop + 4}" stroke="#f2c94c" stroke-width="0.2"/>`
      )
    // ----- 颈部 -----
    case 'bowtie': // 🎀 小领结
      return px(5, nY, 1, 1.2, '#2b3a67') + px(6, nY + 0.3, 1, 0.6, '#1b2545') + px(7, nY, 1, 1.2, '#2b3a67')
    case 'scarf': // 🧣 围巾
      return (
        px(g.left, nY - 0.1, W, 0.9, '#3d7cc9') +
        px(g.right - 2, nY + 0.8, 1, 1.8, '#3d7cc9') +
        px(g.right - 2, nY + 1.6, 1, 0.3, '#fff')
      )
    case 'medal': // 🥇 金牌
      return px(6, nY, 1, 1.2, '#4a7bd0') + `<circle cx="6.5" cy="${nY + 1.9}" r="0.8" fill="#f2c94c"/>`

    // ----- 🛒 商店限定 -----
    case 'party': // 🥳 派对帽：蓝黄条纹的尖帽子 + 小绒球
      return (
        px(4.5, g.headTop - 1, 4, 1, '#4a90e2') +
        px(5, g.headTop - 2, 3, 1, '#ffd23f') +
        px(5.5, g.headTop - 3, 2, 1, '#4a90e2') +
        px(6, g.headTop - 3.8, 1, 0.8, '#ff6b9d')
      )
    case 'catears': // 🐱 猫耳朵：左右两只，带粉色内耳
      return (
        px(g.left + 0.3, g.headTop - 1.2, 1.6, 1.2, '#b85a3e') +
        px(g.left + 0.6, g.headTop - 1.9, 1, 0.7, '#b85a3e') +
        px(g.left + 0.7, g.headTop - 0.9, 0.8, 0.9, '#f4a6b8') +
        px(g.right - 0.9, g.headTop - 1.2, 1.6, 1.2, '#b85a3e') +
        px(g.right - 0.6, g.headTop - 1.9, 1, 0.7, '#b85a3e') +
        px(g.right - 0.5, g.headTop - 0.9, 0.8, 0.9, '#f4a6b8')
      )
    case 'halo': // 😇 天使光环：头顶飘着的金色圆环
      return `<ellipse cx="6.5" cy="${g.headTop - 2}" rx="2.8" ry="0.6" fill="none" stroke="#ffe27a" stroke-width="0.4" style="animation:float 2s ease-in-out infinite"/>`
    case 'mustache': // 🥸 小胡子：两撇往上翘
      return (
        px(4.4, g.eyeTop + 2.3, 1.9, 0.6, '#3b2416') +
        px(6.7, g.eyeTop + 2.3, 1.9, 0.6, '#3b2416') +
        px(6.1, g.eyeTop + 2.1, 0.8, 0.6, '#3b2416') +
        px(3.9, g.eyeTop + 1.9, 0.6, 0.5, '#3b2416') +
        px(8.5, g.eyeTop + 1.9, 0.6, 0.5, '#3b2416')
      )
    case 'starglasses': // 🤩 星星眼镜：两颗大星星罩住眼睛
      return (
        `<text x="2.9" y="${g.eyeTop + 2.2}" font-size="3" fill="#ffd23f" stroke="#c99a00" stroke-width="0.15">★</text>` +
        `<text x="6.9" y="${g.eyeTop + 2.2}" font-size="3" fill="#ffd23f" stroke="#c99a00" stroke-width="0.15">★</text>` +
        px(5.5, g.eyeTop + 0.6, 2, 0.3, '#c99a00')
      )
    case 'bell': // 🔔 小铃铛：红色项圈 + 金铃铛
      return (
        px(g.left, nY, W, 0.5, '#d64545') +
        `<circle cx="6.5" cy="${nY + 1.2}" r="0.75" fill="#f2c94c"/>` +
        px(6.3, nY + 1.3, 0.4, 0.5, '#8a6d00')
      )
    default:
      return ''
  }
}

// =====================================================================
// 组装：本体 + 装扮 + 道具 + 特效
// =====================================================================

// =====================================================================
// 四个形态，各有各的性格：
//   宝宝期 baby  — 摇摇晃晃、吐泡泡，干活笨手笨脚还会流汗，开心时小碎步跳
//   成长期 teen  — 精力旺盛、挥舞钳子，干活带速度线，开心时举钳大跳
//   绅士期 gent  — 慢条斯理、定时鞠躬、哼小曲，开心时抬帽致意
//   闪耀期 shiny — 漂浮半空、星星绕身转，开心时星星炸开
// =====================================================================

/** 动画 = [名字, 秒数, 其他参数] */
type Anim = [string, number, string?]

/** 节奏：数字越大越慢。宝宝慢吞吞，成长期急急忙忙，绅士从容 */
const TEMPO: Record<Form, number> = { baby: 1.3, teen: 0.8, gent: 1.25, shiny: 1 }

function anim(a: Anim | null, tempo: number): string {
  if (!a) return 'none'
  const [name, sec, rest = 'ease-in-out infinite'] = a
  return `${name} ${(sec * tempo).toFixed(2)}s ${rest}`
}

/** 每个形态在各种心情下，身体怎么动 */
function bodyMove(mood: Mood, form: Form): Anim | null {
  switch (mood) {
    case 'idle':
      return { baby: ['wobble', 1.6], teen: ['bob', 1.8], gent: ['bowdown', 5], shiny: ['float', 3] }[form] as Anim
    case 'happy':
      return { baby: ['hop', 0.35], teen: ['bigjump', 0.7], gent: ['bob', 2], shiny: ['float', 1.2] }[form] as Anim
    case 'thinking':
      return form === 'shiny' ? ['float', 2] : ['sway', 1.6]
    case 'sleepy':
      return form === 'shiny' ? ['float', 5] : ['bob', 4]
    case 'love':
      return form === 'baby' ? ['wobble', 0.8] : ['bob', 1]
    case 'hungry':
      return ['droop', 2]
    case 'oops':
      return ['shake', 0.3]
    case 'waiting':
      return ['hop', 0.5] // 一蹦一蹦，吸引你注意
    case 'sad':
      return null
    default:
      return ['bob', 0.35]
  }
}

const KIND_MOVE: Record<ToolKind, Anim> = {
  type: ['bob', 0.25],
  read: ['bob', 3],
  build: ['bob', 0.4],
  search: ['sway', 2],
  plan: ['bob', 1.5],
  other: ['bob', 0.35],
}

/** 小钳子怎么动（宝宝期还没长钳子） */
function clawMove(mood: Mood, form: Form, side: 'L' | 'R'): string {
  if (form === 'baby') return 'none'
  const half = side === 'R' ? ' .6s' : ''
  // 等你回复：所有形态都高举钳子挥手
  if (mood === 'waiting') return `clawhigh .5s ease-in-out infinite${side === 'R' ? ' .25s' : ''}`
  if (form === 'teen') {
    if (mood === 'idle') return `clawup 1.2s ease-in-out infinite${half}`
    if (mood === 'happy') return 'clawhigh 0.35s ease-in-out infinite'
    if (mood === 'working') return `clawup 0.3s ease-in-out infinite${half}`
  }
  if (form === 'shiny' && (mood === 'idle' || mood === 'happy')) return `clawup 2.4s ease-in-out infinite${half}`
  return 'none'
}

/** 形态专属的小特效 */
function formFlair(mood: Mood, form: Form, g: Geom): { back: string; over: string } {
  let back = ''
  let over = ''
  if (form === 'baby') {
    if (mood === 'idle') {
      // 吐泡泡
      over += `<circle cx="10.5" cy="${g.eyeTop + 1.5}" r="0.5" fill="none" stroke="#9fd3ff" stroke-width="0.2" style="animation:rise 2.6s infinite"/>`
      over += `<circle cx="11.5" cy="${g.eyeTop + 2}" r="0.35" fill="none" stroke="#9fd3ff" stroke-width="0.2" style="animation:rise 2.6s infinite 1.3s"/>`
    }
    if (mood === 'sleepy') {
      // 鼻涕泡：一大一小地鼓起来
      over += `<circle cx="7.5" cy="${g.eyeTop + 2.7}" r="0.9" fill="#bfe3ff" opacity=".75" class="fill-box" style="animation:bubble 3s ease-in-out infinite"/>`
    }
    if (mood === 'working') {
      // 笨手笨脚，流汗
      over += px(g.right + 0.4, g.headTop + 0.3, 0.45, 0.8, '#7cc4ff', 'animation:drop 1.1s infinite')
    }
  }
  if (form === 'teen' && mood === 'working') {
    // 速度线
    over += [0, 1, 2].map(i => px(-0.9, 1.5 + i * 1.6, 1.3, 0.25, '#aaa', `animation:fade .3s infinite ${i * 0.1}s`)).join('')
  }
  if (form === 'gent' && mood === 'idle') {
    // 哼小曲
    over += `<text x="11" y="0" font-size="2" fill="#bbb" style="animation:rise 4s infinite">♪</text>`
  }
  if (form === 'shiny') {
    // 身下的影子（漂浮时会缩小）
    back += `<ellipse cx="6.5" cy="8.7" rx="4" ry="0.35" fill="#000" opacity=".25" class="fill-box" style="animation:shadow 3s ease-in-out infinite"/>`
    if (mood !== 'sleepy') {
      // 星星绕着身体转
      over +=
        `<g style="transform-origin:6.5px 3px;animation:orbit 6s linear infinite">` +
        `<text x="6" y="-3.6" font-size="1.6" fill="#ffd27a">✦</text>` +
        `<text x="13.2" y="3.6" font-size="1.3" fill="#ffe9a8">✧</text>` +
        `<text x="-0.6" y="8" font-size="1.3" fill="#ffd27a">✦</text></g>`
    }
    if (mood === 'happy') {
      // 星星炸开
      over += [
        [0, -2],
        [12, -2],
        [-0.5, 6],
        [12.5, 6],
      ]
        .map(([x, y], i) => `<text x="${x}" y="${y}" font-size="2" fill="#ffd27a" class="fill-box" style="animation:burst .8s ease-out infinite ${i * 0.2}s">✦</text>`)
        .join('')
    }
  }
  return { back, over }
}

// =====================================================================
// 🎭 发呆小剧场：每一段改变身体动作、眼睛、钳子，再加点道具和特效
// =====================================================================

type SkitLook = {
  move?: Anim
  eyes?: 'shut' | 'look'
  clawL?: string
  clawR?: string
  walking?: boolean
  front?: string
  fx?: string
}

function skitLook(skit: string, g: Geom): SkitLook {
  switch (skit) {
    case 'stretch': // 伸懒腰：身体往上拉长，钳子举高，眯眼
      return { move: ['stretch', 2], eyes: 'shut', clawL: 'clawhigh 2s ease-in-out infinite', clawR: 'clawhigh 2s ease-in-out infinite' }
    case 'yawn': // 打哈欠：张大嘴 + 飘出一个 ~
      return {
        eyes: 'shut',
        front: `<rect x="5.75" y="${g.eyeTop + 2.1}" width="1.5" height="1" fill="#3a1f17" class="fill-box" style="animation:yawnm 1.8s ease-in-out infinite"/>`,
        fx: `<text x="10.5" y="0" font-size="2.6" fill="#999" style="animation:rise 1.8s infinite">~</text>`,
      }
    case 'walk': // 散步：左右走两步，小脚交替
      return { move: ['walk', 2.5, 'ease-in-out infinite'], walking: true }
    case 'look': // 东张西望：眼睛左看右看 + 问号
      return { eyes: 'look', fx: `<text x="11" y="-0.5" font-size="2.8" fill="#bbb" style="animation:fade 1.4s infinite">?</text>` }
    case 'scratch': // 挠头：右钳举到头上，挠出几道小线
      return {
        clawR: 'clawhigh .25s ease-in-out infinite',
        fx: [0, 1].map(i => px(g.right + 0.2, g.headTop - 0.5 + i * 0.7, 0.9, 0.2, '#ccc', `animation:fade .25s infinite ${i * 0.12}s`)).join(''),
      }
    case 'bigbubble': // 宝宝专属：吹一个超大泡泡，然后"啵"地破掉
      return {
        front: `<circle cx="6.5" cy="${g.eyeTop + 3.4}" r="1.7" fill="#bfe3ff" opacity=".7" stroke="#9fd3ff" stroke-width="0.15" class="fill-box" style="animation:bubble 2.2s ease-in-out infinite"/>`,
      }
    case 'dance': // 成长期专属：一跳一跳，钳子轮流举高，音符飘
      return {
        move: ['hop', 0.4],
        clawL: 'clawhigh .4s ease-in-out infinite',
        clawR: 'clawhigh .4s ease-in-out infinite .2s',
        fx:
          `<text x="11" y="-0.5" font-size="2.4" fill="#e8a0ff" style="animation:rise 1.2s infinite">♪</text>` +
          `<text x="-0.5" y="0" font-size="2.2" fill="#9fd3ff" style="animation:rise 1.2s infinite .6s">♫</text>`,
      }
    case 'tea': // 绅士期专属：右手端一杯冒热气的红茶
      return {
        move: ['bob', 3],
        eyes: 'shut',
        front:
          px(10.7, 2.6, 1.8, 1.4, '#f4f4f4') +
          px(10.9, 2.8, 1.4, 0.4, '#a0522d') + // 茶
          px(12.5, 2.9, 0.4, 0.7, '#f4f4f4') + // 杯柄
          px(10.4, 4, 2.4, 0.3, '#ddd'), // 茶托
        fx: [0, 1].map(i => px(11.2 + i * 0.7, 1.6, 0.25, 0.9, '#bbb', `animation:rise 1.6s infinite ${i * 0.8}s`)).join(''),
      }
    case 'twirl': // 闪耀期专属：飘得更高，星星炸开
      return {
        move: ['float', 0.8],
        fx: [
          [0, -2],
          [12, -2],
          [-0.5, 6],
          [12.5, 6],
          [6, -3.5],
        ]
          .map(([x, y], i) => `<text x="${x}" y="${y}" font-size="2" fill="#ffd27a" class="fill-box" style="animation:burst .7s ease-out infinite ${i * 0.14}s">✦</text>`)
          .join(''),
      }
    default:
      return {}
  }
}

/**
 * tempoMul = 动画时长倍数（设置里的速度 × 专注模式放慢）
 * skit     = 正在演的发呆小剧场（只在发呆时生效）
 */
export function clawdSvg(mood: Mood, form: Form, isThin: boolean, tool = '', outfit?: Outfit, tempoMul = 1, skit = ''): string {
  const isBaby = form === 'baby'
  const sprite = isBaby ? SPRITE_BABY : SPRITE_ADULT
  const eyeRows = sprite.map((row, y) => (row.includes('E') ? y : -1)).filter(y => y >= 0)
  const eyeTop = eyeRows[0] ?? 0
  const lastEyeRow = eyeRows[eyeRows.length - 1] ?? 0
  const geom: Geom = isBaby
    ? { headTop: 3, eyeTop, left: 3, right: 9 }
    : { headTop: 0, eyeTop, left: 2, right: 10 }
  const tempo = TEMPO[form] * tempoMul

  const kind: ToolKind | null = mood === 'working' ? toolKind(tool) : null
  // 小剧场只在发呆时演
  const sk: SkitLook = mood === 'idle' && skit ? skitLook(skit, { headTop: isBaby ? 3 : 0, eyeTop, left: isBaby ? 3 : 2, right: isBaby ? 9 : 10 }) : {}

  // 眼睛：睁开 = 两格高；闭上 = 只剩下面一条线
  const eyesShut = sk.eyes === 'shut' || mood === 'sleepy' || mood === 'love' || mood === 'hungry' || mood === 'oops'
  const eyes = eyesShut
    ? rects(sprite, 'E', ORANGE, { onlyRows: eyeRows.filter(y => y !== lastEyeRow) }) + rects(sprite, 'E', EYE, { onlyRows: [lastEyeRow] })
    : rects(sprite, 'E', EYE)

  const move = anim(kind ? KIND_MOVE[kind] : (sk.move ?? bodyMove(mood, form)), tempo)

  // 只有"其他工具"、"列计划"、散步时小脚会跑；敲键盘、读书时坐着不动
  const walking = kind === 'other' || kind === 'plan' || sk.walking === true
  const step = (delay: number) => (walking ? `step ${(0.35 * tempo).toFixed(2)}s infinite ${(delay * tempo).toFixed(2)}s` : 'none')
  const legA = `<g style="animation:${step(0)}">${rects(sprite, 'A', ORANGE)}</g>`
  const legB = `<g style="animation:${step(0.175)}">${rects(sprite, 'B', ORANGE)}</g>`
  const clawL = `<g style="animation:${sk.clawL ?? clawMove(mood, form, 'L')}">${rects(sprite, 'L', ORANGE)}</g>`
  const clawR = `<g style="animation:${sk.clawR ?? clawMove(mood, form, 'R')}">${rects(sprite, 'R', ORANGE)}</g>`

  // 读书、东张西望时眼睛左右扫；其他时候睁眼会眨眼
  const eyeGroup = eyesShut
    ? `<g>${eyes}</g>`
    : sk.eyes === 'look'
      ? `<g style="animation:look 2s steps(1) infinite">${eyes}</g>`
      : kind === 'read'
      ? `<g style="animation:scan 1.2s ease-in-out infinite">${eyes}</g>`
      : `<g class="fill-box" style="animation:blink 4s infinite">${eyes}</g>`

  // 装扮：读书时戴着读书眼镜，就不戴脸部装扮；绅士开心时抬帽致意
  let wear = ''
  if (outfit) {
    const hatTip = form === 'gent' && mood === 'happy' ? 'animation:hatlift 1.6s ease-in-out infinite' : ''
    wear =
      itemSvg(outfit.neck, geom) +
      (kind === 'read' ? '' : itemSvg(outfit.face, geom)) +
      `<g style="${hatTip}">${itemSvg(outfit.head, geom)}</g>`
  }

  const prop = kind ? propSvg(kind, eyeTop) : { front: '', ground: '', fx: '' }
  // 演小剧场时，平常的发呆特效（泡泡、哼小曲）先停；闪耀期的星星环绕保留
  const baseFlair = formFlair(mood, form, geom)
  const isSkit = mood === 'idle' && skit !== ''
  const flair = isSkit ? { back: baseFlair.back, over: form === 'shiny' ? baseFlair.over : '' } : baseFlair

  // 头顶特效
  let fx = prop.fx
  if (sk.fx) {
    fx = sk.fx
  } else if (mood === 'thinking') {
    fx = [0, 1, 2].map(i => px(9.5 + i * 1.3, -3, 0.8, 0.8, ORANGE, `animation:fade 1.2s infinite ${i * 0.3}s`)).join('')
  } else if (mood === 'sleepy') {
    fx =
      `<text x="11" y="-1" font-size="3" font-family="monospace" fill="#888" style="animation:rise 3s infinite">z</text>` +
      `<text x="12.5" y="-1.5" font-size="2.2" font-family="monospace" fill="#888" style="animation:rise 3s infinite 1.5s">z</text>`
  } else if (mood === 'love') {
    fx =
      `<text x="10.5" y="0" font-size="3" fill="#e8708f" style="animation:rise 1.6s infinite">♥</text>` +
      `<text x="-0.5" y="0" font-size="2.4" fill="#e8708f" style="animation:rise 1.6s infinite .8s">♥</text>`
  } else if (mood === 'sad') {
    fx = px(4.25, lastEyeRow + 1, 0.5, 1, '#6fa8dc', 'animation:drop 1.2s infinite')
  } else if (mood === 'happy' && form !== 'shiny') {
    fx = `<text x="11" y="-0.5" font-size="2.6" fill="${ORANGE}" style="animation:fade .8s infinite">✦</text>`
  } else if (mood === 'hungry') {
    fx = `<text x="10.5" y="0" font-size="2.6" font-family="monospace" fill="#888" style="animation:fade 1.5s infinite">…</text>`
  } else if (mood === 'oops') {
    // 💥 出错：头顶冒黑烟 + 红色 ✗
    fx =
      [0, 1, 2]
        .map(i => `<circle cx="${3.5 + i * 2.5}" cy="-0.6" r="0.8" fill="#8a8a8a" style="animation:rise 1.4s infinite ${i * 0.35}s"/>`)
        .join('') + `<text x="11" y="0" font-size="3" font-weight="bold" fill="#e5534b">✗</text>`
  } else if (mood === 'waiting') {
    // 🪧 举牌子：头顶一块白牌子，"!" 和 "?" 轮流出现，牌子左右晃
    fx =
      `<g style="transform-origin:6.5px -0.5px;animation:wiggle .6s ease-in-out infinite">` +
      px(6.2, -2, 0.6, (isBaby ? 3 : 0) + 2, '#8b5a2b') + // 木棍：一直伸到头顶（宝宝个子矮，棍子就长一点）
      `<rect x="3.6" y="-4" width="5.8" height="2.4" rx="0.3" fill="#fffdf5" stroke="${ORANGE}" stroke-width="0.25"/>` +
      `<text x="5.15" y="-2.05" font-size="2.2" font-weight="bold" fill="#e5534b" style="animation:flipA 1.2s steps(1) infinite">!</text>` +
      `<text x="6.95" y="-2.05" font-size="2.2" font-weight="bold" fill="#4a90e2" style="animation:flipB 1.2s steps(1) infinite">?</text>` +
      `</g>`
  }

  const thin = isThin ? 'transform:scaleX(.82);' : '' // 饿瘦了：身体横向缩窄
  // 闪耀期全身发金光；睡觉时光变暗
  const glow = form === 'shiny' && mood !== 'sleepy' ? 'animation:glow 2s ease-in-out infinite;' : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -4 15 13">` +
    `<style>${CSS}</style>` +
    flair.back +
    fx +
    `<g style="${glow}">` +
    `<g style="transform-origin:6.5px 8px;animation:${move}">` +
    `<g class="fill-box" style="${thin}">` +
    rects(sprite, 'X', ORANGE) +
    clawL +
    clawR +
    eyeGroup +
    legA +
    legB +
    `</g>` +
    wear +
    prop.front +
    (sk.front ?? '') +
    `</g>` +
    prop.ground +
    `</g>` +
    flair.over +
    `</svg>`
  )
}
