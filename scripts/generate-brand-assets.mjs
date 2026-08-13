// scripts/generate-brand-assets.mjs
//
// 生成「拾光」品牌资源：
//   public/logo.svg       — 矢量 Logo（霞光渐变圆角方块 + 初升的太阳）
//   public/favicon.ico    — 多尺寸 PNG-in-ICO 站点图标
//   public/logo.ico       — 多尺寸 PNG-in-ICO Logo
//   public/background.webp— 全站背景（由原始 background.png 转码而来，毛玻璃底）
//   public/logo.png       — PNG 预览版 Logo
//
// 运行：node scripts/generate-brand-assets.mjs
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'


const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')

// ── 固定种子 PRNG（可复现） ──────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── 画布辅助 ─────────────────────────────────────────────────────────────
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ════════════════════════════════════════════════════════════════════════
// 1. Logo 绘制（画布版，与 logo.svg 视觉一致）
//    概念：霞光渐变圆角方块 + 初升的太阳 + 三束光 + 地平线 + 星光
// ════════════════════════════════════════════════════════════════════════
function drawLogo(size) {
  const c = createCanvas(size, size)
  const ctx = c.getContext('2d')
  const s = size / 512

  // 圆角方块底
  const grad = ctx.createLinearGradient(0, 0, 512 * s, 512 * s)
  grad.addColorStop(0, '#ffb25e')
  grad.addColorStop(0.48, '#f2633c')
  grad.addColorStop(1, '#e8437a')
  roundedRect(ctx, 16 * s, 16 * s, 480 * s, 480 * s, 136 * s)
  ctx.fillStyle = grad
  ctx.fill()

  // 左上高光
  const hi = ctx.createRadialGradient(150 * s, 110 * s, 10 * s, 150 * s, 110 * s, 260 * s)
  hi.addColorStop(0, 'rgba(255,255,255,0.34)')
  hi.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hi
  ctx.fillRect(0, 0, size, size)

  const cream = '#fff7ea'
  // 地平线
  ctx.fillStyle = 'rgba(255,247,234,0.9)'
  roundedRect(ctx, 88 * s, 320 * s, 336 * s, 10 * s, 5 * s)
  ctx.fill()

  // 太阳（半升起：圆 + 底部被地平线遮住的部分不再单独处理，直接画整圆再叠地平线色条）
  ctx.fillStyle = cream
  ctx.beginPath()
  ctx.arc(256 * s, 276 * s, 84 * s, 0, Math.PI * 2)
  ctx.fill()

  // 地平线在太阳前 → 重画一条稍高、与背景同色的遮挡带，营造“半日初升”
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 320 * s, size, 192 * s)
  ctx.clip()
  ctx.fillStyle = grad
  roundedRect(ctx, 16 * s, 16 * s, 480 * s, 480 * s, 136 * s)
  ctx.fill()
  ctx.restore()
  ctx.fillStyle = 'rgba(255,247,234,0.9)'
  roundedRect(ctx, 88 * s, 320 * s, 336 * s, 10 * s, 5 * s)
  ctx.fill()

  // 三束光
  ctx.strokeStyle = cream
  ctx.lineCap = 'round'
  ctx.lineWidth = 22 * s
  const rays = [
    [256 * s, 96 * s, 256 * s, 168 * s],
    [166 * s, 110 * s, 186 * s, 172 * s],
    [346 * s, 110 * s, 326 * s, 172 * s],
  ]
  for (const [x1, y1, x2, y2] of rays) {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  // 星光（右上）
  ctx.fillStyle = cream
  const sx = 372 * s, sy = 140 * s, r = 30 * s
  ctx.beginPath()
  ctx.moveTo(sx, sy - r)
  ctx.quadraticCurveTo(sx + 7 * s, sy - 7 * s, sx + r, sy)
  ctx.quadraticCurveTo(sx + 7 * s, sy + 7 * s, sx, sy + r)
  ctx.quadraticCurveTo(sx - 7 * s, sy + 7 * s, sx - r, sy)
  ctx.quadraticCurveTo(sx - 7 * s, sy - 7 * s, sx, sy - r)
  ctx.fill()

  return c
}

// ════════════════════════════════════════════════════════════════════════
// 2. 背景图：暖色氛围网格（霞光 + 深色基底，与玻璃叠层协同）
// ════════════════════════════════════════════════════════════════════════
function drawBackground() {
  const W = 1920, H = 1080
  const c = createCanvas(W, H)
  const ctx = c.getContext('2d')
  const rnd = mulberry32(20260813)

  // 基底：深暖棕 → 暗玫瑰
  const base = ctx.createLinearGradient(0, 0, W, H)
  base.addColorStop(0, '#2b1510')
  base.addColorStop(0.55, '#1e0f14')
  base.addColorStop(1, '#160b18')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, W, H)

  // 光斑网格
  const blobs = [
    [0.30, 0.22, 0.42, 'rgba(224, 92, 44, 0.34)'],
    [0.72, 0.60, 0.38, 'rgba(196, 128, 40, 0.20)'],
    [0.52, 0.90, 0.45, 'rgba(180, 56, 96, 0.26)'],
    [0.88, 0.22, 0.34, 'rgba(96, 60, 140, 0.20)'],
    [0.12, 0.72, 0.30, 'rgba(232, 116, 66, 0.16)'],
    [0.62, 0.38, 0.26, 'rgba(255, 178, 94, 0.12)'],
  ]
  for (const [bx, by, br, color] of blobs) {
    const g = ctx.createRadialGradient(bx * W, by * H, 0, bx * W, by * H, br * W)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  // 细噪点（胶片颗粒感）
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * W, y = rnd() * H
    const a = 0.02 + rnd() * 0.05
    ctx.fillStyle = rnd() > 0.5 ? `rgba(255,220,200,${a})` : `rgba(0,0,0,${a})`
    ctx.fillRect(x, y, 1.4, 1.4)
  }

  // 暗角
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(0,0,0,0.42)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, W, H)

  return c
}

// ════════════════════════════════════════════════════════════════════════
// 3. ICO 写入（PNG-in-ICO：现代浏览器与 Windows 均支持）
// ════════════════════════════════════════════════════════════════════════
function writeIco(path, sizes) {
  const pngs = sizes.map((sz) => drawLogo(sz).toBuffer('image/png'))
  let offset = 6 + 16 * pngs.length
  const entries = pngs.map((png, i) => {
    const sz = sizes[i]
    const w = sz >= 256 ? 0 : sz
    const e = Buffer.alloc(16)
    e.writeUInt8(w, 0)               // width (0 = 256)
    e.writeUInt8(sz >= 256 ? 0 : sz, 1) // height
    e.writeUInt8(0, 2)               // palette
    e.writeUInt8(0, 3)               // reserved
    e.writeUInt16LE(1, 4)            // planes
    e.writeUInt16LE(32, 6)           // bpp
    e.writeUInt32LE(png.length, 8)   // bytes
    e.writeUInt32LE(offset, 12)      // offset
    offset += png.length
    return e
  })
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2) // type: icon
  head.writeUInt16LE(pngs.length, 4)
  writeFileSync(path, Buffer.concat([head, ...entries, ...pngs]))
}

// ════════════════════════════════════════════════════════════════════════
// 4. logo.svg（矢量版，与画布 Logo 一致）
// ════════════════════════════════════════════════════════════════════════
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffb25e"/>
      <stop offset="0.48" stop-color="#f2633c"/>
      <stop offset="1" stop-color="#e8437a"/>
    </linearGradient>
    <radialGradient id="hi" cx="0.3" cy="0.22" r="0.55">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="17" fill="url(#g)"/>
  <rect x="2" y="2" width="60" height="60" rx="17" fill="url(#hi)"/>
  <g stroke="#fff7ea" stroke-width="2.75" stroke-linecap="round">
    <line x1="32" y1="12" x2="32" y2="21"/>
    <line x1="20.75" y1="13.75" x2="23.25" y2="21.5"/>
    <line x1="43.25" y1="13.75" x2="40.75" y2="21.5"/>
  </g>
  <circle cx="32" cy="30.5" r="10.5" fill="#fff7ea"/>
  <path d="M32 34.5a10.5 10.5 0 0 1-9.9-7.15 12 12 0 0 1 19.8 0A10.5 10.5 0 0 1 32 34.5z" fill="#fff7ea" opacity="0.55"/>
  <rect x="11" y="40" width="42" height="1.25" rx="0.625" fill="#fff7ea" opacity="0.9"/>
  <path d="M46.5 17.5l2.6 5.2 5.2 2.6-5.2 2.6-2.6 5.2-2.6-5.2-5.2-2.6 5.2-2.6z" fill="#fff7ea"/>
</svg>
`

// ════════════════════════════════════════════════════════════════════════
// 5. 输出
// ════════════════════════════════════════════════════════════════════════
mkdirSync(PUBLIC, { recursive: true })

writeFileSync(join(PUBLIC, 'logo.svg'), LOGO_SVG)
writeIco(join(PUBLIC, 'favicon.ico'), [16, 32, 48, 256])
writeIco(join(PUBLIC, 'logo.ico'), [32, 48, 64, 256])

// 背景：优先转码原始 background.png（毛玻璃底图）；缺失时回退到生成的暖色网格。
const srcBg = join(PUBLIC, 'background.png')
if (existsSync(srcBg)) {
  try {
    const img = await loadImage(srcBg)
    const TARGET_W = 1920
    const scale = TARGET_W / img.width
    const out = createCanvas(TARGET_W, Math.round(img.height * scale))
    out.getContext('2d').drawImage(img, 0, 0, out.width, out.height)
    writeFileSync(join(PUBLIC, 'background.webp'), out.toBuffer('image/webp', 88))
    console.log(`✓ public/background.webp (${out.width}×${out.height}, 由 background.png 转码)`)
  } catch (e) {
    console.error('✗ background.png 转码失败:', e?.message || e)
    const bg = drawBackground()
    writeFileSync(join(PUBLIC, 'background.webp'), bg.toBuffer('image/webp', 88))
    console.log('✓ public/background.webp (回退：生成暖色网格)')
  }
} else {
  const bg = drawBackground()
  writeFileSync(join(PUBLIC, 'background.webp'), bg.toBuffer('image/webp', 88))
  console.log('✓ public/background.webp (生成暖色网格)')
}
