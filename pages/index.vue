<script setup lang="ts">
// 落地页（首页）：生成式视觉 Hero + 落地内容。
//
// 设计要点：
// - Hero 采用「流场粒子」生成式动画（基于 Perlin 噪声的向量场 + 粒子平流），
//   纯 Canvas 2D 实现，无第三方依赖，SSR 安全（动画仅在 onMounted 客户端启动）。
//   主题感知：亮/暗模式切换粒子调色板与拖尾透明度。
// - 全程使用项目设计 token（玻璃拟态 / Indigo-Violet），与 Header/Sider/admin 一致。
// - 尊重 prefers-reduced-motion：降低帧率/速度，保证舒适与可访问性。
// - 统计数字复用 store 的种子数据（SSR 首屏即有值），onMounted 再异步刷新。
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useTheme } from '~/composables/useTheme'
import { useContentStore } from '~/stores/contentStore'
import { useMenuStore } from '~/stores/menuStore'
import {
  ArrowRightOutlined,
  AppstoreOutlined,
  PictureOutlined,
  MessageOutlined,
  StarOutlined,
  FireOutlined,
  SearchOutlined,
  TagsOutlined,
} from '@ant-design/icons-vue'

definePageMeta({ title: '首页' })

const { themeMode } = useTheme()
const contentStore = useContentStore()
const menuStore = useMenuStore()
const isDark = computed(() => themeMode.value === 'dark')

// ─────────────────────────── 统计（SSR 种子 + 异步刷新） ───────────────────────────
const postCount = ref(0)
const topicCount = ref(0)
const tagCount = ref(0)
const appCount = ref(contentStore.contentItems.length)

async function loadStats() {
  try {
    const [posts, topics, tags, content] = await Promise.all([
      $fetch<any[]>('/api/posts'),
      $fetch<any[]>('/api/topics'),
      $fetch<any[]>('/api/tags'),
      $fetch<any[]>('/api/content'),
    ])
    postCount.value = Array.isArray(posts) ? posts.length : postCount.value
    topicCount.value = Array.isArray(topics) ? topics.length : topicCount.value
    tagCount.value = Array.isArray(tags) ? tags.length : tagCount.value
    appCount.value = Array.isArray(content) ? content.length : appCount.value
  } catch {
    // 降级：保留 store 种子值
  }
}

// 数字滚动（SSR 安全：服务端直接取目标值，仅客户端用 rAF 缓动）
function useCountUp(source: () => number) {
  const display = ref(source())
  let raf = 0
  if (import.meta.client) {
    watch(source, (to, prev = 0) => {
      const from = prev || 0
      cancelAnimationFrame(raf)
      const start = performance.now()
      const dur = 800
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / dur)
        const eased = 1 - Math.pow(1 - t, 3)
        display.value = Math.round(from + (to - from) * eased)
        if (t < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    })
  }
  return display
}
const pCount = useCountUp(() => postCount.value)
const topCount = useCountUp(() => topicCount.value)
const tCount = useCountUp(() => tagCount.value)
const aCount = useCountUp(() => appCount.value)

// 分类预览（取前 8 个）
const previewCategories = computed(() => menuStore.menuItems.slice(0, 8))

// 特性卡片数据（icon 为已导入的组件引用，模板用 <component :is="..."/> 渲染）
const features = [
  { title: '笔记瀑布流', desc: '小红书风格瀑布流,图片 / 视频 / 标签随心混排,记录生活的每一束光。', icon: PictureOutlined, grad: 'linear-gradient(135deg,#ff9a5c,#f2633c)' },
  { title: '实时私信 · 群聊', desc: 'WuKongIM 双引擎即时通讯,文本 / 图片 / GIF 秒达,离线消息不丢失。', icon: MessageOutlined, grad: 'linear-gradient(135deg,#f2633c,#e8437a)' },
  { title: '收藏与关注', desc: '多收藏夹整理灵感,关注动态一屏尽览,与同频的人保持连接。', icon: StarOutlined, grad: 'linear-gradient(135deg,#ffc53d,#f59e0b)' },
  { title: '精选应用', desc: '精挑细选的应用推荐与评分系统,为创作与效率找到下一款利器。', icon: AppstoreOutlined, grad: 'linear-gradient(135deg,#10b981,#0d9488)' },
]

// ─────────────────────────── 生成式流场动画 ───────────────────────────
const canvasRef = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let rafId = 0
let resizeObserver: ResizeObserver | null = null
let particles: P[] = []
let zoff = 0
let W = 0, H = 0, dpr = 1
const reduced = ref(false)

// ── 经典 Perlin 噪声（2D + 时间第 3 维）── Ken Perlin 改进版参考实现。
const perm = new Uint8Array(512)
function seedPerlin(seed: number) {
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  // 线性同余生成器，用 seed 复现
  let s = seed >>> 0 || 1
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const t = p[i]; p[i] = p[j]; p[j] = t
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a: number, b: number, t: number) => a + t * (b - a)
const grad = (h: number, x: number, y: number) => {
  const g = h & 7
  const u = g < 4 ? x : y
  const v = g < 4 ? y : x
  return ((g & 1) ? -u : u) + ((g & 2) ? -2 * v : 2 * v)
}
function perlin(x: number, y: number, z: number) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z)
  const u = fade(x), v = fade(y), w = fade(z)
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z
  const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z
  return lerp(
    lerp(
      lerp(grad(perm[AA], x, y), grad(perm[BA], x - 1, y), u),
      lerp(grad(perm[AB], x, y - 1), grad(perm[BB], x - 1, y - 1), u), v),
    lerp(
      lerp(grad(perm[AA + 1], x, y), grad(perm[BA + 1], x - 1, y), u),
      lerp(grad(perm[AB + 1], x, y - 1), grad(perm[BB + 1], x - 1, y - 1), u), v),
    w)
}

// ── 调色板（按主题）──
function palette() {
  // 返回 [strokeColor, trailFade] —— 拖尾覆盖色 + 粒子描边基准
  if (isDark.value) {
    return {
      fade: 'rgba(15, 15, 22, 0.10)',     // 拖尾衰减：半透明深色覆盖
      hues: ['#ffb25e', '#ff8a5c', '#f2633c', '#e8437a', '#ffd166'], // 霞光发光粒子
      glow: true,
    }
  }
  return {
    fade: 'rgba(255, 255, 255, 0.095)',
    hues: ['#ff8a5c', '#e8502a', '#e8437a', '#f59e0b', '#ffb25e'],
    glow: false,
  }
}

class P {
  x = 0; y = 0; px = 0; py = 0
  life = 0; maxLife = 0
  hue = ''
  constructor(w: number, h: number) { this.reset(w, h, true) }
  reset(w: number, h: number, init = false) {
    this.x = Math.random() * w
    this.y = Math.random() * h
    this.px = this.x; this.py = this.y
    this.life = init ? Math.random() * 200 : 0
    this.maxLife = 120 + Math.random() * 220
    const pal = palette()
    this.hue = pal.hues[(Math.random() * pal.hues.length) | 0]
  }
}

function initParticles() {
  if (!W || !H) return
  // 按面积密度分配粒子数，封顶以保证性能
  const target = Math.min(900, Math.round((W * H) / 1800))
  particles = []
  for (let i = 0; i < target; i++) particles.push(new P(W, H))
}

function resize() {
  const cv = canvasRef.value
  if (!cv) return
  const parent = cv.parentElement
  if (!parent) return
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  W = parent.clientWidth
  H = parent.clientHeight
  cv.width = Math.max(1, Math.floor(W * dpr))
  cv.height = Math.max(1, Math.floor(H * dpr))
  cv.style.width = W + 'px'
  cv.style.height = H + 'px'
  ctx = cv.getContext('2d')
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }
  initParticles()
}

function draw() {
  if (!ctx) return
  const pal = palette()
  // 拖尾衰减：每帧覆盖一层半透明色，产生流动残影
  ctx.fillStyle = pal.fade
  ctx.fillRect(0, 0, W, H)

  const scale = 0.0016   // 噪声采样尺度（越小越柔和）
  const zstep = reduced.value ? 0.0004 : 0.0016
  const speed = reduced.value ? 0.5 : 1.4
  zoff += zstep

  if (pal.glow) {
    ctx.globalCompositeOperation = 'lighter' // 暗色模式：叠加发光
  } else {
    ctx.globalCompositeOperation = 'source-over'
  }

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    // 流场角度由 Perlin 噪声驱动
    const angle = perlin(p.x * scale, p.y * scale, zoff) * Math.PI * 4
    p.px = p.x; p.py = p.y
    p.x += Math.cos(angle) * speed
    p.y += Math.sin(angle) * speed
    p.life++

    if (p.life > p.maxLife || p.x < 0 || p.x > W || p.y < 0 || p.y > H) {
      p.reset(W, H)
      continue
    }
    // 描边：透明度随生命周期淡入淡出，颜色取自调色板
    const lr = p.life / p.maxLife
    const alpha = Math.sin(lr * Math.PI) * (pal.glow ? 0.55 : 0.5)
    ctx.strokeStyle = hexA(p.hue, alpha)
    ctx.lineWidth = pal.glow ? 1.2 : 1
    ctx.beginPath()
    ctx.moveTo(p.px, p.py)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'

  rafId = requestAnimationFrame(draw)
}

// hex(#rrggbb) + alpha → rgba()
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return `rgba(${r},${g},${b},${a})`
}

let started = false
function start() {
  if (started) return
  started = true
  reduced.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  seedPerlin(20260809)
  resize()
  rafId = requestAnimationFrame(draw)
}
function stop() {
  started = false
  cancelAnimationFrame(rafId)
}

// 主题切换时重置调色板相关状态（粒子颜色在 reset 时重新采样）
watch(isDark, () => {
  // 让现有粒子逐步换色：重置一部分粒子
  for (let i = 0; i < particles.length; i++) {
    if (Math.random() < 0.5) particles[i].reset(W, H)
  }
})

onMounted(async () => {
  await nextTick()
  start()
  if (typeof ResizeObserver !== 'undefined' && canvasRef.value) {
    resizeObserver = new ResizeObserver(() => resize())
    resizeObserver.observe(canvasRef.value.parentElement as Element)
  }
  window.addEventListener('resize', resize)
  await loadStats()
})
onBeforeUnmount(() => {
  stop()
  resizeObserver?.disconnect()
  revealObserver?.disconnect()
  if (typeof window !== 'undefined') window.removeEventListener('resize', resize)
})

// 滚动揭示
const revealRef = ref<HTMLElement | null>(null)
let revealObserver: IntersectionObserver | null = null
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || !revealRef.value) return
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) (e.target as HTMLElement).classList.add('revealed') })
  }, { threshold: 0.15 })
  document.querySelectorAll<HTMLElement>('.reveal').forEach((el) => revealObserver!.observe(el))
})
</script>

<template>
  <div class="home-page" :class="{ dark: isDark }">
    <!-- ============ 生成式 Hero ============ -->
    <section class="hero">
      <canvas ref="canvasRef" class="hero-canvas" aria-hidden="true" />
      <!-- 文案可读性遮罩 -->
      <div class="hero-scrim" />
      <div class="hero-content">
        <span class="badge enter-up" style="--d:0s">
          <img src="/logo.svg" alt="" class="badge-logo" />
          拾光 · 记录此刻,遇见同好
        </span>
        <h1 class="hero-title enter-up" style="--d:0.08s">
          拾起时光<br />
          <span class="grad-text">遇见同好</span>
        </h1>
        <p class="hero-sub enter-up" style="--d:0.16s">
          一个温暖的生活方式社区 —— 记录生活碎片、分享笔记灵感,<br />
          与同频的人实时畅聊。
        </p>
        <div class="hero-cta enter-up" style="--d:0.24s">
          <nuxt-link to="/community" class="btn-cta btn-cta-primary">
            <PictureOutlined /> 进入社区 <ArrowRightOutlined />
          </nuxt-link>
          <nuxt-link to="/application" class="btn-cta btn-cta-ghost">
            <AppstoreOutlined /> 浏览应用推荐
          </nuxt-link>
        </div>
      </div>
      <div class="hero-scroll-hint" aria-hidden="true">
        <span class="mouse"><span class="wheel" /></span>
      </div>
    </section>

    <!-- ============ 统计带 ============ -->
    <section class="stats-band reveal">
      <div class="stat-item">
        <span class="stat-value">{{ pCount }}</span>
        <span class="stat-name"><PictureOutlined /> 社区笔记</span>
      </div>
      <span class="stat-divider" />
      <div class="stat-item">
        <span class="stat-value">{{ topCount }}</span>
        <span class="stat-name"><FireOutlined /> 热门话题</span>
      </div>
      <span class="stat-divider" />
      <div class="stat-item">
        <span class="stat-value">{{ tCount }}</span>
        <span class="stat-name"><TagsOutlined /> 兴趣标签</span>
      </div>
      <span class="stat-divider" />
      <div class="stat-item">
        <span class="stat-value">{{ aCount }}</span>
        <span class="stat-name"><AppstoreOutlined /> 精选应用</span>
      </div>
    </section>

    <!-- ============ 特性 ============ -->
    <section class="section features-section">
      <header class="section-head reveal">
        <span class="kicker">为什么是拾光</span>
        <h2 class="section-title">为记录与连接而生</h2>
        <p class="section-desc">拾起生活的光,遇见同频的人 —— 每一处细节都为社区体验设计。</p>
      </header>
      <div class="feature-grid">
        <article
          v-for="(f, i) in features"
          :key="f.title"
          class="feature-card surface reveal"
          :style="{ '--d': i * 0.08 + 's' }"
        >
          <span class="feature-ic" :style="{ background: f.grad }">
            <component :is="f.icon" />
          </span>
          <h3 class="feature-title">{{ f.title }}</h3>
          <p class="feature-desc">{{ f.desc }}</p>
        </article>
      </div>
    </section>

    <!-- ============ 分类预览 ============ -->
    <section class="section categories-section">
      <header class="section-head reveal">
        <span class="kicker">发现好应用</span>
        <h2 class="section-title">从你感兴趣的领域开始</h2>
        <p class="section-desc">涵盖 {{ previewCategories.length }}+ 个分组,点击直达应用推荐。</p>
      </header>
      <div class="cat-grid reveal">
        <nuxt-link
          v-for="c in previewCategories"
          :key="c.title"
          :to="'/application'"
          class="cat-card surface"
        >
          <span class="cat-dot" />
          <span class="cat-name-zh">{{ c.title_zh }}</span>
          <span class="cat-name-en">{{ c.title }}</span>
          <ArrowRightOutlined class="cat-arrow" />
        </nuxt-link>
      </div>
    </section>

    <!-- ============ 结尾 CTA ============ -->
    <section class="section cta-section">
      <div class="cta-card surface reveal">
        <div class="cta-text">
          <h2 class="cta-title">准备好拾起时光了吗？</h2>
          <p class="cta-desc">加入社区,发布你的第一篇笔记,与同好分享生活的每一刻。</p>
        </div>
        <nuxt-link to="/community" class="btn-cta btn-cta-primary">
          <SearchOutlined /> 开始记录 <ArrowRightOutlined />
        </nuxt-link>
      </div>
    </section>

    <span ref="revealRef" hidden />
  </div>
</template>


<style scoped lang="less">
.home-page { color: var(--text-primary); font-family: var(--font-sans); }

/* ─────────── 玻璃表面（复用全局 token） ─────────── */
.surface {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-highlight), var(--shadow-sm);
}

/* ============ Hero ============ */
.hero {
  position: relative;
  min-height: calc(100vh - 64px);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--radius-xl);
  margin-bottom: 28px;
  /* 自身渐变底，让粒子有承载、文案更清晰 */
  background:
    radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%),
    linear-gradient(180deg, rgba(15,23,42,0.25), rgba(15,23,42,0.55));
}
.hero-canvas {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  display: block;
}
.hero-scrim {
  position: absolute; inset: 0;
  background: radial-gradient(60% 50% at 50% 50%, transparent 30%, color-mix(in srgb, var(--bg-base) 45%, transparent) 100%);
  pointer-events: none;
}
.hero-content {
  position: relative; z-index: 2;
  text-align: center;
  padding: 40px 24px;
  max-width: 820px;
}

.badge {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 16px;
  font-size: var(--text-sm); font-weight: 600;
  color: var(--text-primary);
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-sm);
  margin-bottom: 26px;
  :deep(.anticon) { color: var(--accent); }
}
.hero-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(42px, 7vw, 78px);
  font-weight: 700;
  line-height: 1.08;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  text-shadow: 0 4px 30px rgba(0, 0, 0, 0.25);
}
.badge-logo {
  width: 20px; height: 20px;
  border-radius: 6px;
  display: inline-block;
  vertical-align: -4px;
}
.grad-text {
  background: linear-gradient(110deg, #ffc069 5%, #ff7a45 45%, #f0436f 90%);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}
.hero-sub {
  margin: 22px auto 0; max-width: 640px;
  font-size: clamp(15px, 1.6vw, 18px);
  line-height: var(--leading-snug);
  color: var(--text-secondary);
}
.hero-cta {
  margin-top: 34px;
  display: flex; gap: 14px; justify-content: center; flex-wrap: wrap;
}
.btn-cta {
  display: inline-flex; align-items: center; gap: 9px;
  padding: 0 26px; height: 50px;
  font-family: inherit; font-size: var(--text-md); font-weight: 600;
  text-decoration: none;
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
  :deep(.anticon) { font-size: 17px; }
}
.btn-cta-primary {
  color: #fff;
  background: var(--grad-brand);
  box-shadow: var(--shadow-accent);
  &:hover { transform: translateY(-2px); box-shadow: 0 12px 32px var(--accent-glow); }
}
.btn-cta-ghost {
  color: var(--text-primary);
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  border-color: var(--glass-border);
  &:hover { transform: translateY(-2px); border-color: var(--accent); color: var(--accent); }
}

/* 滚动提示 */
.hero-scroll-hint {
  position: absolute; bottom: 22px; left: 50%; transform: translateX(-50%);
  z-index: 2; opacity: 0.7;
}
.mouse {
  display: block; width: 24px; height: 40px;
  border: 2px solid var(--text-secondary); border-radius: 14px;
  position: relative;
}
.wheel {
  position: absolute; top: 7px; left: 50%; transform: translateX(-50%);
  width: 4px; height: 8px; border-radius: 2px;
  background: var(--text-secondary);
  animation: wheel 1.6s var(--ease-out) infinite;
}
@keyframes wheel { 0% { opacity: 0; transform: translate(-50%, 0); } 40% { opacity: 1; } 80% { opacity: 0; transform: translate(-50%, 12px); } 100% { opacity: 0; } }

/* ============ 统计带 ============ */
.stats-band {
  display: flex; align-items: center; justify-content: center;
  gap: clamp(20px, 4vw, 56px); flex-wrap: wrap;
  padding: 30px 24px;
  border-radius: var(--radius-xl);
  margin-bottom: 64px;
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-highlight), var(--shadow-md);
}
.stat-item { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 110px; }
.stat-value {
  font-family: var(--font-display);
  font-size: clamp(32px, 4.5vw, 46px);
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.stat-name {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--text-sm); color: var(--text-secondary);
  :deep(.anticon) { color: var(--accent); font-size: 13px; }
}
.stat-divider { width: 1px; height: 40px; background: var(--glass-border-inset); }

/* ============ 通用 Section ============ */
.section { max-width: 1120px; margin: 0 auto 72px; padding: 0 8px; }
.section-head { text-align: center; max-width: 640px; margin: 0 auto 40px; }
.kicker {
  display: inline-block;
  font-size: var(--text-xs); font-weight: 700;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--accent);
  padding: 4px 12px;
  background: var(--accent-soft);
  border-radius: var(--radius-full);
  margin-bottom: 14px;
}
.section-title {
  margin: 0;
  font-size: clamp(28px, 3.5vw, 40px);
  font-weight: 800; letter-spacing: -0.02em;
  color: var(--text-primary);
}
.section-desc { margin: 14px 0 0; color: var(--text-secondary); font-size: var(--text-md); }

/* ============ 特性卡片 ============ */
.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
}
.feature-card {
  padding: 28px 26px;
  border-radius: var(--radius-lg);
  transition: transform var(--dur) var(--ease-out), box-shadow var(--dur) var(--ease-out), border-color var(--dur) var(--ease-out);
  &:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
}
.feature-ic {
  display: grid; place-items: center;
  width: 52px; height: 52px; border-radius: var(--radius-md);
  font-size: 25px; color: #fff;
  box-shadow: var(--shadow-sm);
  margin-bottom: 18px;
}
.feature-title { margin: 0 0 8px; font-size: var(--text-lg); font-weight: 700; color: var(--text-primary); }
.feature-desc { margin: 0; font-size: var(--text-sm); line-height: var(--leading-snug); color: var(--text-secondary); }

/* ============ 分类预览 ============ */
.cat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}
.cat-card {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 18px;
  border-radius: var(--radius-md);
  text-decoration: none;
  color: var(--text-primary);
  position: relative;
  transition: transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  &:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--accent) 35%, transparent); box-shadow: var(--shadow-md); .cat-arrow { opacity: 1; transform: translateX(0); } }
}
.cat-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); flex-shrink: 0; }
.cat-name-zh { font-weight: 600; }
.cat-name-en { font-size: var(--text-xs); color: var(--text-muted); }
.cat-arrow { margin-left: auto; color: var(--accent); opacity: 0; transform: translateX(-6px); transition: all var(--dur-fast) var(--ease-out); }

/* ============ 结尾 CTA ============ */
.cta-section { margin-bottom: 32px; }
.cta-card {
  display: flex; align-items: center; justify-content: space-between;
  gap: 24px; flex-wrap: wrap;
  padding: 40px 44px;
  border-radius: var(--radius-xl);
  background: linear-gradient(135deg, var(--accent-soft), color-mix(in srgb, var(--accent) 8%, transparent)), var(--glass-bg);
  border-color: color-mix(in srgb, var(--accent) 22%, transparent);
  box-shadow: var(--shadow-md);
}
.cta-title { margin: 0; font-size: clamp(24px, 3vw, 34px); font-weight: 800; color: var(--text-primary); letter-spacing: -0.02em; }
.cta-desc { margin: 8px 0 0; color: var(--text-secondary); font-size: var(--text-md); }

/* ============ 滚动揭示 ============ */
.reveal { opacity: 0; transform: translateY(28px); transition: opacity 0.7s var(--ease-out), transform 0.7s var(--ease-out); transition-delay: var(--d, 0s); }
.reveal.revealed { opacity: 1; transform: none; }

/* ============ 响应式 ============ */
@media (max-width: 640px) {
  .stats-band { gap: 24px; }
  .stat-divider { display: none; }
  .cta-card { flex-direction: column; align-items: flex-start; padding: 28px; }
}

/* 尊重减少动态效果 */
@media (prefers-reduced-motion: reduce) {
  .wheel { animation: none; }
  .reveal { transition: opacity 0.4s; transform: none; }
}
</style>
