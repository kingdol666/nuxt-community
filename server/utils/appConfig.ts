// server/utils/appConfig.ts
//
// 配置引擎：config.yml 的唯一读写入口。
//
// 设计目标（配置优先 + 热重载驱动）：
//   1. 启动时 loadConfig() 把 config.yml 读入进程内存（单一事实源）。
//   2. 文件监听：保存 config.yml 即自动重新加载并即时生效（热重载）。
//   3. PUT /api/config 由管理员编辑 → saveConfig() 原子写回 yml → 触发热重载。
//   4. 变更通过 onConfigChange 订阅者广播：服务端运行参数即时切换，
//      并经 WebSocket 推送到所有在线客户端（UI/心跳等即时刷新）。
//   5. 鲁棒性：文件缺失 / 格式错误 / 字段越界一律回退默认值，永不崩溃。
//
// 键分级：
//   - 「启动键」server.host / *.devPort / *.prodPort / data.dataDir / data.authSecret
//     监听端口、数据目录、密钥等底层项无法对已运行进程热切换 —— 改动需重启。
//   - 其余均为「热键」，运行中即时生效。
import { readFileSync, writeFileSync, existsSync, renameSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

// ─── 配置类型（同时也是对外契约）──────────────────────────────────────────
export interface AppConfig {
  server: { host: string; devPort: number; prodPort: number }
  data: { dataDir: string; authSecret: string; cookieMaxAgeDays: number }
  limits: {
    posts: { pageSize: number; titleMax: number; contentMax: number; maxTags: number; tagMaxLen: number }
    uploads: { maxMedia: number; maxVideos: number; maxImageSizeMB: number; maxVideoSizeMB: number }
    comments: { textMax: number }
  }
  realtime: { heartbeatIntervalMs: number; reconnectDelayMs: number }
  features: { enableSignup: boolean; enableGuestBrowse: boolean }
  wukongim: { enabled: boolean; wsURL: string; apiURL: string; managerToken: string }
  branding: { siteTitle: string; brandName: string; brandLogo: string }
}

// ─── 内置默认值（文件缺失或字段非法时的兜底）──────────────────────────────
export const DEFAULT_CONFIG: AppConfig = {
  server: { host: '0.0.0.0', devPort: 3000, prodPort: 3000 },
  data: { dataDir: '', authSecret: 'nuxt-app-dev-secret-change-in-prod', cookieMaxAgeDays: 30 },
  limits: {
    posts: { pageSize: 20, titleMax: 100, contentMax: 5000, maxTags: 10, tagMaxLen: 20 },
    uploads: { maxMedia: 9, maxVideos: 4, maxImageSizeMB: 8, maxVideoSizeMB: 100 },
    comments: { textMax: 2000 },
  },
  features: { enableSignup: true, enableGuestBrowse: true },
  realtime: { heartbeatIntervalMs: 25000, reconnectDelayMs: 3000 },
  wukongim: { enabled: false, wsURL: 'ws://localhost:5200', apiURL: 'http://localhost:5001', managerToken: '' },
  branding: { siteTitle: '拾光 · 记录此刻,遇见同好', brandName: '拾光', brandLogo: '/logo.svg' },
}

// 「启动键」路径表 —— 这些键的变更需要重启进程，无法热切换（小而固定的查找表）。
export const STARTUP_KEYS: Record<string, true> = {
  'server.host': true,
  'server.devPort': true,
  'server.prodPort': true,
  'data.dataDir': true,
  'data.authSecret': true,
}

// ─── 配置文件路径 ─────────────────────────────────────────────────────────
export function configFile(): string {
  return process.env.NUXT_CONFIG_FILE || join(process.cwd(), 'config.yml')
}

// ─── 校验：把任意输入深合并到默认值之上，并做类型强转 + 合理性钳制 ──────────
// 这是鲁棒性的核心：无论用户写错什么，结果都是合法的 AppConfig。
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function asStr(v: unknown, d: string): string {
  return typeof v === 'string' ? v : d
}
function asInt(v: unknown, d: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  if (!Number.isFinite(n)) return d
  return Math.min(max, Math.max(min, Math.trunc(n)))
}
function asBool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d
}
// 递归深合并：patch 的叶子覆盖 base；仅对纯对象递归，数组/原始值整体替换。
// 用于 saveConfig —— 让管理员 PATCH 式局部更新而不误清未提供字段。
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObj(base) || !isObj(patch)) return patch
  const out: Record<string, unknown> = { ...base }
  for (const k of Object.keys(patch)) {
    out[k] = deepMerge(base[k], patch[k])
  }
  return out
}

export function validate(input: unknown): AppConfig {
  const root = isObj(input) ? input : {}
  const s = isObj(root.server) ? root.server : {}
  const d = isObj(root.data) ? root.data : {}
  const l = isObj(root.limits) ? root.limits : {}
  const lp = isObj(l.posts) ? l.posts : {}
  const lu = isObj(l.uploads) ? l.uploads : {}
  const lc = isObj(l.comments) ? l.comments : {}
  const r = isObj(root.realtime) ? root.realtime : {}
  const f = isObj(root.features) ? root.features : {}
  const b = isObj(root.branding) ? root.branding : {}
  const wk = isObj(root.wukongim) ? root.wukongim : {}

  return {
    server: {
      host: asStr(s.host, DEFAULT_CONFIG.server.host),
      devPort: asInt(s.devPort, DEFAULT_CONFIG.server.devPort, 1, 65535),
      prodPort: asInt(s.prodPort, DEFAULT_CONFIG.server.prodPort, 1, 65535),
    },
    data: {
      dataDir: asStr(d.dataDir, DEFAULT_CONFIG.data.dataDir),
      authSecret: asStr(d.authSecret, DEFAULT_CONFIG.data.authSecret),
      cookieMaxAgeDays: asInt(d.cookieMaxAgeDays, DEFAULT_CONFIG.data.cookieMaxAgeDays, 1, 3650),
    },
    limits: {
      posts: {
        pageSize: asInt(lp.pageSize, DEFAULT_CONFIG.limits.posts.pageSize, 1, 200),
        titleMax: asInt(lp.titleMax, DEFAULT_CONFIG.limits.posts.titleMax, 1, 10000),
        contentMax: asInt(lp.contentMax, DEFAULT_CONFIG.limits.posts.contentMax, 1, 1000000),
        maxTags: asInt(lp.maxTags, DEFAULT_CONFIG.limits.posts.maxTags, 0, 50),
        tagMaxLen: asInt(lp.tagMaxLen, DEFAULT_CONFIG.limits.posts.tagMaxLen, 1, 100),
      },
      uploads: {
        maxMedia: asInt(lu.maxMedia, DEFAULT_CONFIG.limits.uploads.maxMedia, 0, 100),
        maxVideos: asInt(lu.maxVideos, DEFAULT_CONFIG.limits.uploads.maxVideos, 0, 50),
        maxImageSizeMB: asInt(lu.maxImageSizeMB, DEFAULT_CONFIG.limits.uploads.maxImageSizeMB, 1, 1024),
        maxVideoSizeMB: asInt(lu.maxVideoSizeMB, DEFAULT_CONFIG.limits.uploads.maxVideoSizeMB, 1, 4096),
      },
      comments: {
        textMax: asInt(lc.textMax, DEFAULT_CONFIG.limits.comments.textMax, 1, 100000),
      },
    },
    realtime: {
      heartbeatIntervalMs: asInt(r.heartbeatIntervalMs, DEFAULT_CONFIG.realtime.heartbeatIntervalMs, 1000, 600000),
      reconnectDelayMs: asInt(r.reconnectDelayMs, DEFAULT_CONFIG.realtime.reconnectDelayMs, 500, 60000),
    },
    features: {
      enableSignup: asBool(f.enableSignup, DEFAULT_CONFIG.features.enableSignup),
      enableGuestBrowse: asBool(f.enableGuestBrowse, DEFAULT_CONFIG.features.enableGuestBrowse),
    },
    wukongim: {
      enabled: asBool(wk.enabled, DEFAULT_CONFIG.wukongim.enabled),
      wsURL: asStr(wk.wsURL, DEFAULT_CONFIG.wukongim.wsURL),
      apiURL: asStr(wk.apiURL, DEFAULT_CONFIG.wukongim.apiURL),
      managerToken: asStr(wk.managerToken, DEFAULT_CONFIG.wukongim.managerToken),
    },
    branding: {
      siteTitle: asStr(b.siteTitle, DEFAULT_CONFIG.branding.siteTitle),
      brandName: asStr(b.brandName, DEFAULT_CONFIG.branding.brandName),
      brandLogo: asStr(b.brandLogo, DEFAULT_CONFIG.branding.brandLogo),
    },
  }
}

// ─── 进程内存中的当前配置（模块级单例，跨请求持久）─────────────────────────
let current: AppConfig = DEFAULT_CONFIG

export function getConfig(): AppConfig {
  return current
}

export function publicConfig() {
  const c = current
  return {
    limits: c.limits,
    realtime: c.realtime,
    features: c.features,
    wukongim: { enabled: c.wukongim.enabled, wsURL: c.wukongim.wsURL },
    branding: c.branding,
    data: { cookieMaxAgeDays: c.data.cookieMaxAgeDays },
  }
}

// ─── 启动加载：把 config.yml 读入内存（供 Nitro 插件在 boot 时调用）─────────
export function loadConfig(): AppConfig {
  let raw = ''
  try {
    raw = readFileSync(configFile(), 'utf8')
  } catch {
    raw = '' // 文件不存在等：使用默认值
  }
  let parsed: unknown = {}
  if (raw.trim()) {
    try {
      parsed = parseYaml(raw)
    } catch {
      parsed = {} // YAML 语法错误：回退默认，不抛
    }
  }
  current = validate(parsed)
  return current
}

// ─── 变更订阅 ─────────────────────────────────────────────────────────────
export interface ConfigChange {
  current: AppConfig
  previous: AppConfig
  changedKeys: string[] // 点路径叶子键，如 "limits.posts.pageSize"
  startupKeysChanged: string[] // 其中属于「启动键」的（需重启才生效）
}
type Listener = (e: ConfigChange) => void
const listeners = new Set<Listener>()

export function onConfigChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// 深度 diff，收集所有发生变化的叶子键的点路径。
function diffKeys(prev: unknown, next: unknown, prefix = ''): string[] {
  const out: string[] = []
  if (!isObj(prev) || !isObj(next)) {
    if (prev !== next) out.push(prefix)
    return out
  }
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const k of keys) {
    const p = prefix ? `${prefix}.${k}` : k
    const pv = (prev as Record<string, unknown>)[k]
    const nv = (next as Record<string, unknown>)[k]
    if (isObj(pv) && isObj(nv)) out.push(...diffKeys(pv, nv, p))
    else if (pv !== nv) out.push(p)
  }
  return out
}

function emit(previous: AppConfig): void {
  const changedKeys = diffKeys(previous, current)
  if (!changedKeys.length) return
  const startupKeysChanged = changedKeys.filter((k) => k in STARTUP_KEYS)
  const evt: ConfigChange = { current, previous, changedKeys, startupKeysChanged }
  for (const fn of listeners) {
    try { fn(evt) } catch { /* 订阅者异常不影响配置流程 */ }
  }
}

// ─── 热重载（由文件监听器触发）────────────────────────────────────────────
export function reload(): AppConfig {
  const previous = current
  try {
    current = loadConfig()
  } catch {
    return current // 读取失败：保留旧配置，运行不受影响
  }
  emit(previous)
  return current
}

// ─── 管理员写回（PUT /api/config）──────────────────────────────────────────
// 校验 → 立即生效 → 原子写回 yml。写回后文件监听器也会触发一次 reload，
// 但 reload 内部的 diff 会发现内存与磁盘一致 → emit 不再广播（去重靠 diff，
// 而非时间窗），因此不会重复推送，也不会误吞紧随其后的外部编辑。
export function saveConfig(input: unknown): AppConfig {
  // Non-object body (number/string/array) must NOT reset the whole config.
  if (!isObj(input)) return current
  const previous = current
  // PATCH 语义：把请求体深合并到当前配置之上再校验，未提供的字段保持不变。
  // 这样管理员只改一项不会清空其它设置；整体 PUT（全字段）行为不变。
  current = validate(deepMerge(current, input)) // 立即生效
  const file = configFile()
  const tmp = `${file}.tmp`
  try {
    writeFileSync(tmp, stringifyYaml(current), 'utf8')
    renameSync(tmp, file) // 同文件系统 rename = 原子
  } catch {
    // 写盘失败（只读 FS）：内存配置已更新，仅无法持久化。仍 emit 以保持一致。
  }
  emit(previous)
  return current
}

// ─── 文件监听器 ───────────────────────────────────────────────────────────
let watcher: FSWatcher | null = null
let debounce: NodeJS.Timeout | null = null

function ensureFile(): void {
  if (!existsSync(configFile())) {
    try { writeFileSync(configFile(), stringifyYaml(current), 'utf8') } catch { /* 忽略 */ }
  }
}

export function startConfigWatcher(): void {
  if (watcher) return
  ensureFile()
  try {
    watcher = watch(configFile(), () => {
      // 不用时间窗去重：saveConfig 写盘触发的本次 reload，其 diff 会发现
      // 内存与磁盘一致而跳过广播；真正的外部编辑 diff 非空，照常生效。
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        debounce = null
        reload()
      }, 300) // 去抖：编辑器多次保存事件合并为一次重载
    })
    watcher.on('error', () => {}) // 监听异常不应拖垮进程
  } catch {
    // 只读 FS / 无权限：热重载不可用，但应用仍以启动时配置正常运行。
  }
}

export function stopConfigWatcher(): void {
  if (watcher) {
    try { watcher.close() } catch { /* 忽略 */ }
    watcher = null
  }
  if (debounce) {
    clearTimeout(debounce)
    debounce = null
  }
}
