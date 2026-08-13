import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
type DataKind = 'categories' | 'content' | 'tags' | 'users' | 'comments' | 'ratings' | 'posts' | 'collections' | 'follows' | 'messages' | 'images' | 'groups' | 'groupInvites'

// Each resource kind maps to a backing file. (`categories` lives in
// menu.json for historical reasons — the admin "分组" UI == the nav menu.)
const FILENAME: Record<DataKind, string> = {
  categories: 'menu.json',
  content: 'content.json',
  tags: 'tags.json',
  users: 'users.json',
  comments: 'comments.json',
  ratings: 'ratings.json',
  posts: 'posts.json',
  collections: 'collections.json',
  follows: 'follows.json',
  messages: 'messages.json',
  images: 'images.json',
  groups: 'groups.json',
  groupInvites: 'groupInvites.json',
}

// ─── Data directory resolution ───────────────────────────────────────
// Order: runtimeConfig.dataDir → NUXT_DATA_DIR env → <cwd>/data.
// For read-only / serverless deploys, point this at a writable persistent
// volume. Writes to a read-only location degrade to a clear 507 instead of
// crashing the process.
export function resolveDataDir(): string {
  let configured = ''
  try {
    const dir = useRuntimeConfig().dataDir
    if (typeof dir === 'string') configured = dir
  } catch {
    configured = ''
  }
  return configured || process.env.NUXT_DATA_DIR || join(process.cwd(), 'data')
}

function fileFor(kind: DataKind): string {
  return join(resolveDataDir(), FILENAME[kind])
}

// Shared uploads directory resolver — every endpoint that reads/writes media
// files MUST use this so a custom data.dataDir (config.yml) is honoured
// consistently (prevents cover/media 404s when dataDir is configured).
export function uploadsDir(): string {
  return join(resolveDataDir(), 'uploads')
}

// ─── Low-level JSON I/O (atomic + fault-tolerant) ────────────────────
async function readJson<T>(file: string): Promise<T> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf-8')
  } catch (e) {
    // Missing file → treat as empty (e.g. fresh deploy without bundled data).
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return [] as unknown as T
    throw e
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    // Corrupt JSON: quarantine the bad file so the server keeps serving,
    // and surface an empty collection instead of crashing every request.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await fs.writeFile(`${file}.corrupt-${stamp}`, raw, 'utf-8').catch(() => {})
    return [] as unknown as T
  }
}

// Write atomically: temp file in the same directory (same filesystem →
// rename is atomic). Translates permission / read-only errors into a
// clean HTTP error rather than an uncaught exception.
// 瞬时占用（Windows 杀软/索引器短暂锁定目标文件导致 rename EPERM/EACCES/EBUSY）
// 属于可恢复错误：带抖动重试数次，避免并发写入偶发失败丢数据。
async function writeJson<T>(file: string, data: T): Promise<void> {
  const json = JSON.stringify(data, null, 2)
  const tmp = `${file}.${process.pid}.tmp`
  const RETRYABLE: Record<string, true> = { EPERM: true, EACCES: true, EBUSY: true }
  const MAX_ATTEMPTS = 4
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.mkdir(dirname(file), { recursive: true })
      await fs.writeFile(tmp, json, 'utf-8')
      await fs.rename(tmp, file)
      return
    } catch (e) {
      await fs.unlink(tmp).catch(() => {})
      const code = (e as NodeJS.ErrnoException)?.code
      if (RETRYABLE[code!] && attempt < MAX_ATTEMPTS) {
        // 指数退避 + 随机抖动（20ms ~ 160ms），给外部锁释放窗口
        await sleep(20 * attempt * (1 + Math.random()))
        continue
      }
      const readonly =
        code === 'EROFS' || code === 'EACCES' || code === 'EPERM' || code === 'ENOSPC'
      throw createError({
        statusCode: readonly ? 507 : 500,
        statusMessage: readonly
          ? (code === 'ENOSPC'
              ? '磁盘空间不足，无法写入数据。'
              : '数据目录为只读，无法写入。请设置环境变量 NUXT_DATA_DIR 指向一个可写的持久化目录。')
          : `写入数据失败：${(e as Error)?.message || String(e)}`,
      })
    }
  }
}

// ─── In-process write mutex ──────────────────────────────────────────
// Serializes read-modify-write per resource so concurrent requests within
// a single process can't lose updates. (Multi-process deploys need a shared
// FS lock — out of scope here.)
const locks = new Map<string, Promise<unknown>>()
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  // Keep the chain alive without leaking earlier failures to later callers.
  locks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  return run
}

// Generate a short unique id.
export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// Transactional update: lock → read → mutate(in place) → write.
// `fn` mutates the array in place and returns whatever the caller wants
// surfaced (the created/updated entity, a result object). Throwing inside
// `fn` aborts the transaction before any write happens.
async function updateData<T, R>(kind: DataKind, fn: (items: T[]) => R | Promise<R>): Promise<R> {
  return withLock(kind, async () => {
    const items = await readJson<T[]>(fileFor(kind))
    const result = await fn(items)
    await writeJson(fileFor(kind), items)
    return result
  })
}

// Backfill stable ids for legacy entries once. To avoid a lost-update race
// with a concurrent locked mutation, the backfill re-reads under the write
// lock (the common path — all ids present — stays lock-free). Returns the
// array to use (re-read fresh if a backfill occurred).
async function ensureIds<T extends { id?: string }>(items: T[], kind: DataKind): Promise<T[]> {
  if (!items.length || !items.some((i) => !i.id)) return items
  return withLock(kind, async () => {
    const fresh = await readJson<T[]>(fileFor(kind))
    if (fresh.length && fresh.some((i) => !i.id)) {
      fresh.forEach((i) => {
        if (!i.id) i.id = genId()
      })
      await writeJson(fileFor(kind), fresh).catch(() => {})
    }
    return fresh
  })
}

// ─── Categories (分组) ───────────────────────────────────────────────
export interface Category {
  id?: string
  title: string
  title_zh: string
  icon: string
}

export async function getCategories(): Promise<Category[]> {
  const data = await readJson<Category[]>(fileFor('categories'))
  return ensureIds(data, 'categories')
}

export function updateCategories<R>(fn: (items: Category[]) => R | Promise<R>): Promise<R> {
  return updateData<Category, R>('categories', fn)
}

// ─── Content (内容) ──────────────────────────────────────────────────
export interface ContentItem {
  id?: string
  category: string
  category_zh: string
  subCategory: string
  subCategory_zh: string
  name: string
  name_zh: string
  content: string
  content_zh: string
  detail: string
  detail_zh: string
  url: string
  rating: number
}

export async function getContent(): Promise<ContentItem[]> {
  const data = await readJson<ContentItem[]>(fileFor('content'))
  return ensureIds(data, 'content')
}

export function updateContent<R>(fn: (items: ContentItem[]) => R | Promise<R>): Promise<R> {
  return updateData<ContentItem, R>('content', fn)
}

// ─── Tags (子分类/标签) ──────────────────────────────────────────────
// Independent tag definitions. `name` aligns with content.subCategory so
// the admin can pre-define tags that content items can later reference.
export interface Tag {
  id?: string
  name: string
  name_zh: string
  category?: string
  category_zh?: string
}

export async function getTags(): Promise<Tag[]> {
  const data = await readJson<Tag[]>(fileFor('tags'))
  return ensureIds(data, 'tags')
}

export function updateTags<R>(fn: (items: Tag[]) => R | Promise<R>): Promise<R> {
  return updateData<Tag, R>('tags', fn)
}

// ─── Users (用户系统) ────────────────────────────────────────────────
export interface User {
  id: string
  username: string
  passwordHash: string
  role: 'admin' | 'user'  // 角色：admin 可管理后台，user 为普通用户
  avatarColor: number  // 0-5, indexes into a palette (fallback when no custom avatar)
  avatarUrl: string    // custom uploaded avatar (empty = use color-based letter avatar)
  backgroundUrl: string // profile background image (empty = gradient fallback)
  bio: string
  createdAt: number
}

export async function getUsers(): Promise<User[]> {
  return readJson<User[]>(fileFor('users'))
}

export function updateUsers<R>(fn: (items: User[]) => R | Promise<R>): Promise<R> {
  return updateData<User, R>('users', fn)
}

// ─── Comments (评论) ─────────────────────────────────────────────────
export interface Comment {
  id: string
  contentId: string       // which app/content/post this belongs to
  targetType?: 'content' | 'post'  // disambiguates contentId; default 'content'
  userId: string
  username: string
  avatarColor: number
  text: string
  parentId: string | null // null = top-level; otherwise = parent comment id
  likedBy: string[]       // userIds who liked
  createdAt: number
}

export async function getComments(): Promise<Comment[]> {
  return readJson<Comment[]>(fileFor('comments'))
}

export function updateComments<R>(fn: (items: Comment[]) => R | Promise<R>): Promise<R> {
  return updateData<Comment, R>('comments', fn)
}

// ─── Ratings (评分) ──────────────────────────────────────────────────
export interface Rating {
  id: string
  contentId: string
  userId: string
  value: number  // 1-5
  createdAt: number
}

export async function getRatings(): Promise<Rating[]> {
  return readJson<Rating[]>(fileFor('ratings'))
}

export function updateRatings<R>(fn: (items: Rating[]) => R | Promise<R>): Promise<R> {
  return updateData<Rating, R>('ratings', fn)
}

// ─── Posts (社区帖子 - 小红书风格) ─────────────────────────────────
export interface Post {
  id: string
  userId: string
  username: string
  avatarColor: number
  title: string
  content: string
  images: string[]        // uploaded image paths (relative to /api/uploads/)
  videos: string[]        // uploaded video paths (relative to /api/uploads/)
  tags: string[]          // topic tags e.g. ['旅行', '摄影']
  likedBy: string[]       // userIds who liked (denormalized for count)
  collectedBy: string[]   // userIds who saved to any collection
  commentCount: number    // denormalized for quick display
  createdAt: number
  updatedAt: number
}

export async function getPosts(): Promise<Post[]> {
  const data = await readJson<Post[]>(fileFor('posts'))
  return ensureIds(data, 'posts')
}

export function updatePosts<R>(fn: (items: Post[]) => R | Promise<R>): Promise<R> {
  return updateData<Post, R>('posts', fn)
}

// ─── Collections (收藏夹) ───────────────────────────────────────────
export interface Collection {
  id: string
  userId: string
  name: string
  description: string
  postIds: string[]
  createdAt: number
}

export async function getCollections(): Promise<Collection[]> {
  const data = await readJson<Collection[]>(fileFor('collections'))
  return ensureIds(data, 'collections')
}

export function updateCollections<R>(fn: (items: Collection[]) => R | Promise<R>): Promise<R> {
  return updateData<Collection, R>('collections', fn)
}

// ─── Follows (关注关系) ──────────────────────────────────────────────
export interface Follow {
  id: string
  followerId: string  // who follows
  followeeId: string  // who is followed
  createdAt: number
}

export async function getFollows(): Promise<Follow[]> {
  const data = await readJson<Follow[]>(fileFor('follows'))
  return ensureIds(data, 'follows')
}

export function updateFollows<R>(fn: (items: Follow[]) => R | Promise<R>): Promise<R> {
  return updateData<Follow, R>('follows', fn)
}

// ─── Messages (私信) ─────────────────────────────────────────────────
export interface Message {
  id: string
  fromUserId: string
  toUserId: string
  text: string
  read: boolean         // recipient opened the conversation
  delivered: boolean    // pushed to a live WS connection
  createdAt: number
  // 多消息类型：1=文本(默认)  2=图片  3=GIF/表情
  msgType: 1 | 2 | 3
  mediaUrl: string      // 图片/GIF 的访问路径（msgType≠1 时）
  mediaW: number        // 宽（0 = 未知）
  mediaH: number        // 高（0 = 未知）
}

export async function getMessages(): Promise<Message[]> {
  const data = await readJson<Message[]>(fileFor('messages'))
  return ensureIds(data, 'messages')
}

export function updateMessages<R>(fn: (items: Message[]) => R | Promise<R>): Promise<R> {
  return updateData<Message, R>('messages', fn)
}

// ─── Images (图片元信息) ─────────────────────────────────────────────
// 结构化元信息：文件存储在 data/uploads/，元信息记录在此 JSON 中。
// purpose: 'post' | 'avatar' | 'background' — 标记图片用途，便于管理与清理。
export interface ImageMeta {
  id: string
  filename: string         // 磁盘文件名（含扩展名）
  originalName: string     // 用户上传时的原始文件名
  mimeType: string         // image/jpeg, video/mp4, ...
  kind: 'image' | 'video'  // 媒体类型
  size: number             // 字节数
  width: number            // 像素宽（0 = 未知）
  height: number           // 像素高（0 = 未知）
  duration: number         // 视频时长秒（0 = 非视频或未知）
  userId: string           // 上传者
  purpose: 'post' | 'avatar' | 'background' | 'other'
  url: string              // 公开访问路径 /api/uploads/<filename>
  createdAt: number
}

export async function getImages(): Promise<ImageMeta[]> {
  const data = await readJson<ImageMeta[]>(fileFor('images'))
  return ensureIds(data, 'images')
}

export function updateImages<R>(fn: (items: ImageMeta[]) => R | Promise<R>): Promise<R> {
  return updateData<ImageMeta, R>('images', fn)
}

// ─── Groups (群组聊天) ───────────────────────────────────────────────
// 群组元信息：成员、群主。实时消息走 WuKongIM 频道（grp_<id>），不在此落库。
export interface Group {
  id: string
  name: string
  avatarColor: number
  ownerId: string
  memberIds: string[]
  createdAt: number
}

export async function getGroups(): Promise<Group[]> {
  return readJson<Group[]>(fileFor('groups'))
}

export function updateGroups<R>(fn: (items: Group[]) => R | Promise<R>): Promise<R> {
  return updateData<Group, R>('groups', fn)
}

// ─── Group Invites (群邀请 · 需同意) ──────────────────────────────────
export type InviteStatus = 'pending' | 'accepted' | 'declined'
export interface GroupInvite {
  id: string
  groupId: string
  groupName: string
  fromUserId: string
  fromUsername: string
  toUserId: string
  status: InviteStatus
  createdAt: number
}

export async function getGroupInvites(): Promise<GroupInvite[]> {
  return readJson<GroupInvite[]>(fileFor('groupInvites'))
}

export function updateGroupInvites<R>(fn: (items: GroupInvite[]) => R | Promise<R>): Promise<R> {
  return updateData<GroupInvite, R>('groupInvites', fn)
}
