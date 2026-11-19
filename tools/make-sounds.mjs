// 用数学"合成"Clawd 的提示音（原创，不用任何现成音频）
// 运行：node tools/make-sounds.mjs   → 生成 sounds/achievement.wav 和 sounds/done.wav
//
// 原理（打个比方）：声音就是空气一前一后地振动。
// 我们每秒算 44100 个"振动位置"，把它们写进 .wav 文件，播放器就能放出来。

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const RATE = 44100
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function makeBuffer(seconds) {
  return new Float32Array(Math.ceil(seconds * RATE))
}

/** 铃铛声：一个基音 + 几个"不整齐"的泛音（铃铛特有的金属感），然后慢慢衰减 */
function bell(buf, startSec, freq, { gain = 0.5, decay = 1.2, partials = [[1, 1], [2.0, 0.35], [2.76, 0.25], [5.4, 0.08]] } = {}) {
  const start = Math.floor(startSec * RATE)
  for (let i = 0; start + i < buf.length; i++) {
    const t = i / RATE
    const attack = Math.min(1, t / 0.004) // 4 毫秒快速起音，避免"啪"的杂音
    let s = 0
    for (const [ratio, amp] of partials) {
      // 高的泛音衰减得更快，听起来更像真铃铛
      s += amp * Math.sin(2 * Math.PI * freq * ratio * t) * Math.exp(-t * (decay * (1 + ratio * 0.6)))
    }
    buf[start + i] += gain * attack * s
  }
}

/** "嗖"的一声：一段由低到高扫过去的噪音 */
function whoosh(buf, startSec, durSec, gain = 0.25) {
  const start = Math.floor(startSec * RATE)
  const n = Math.floor(durSec * RATE)
  let low = 0
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const p = i / n
    const cutoff = 0.02 + p * 0.35 // 滤波器慢慢打开 → 声音由闷变亮
    low += cutoff * (Math.random() * 2 - 1 - low)
    const env = Math.sin(Math.PI * p) ** 2 // 先变大再变小
    buf[start + i] += gain * env * low
  }
}

/** 闪烁的小星星声：很轻、很高的短促音 */
function sparkle(buf, startSec, freq, gain = 0.08) {
  bell(buf, startSec, freq, { gain, decay: 6, partials: [[1, 1], [2, 0.3]] })
}

function normalize(buf, peak = 0.7) {
  let max = 0
  for (const v of buf) max = Math.max(max, Math.abs(v))
  const k = max > 0 ? peak / max : 1
  for (let i = 0; i < buf.length; i++) buf[i] *= k
  // 结尾 50 毫秒淡出，避免"咔"一声
  const fade = Math.floor(0.05 * RATE)
  for (let i = 0; i < fade; i++) buf[buf.length - 1 - i] *= i / fade
}

function writeWav(file, buf) {
  const data = Buffer.alloc(buf.length * 2)
  for (let i = 0; i < buf.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), i * 2)
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVE', 8)
  head.write('fmt ', 12)
  head.writeUInt32LE(16, 16) // fmt 块大小
  head.writeUInt16LE(1, 20) // PCM
  head.writeUInt16LE(1, 22) // 单声道
  head.writeUInt32LE(RATE, 24)
  head.writeUInt32LE(RATE * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.concat([head, data]))
}

// Windows 自带的播放器不能调音量，所以每个声音直接做三个音量版本的文件
const LEVELS = { low: 0.35, mid: 0.7, high: 1.0 }
function writeLevels(name, buf) {
  for (const [level, k] of Object.entries(LEVELS)) {
    writeWav(path.join(root, 'sounds', `${name}-${level}.wav`), buf.map(v => v * k))
  }
}

// ---------- 🏆 成就音：嗖～ 叮——叮！✨ ----------
{
  const buf = makeBuffer(2.2)
  whoosh(buf, 0, 0.32)
  bell(buf, 0.22, 987.77, { gain: 0.45, decay: 1.6 }) // B5
  bell(buf, 0.36, 1479.98, { gain: 0.55, decay: 1.1 }) // F#6，往上跳一个五度，"达成了！"的感觉
  bell(buf, 0.36, 739.99, { gain: 0.18, decay: 1.4 }) // 低八度垫底，让声音更厚
  ;[2349.32, 2959.96, 3520.0, 2793.83].forEach((f, i) => sparkle(buf, 0.45 + i * 0.07, f))
  normalize(buf)
  writeLevels('achievement', buf)
}

// ---------- ✅ 完成音：嘟-嘟-叮（三个音往上走，短一点、轻一点） ----------
{
  const buf = makeBuffer(1.3)
  bell(buf, 0.0, 1046.5, { gain: 0.35, decay: 4 }) // C6
  bell(buf, 0.09, 1318.51, { gain: 0.35, decay: 4 }) // E6
  bell(buf, 0.18, 1567.98, { gain: 0.5, decay: 1.8 }) // G6
  sparkle(buf, 0.26, 3135.96)
  normalize(buf, 0.55)
  writeLevels('done', buf)
}

// ---------- 💰 金币音：叮-铃！（两个很高的音快速往上跳，像捡到金币） ----------
{
  const buf = makeBuffer(0.7)
  const coinTone = [[1, 1], [2, 0.25], [3, 0.1]]
  bell(buf, 0.0, 1975.53, { gain: 0.4, decay: 9, partials: coinTone }) // B6，很短
  bell(buf, 0.07, 2637.02, { gain: 0.55, decay: 3.5, partials: coinTone }) // E7，留一点余音
  normalize(buf, 0.5)
  writeLevels('coin', buf)
}

console.log('已生成 sounds/ 下 achievement、done、coin 各三档音量（low / mid / high）')
