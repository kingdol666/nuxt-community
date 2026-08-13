<script setup lang="ts">
// 内容详情 Modal —— 小红书 explore 风格的双栏详情卡片 + 完整社区生态。
//
// 功能：持久化评论、嵌套回复、评论点赞、用户评分、内容点赞/收藏/分享。
// 用户系统：未登录可浏览；评论/回复/点赞/评分需登录（触发 AuthModal）。
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useTheme } from '~/composables/useTheme'
import { useAuth } from '~/composables/useAuth'
import { apiError } from '~/composables/useApiError'
import {
  CloseOutlined,
  FileTextOutlined,
  StarFilled,
  StarOutlined,
  HeartFilled,
  HeartOutlined,
  SaveFilled,
  SaveOutlined,
  ShareAltOutlined,
  ArrowUpOutlined,
  MessageOutlined,
  UserOutlined,
  EnvironmentOutlined,
  LinkOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue'

interface ContentItem {
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

interface Comment {
  id: string
  contentId: string
  userId: string
  username: string
  avatarColor: number
  text: string
  parentId: string | null
  likedBy: string[]
  createdAt: number
}

const props = defineProps<{ modelValue: boolean; item: ContentItem | null }>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()
const open = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) })

const { themeMode } = useTheme()
const { user, isLoggedIn, openAuthModal } = useAuth()
const isDark = computed(() => themeMode.value === 'dark')

// ─────────────────────────── 工具 ───────────────────────────
function getHostname(u?: string) {
  if (!u) return ''
  try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u }
}
function getFaviconUrl(u?: string) {
  if (!u) return ''
  try { return `https://unavatar.io/${new URL(u).hostname}?fallback=false` } catch { return '' }
}
function seededRand(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) / 4294967296
}
function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#f2633c,#e8437a)',
  'linear-gradient(135deg,#06b6d4,#3b82f6)',
  'linear-gradient(135deg,#10b981,#06b6d4)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#e8437a,#c2410c)',
  'linear-gradient(135deg,#38bdf8,#0ea5e9)',
]
function avatarStyle(color: number) {
  return { background: AVATAR_GRADIENTS[color % AVATAR_GRADIENTS.length] }
}

// ─────────────────────────── 视觉：渐变方案 ───────────────────────────
const gradients = [
  'linear-gradient(135deg,#f2633c,#e8437a)',
  'linear-gradient(135deg,#06b6d4,#3b82f6)',
  'linear-gradient(135deg,#10b981,#06b6d4)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#e8437a,#c2410c)',
  'linear-gradient(135deg,#38bdf8,#0ea5e9)',
]
const heroGrad = computed(() => {
  const id = props.item?.id || props.item?.name || '0'
  return gradients[Math.floor(seededRand(id) * gradients.length) % gradients.length]
})
const initial = computed(() => (props.item?.name || '?').charAt(0).toUpperCase())

// ─────────────────────────── 内容点赞/收藏（localStorage，与旧版一致） ───────────────────────────
const liked = ref(false)
const saved = ref(false)
const likeBurst = ref(false)
const baseLikes = computed(() => {
  const id = props.item?.id || '0'
  return Math.floor(seededRand(id + 'like') * 2400) + 80
})
const likes = computed(() => baseLikes.value + (liked.value ? 1 : 0))
const LS_KEY = 'content-detail-state'
function loadPersisted() {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    const id = props.item?.id
    if (id && raw[id]) { liked.value = !!raw[id].liked; saved.value = !!raw[id].saved }
    else { liked.value = false; saved.value = false }
  } catch { /* ignore */ }
}
function persist() {
  if (typeof localStorage === 'undefined' || !props.item?.id) return
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    raw[props.item.id] = { liked: liked.value, saved: saved.value }
    localStorage.setItem(LS_KEY, JSON.stringify(raw))
  } catch { /* ignore */ }
}
function toggleLike() {
  if (!isLoggedIn.value) { openAuthModal(); return }
  liked.value = !liked.value
  if (liked.value) { likeBurst.value = true; setTimeout(() => { likeBurst.value = false }, 420) }
  persist()
}
function toggleSave() {
  if (!isLoggedIn.value) { openAuthModal(); return }
  saved.value = !saved.value
  persist()
}

// ─────────────────────────── 分享 ───────────────────────────
const toast = ref('')
let toastTimer: any = null
function flashToast(t: string) {
  toast.value = t
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2200)
}
// 分享：生成本站内容的深链接（/application?detail=<id>），访问即打开该详情。
// 优先用 Clipboard API；降级用 textarea + execCommand（兼容非 HTTPS / 旧浏览器）。
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

async function share() {
  const id = props.item?.id
  if (!id) { flashToast('暂无可分享的内容'); return }
  // 深链接：指向本站应用推荐页并自动打开该内容详情
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const shareUrl = `${origin}/application?detail=${id}`
  const ok = await copyToClipboard(shareUrl)
  flashToast(ok ? '分享链接已复制，去粘贴给朋友吧' : '复制失败，请手动复制')
}

// ─────────────────────────── 用户评分 ───────────────────────────
const ratingAvg = ref(0)
const ratingCount = ref(0)
const userRating = ref(0)
const hoverRating = ref(0)
const ratingSubmitting = ref(false)
async function loadRating() {
  if (!props.item?.id) return
  try {
    const data = await $fetch<{ avg: number; count: number; userRating: number }>(
      '/api/ratings', { query: { contentId: props.item.id } },
    )
    ratingAvg.value = data.avg
    ratingCount.value = data.count
    userRating.value = data.userRating
  } catch { /* ignore */ }
}
async function submitRating(value: number) {
  if (!isLoggedIn.value) { openAuthModal(); return }
  if (ratingSubmitting.value) return
  ratingSubmitting.value = true
  const prev = userRating.value
  userRating.value = value
  try {
    await $fetch('/api/ratings', { method: 'POST', body: { contentId: props.item!.id, value } })
    flashToast('评分已提交')
  } catch (e: unknown) {
    userRating.value = prev
    flashToast(apiError(e, '评分失败'))
  } finally {
    ratingSubmitting.value = false
  }
}

// ─────────────────────────── 评论（持久化 + 嵌套回复） ───────────────────────────
const allComments = ref<Comment[]>([])
const topLevelComments = computed(() => allComments.value.filter((c) => !c.parentId))
const commentCount = computed(() => allComments.value.filter((c) => !c.parentId).length)
function repliesOf(parentId: string) {
  return allComments.value.filter((c) => c.parentId === parentId)
}

async function loadComments() {
  if (!props.item?.id) return
  try {
    const data = await $fetch<Comment[]>('/api/comments', { query: { contentId: props.item.id } })
    allComments.value = data
  } catch { allComments.value = [] }
}

const newCommentText = ref('')
const commentPosting = ref(false)
async function submitComment() {
  const text = newCommentText.value.trim()
  if (!text) return
  if (!isLoggedIn.value) { openAuthModal(); return }
  commentPosting.value = true
  try {
    const created = await $fetch<Comment>('/api/comments', {
      method: 'POST',
      body: { contentId: props.item!.id, text, parentId: null },
    })
    allComments.value.unshift(created)
  } catch (e: unknown) {
    flashToast(apiError(e, '评论失败'))
  } finally {
    commentPosting.value = false
  }
}

// 回复状态：每条评论可独立展开回复框
const replyTo = ref<string | null>(null)  // comment id being replied to
const replyTexts = ref<Record<string, string>>({})
function toggleReply(commentId: string) {
  if (!isLoggedIn.value) { openAuthModal(); return }
  replyTo.value = replyTo.value === commentId ? null : commentId
}
async function submitReply(parentId: string) {
  const text = (replyTexts.value[parentId] || '').trim()
  if (!text) return
  if (!isLoggedIn.value) { openAuthModal(); return }
  try {
    const created = await $fetch<Comment>('/api/comments', {
      method: 'POST',
      body: { contentId: props.item!.id, text, parentId },
    })
    allComments.value.push(created)
    replyTexts.value[parentId] = ''
  } catch (e: unknown) {
    flashToast(apiError(e, '回复失败'))
  }
}

// 评论点赞
const likeSubmitting = ref<Set<string>>(new Set())
async function toggleCommentLike(comment: Comment) {
  if (!isLoggedIn.value) { openAuthModal(); return }
  if (likeSubmitting.value.has(comment.id)) return
  likeSubmitting.value.add(comment.id)
  const wasLiked = comment.likedBy.includes(user.value!.id)
  // 乐观更新
  if (wasLiked) {
    comment.likedBy = comment.likedBy.filter((uid) => uid !== user.value!.id)
  } else {
    comment.likedBy = [...comment.likedBy, user.value!.id]
  }
  try {
    await $fetch(`/api/comments/${comment.id}/like`, { method: 'POST' })
  } catch {
    // 回滚
    if (wasLiked) comment.likedBy = [...comment.likedBy, user.value!.id]
    else comment.likedBy = comment.likedBy.filter((uid) => uid !== user.value!.id)
  } finally {
    likeSubmitting.value.delete(comment.id)
  }
}

// 删除评论（仅自己的）
const deleteConfirmId = ref<string | null>(null)
async function deleteComment(commentId: string) {
  try {
    const res = await $fetch<{ deleted: number }>(`/api/comments/${commentId}`, { method: 'DELETE' })
    const removed = new Set([commentId])
    // 级联删除的回复也移除
    allComments.value = allComments.value.filter((c) => {
      if (removed.has(c.id)) return false
      let parent = c.parentId
      while (parent) {
        if (removed.has(parent)) { removed.add(c.id); return false }
        const p = allComments.value.find((x) => x.id === parent)
        parent = p?.parentId ?? null
      }
      return true
    })
    deleteConfirmId.value = null
  } catch (e: unknown) {
    flashToast(apiError(e, '删除失败'))
  }
}

// ─────────────────────────── 打开/关闭 ───────────────────────────
function close() { open.value = false }
function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape' && open.value) close() }

async function loadData() {
  await Promise.all([loadComments(), loadRating(), Promise.resolve(loadPersisted())])
}

watch(open, async (v) => {
  if (typeof document === 'undefined') return
  if (v) {
    document.addEventListener('keydown', onKeydown)
    document.body.style.overflow = 'hidden'
    replyTo.value = null
    await loadData()
  } else {
    document.removeEventListener('keydown', onKeydown)
    document.body.style.overflow = ''
  }
})

watch(() => props.item?.id, async () => {
  if (open.value) { replyTo.value = null; await loadData() }
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('keydown', onKeydown)
    document.body.style.overflow = ''
  }
  clearTimeout(toastTimer)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="detail-fade">
      <div v-if="open && item" class="detail-overlay" :class="{ dark: isDark }" @click.self="close">
        <Transition name="detail-pop" appear>
          <div v-if="open && item" class="detail-card" role="dialog" aria-modal="true">
            <button class="detail-close" aria-label="关闭" @click="close"><CloseOutlined /></button>

            <div class="detail-grid">
              <!-- ============ 左：视觉面板 ============ -->
              <aside class="detail-visual" :style="{ '--grad': heroGrad }">
                <div class="visual-aurora" />
                <div class="visual-blob blob-1" />
                <div class="visual-blob blob-2" />
                <div class="visual-content">
                  <div class="visual-appicon">
                    <img
                      v-if="getFaviconUrl(item.url)"
                      :src="getFaviconUrl(item.url)"
                      :alt="item.name"
                      class="visual-favicon"
                      @error="($event.target as HTMLImageElement).style.display='none'"
                    />
                    <span v-else class="visual-letter">{{ initial }}</span>
                  </div>
                  <div class="visual-label">{{ item.category_zh || item.category }}</div>
                  <div class="visual-name">{{ item.name }}</div>
                </div>
                <div class="visual-bottom">
                  <span class="visual-host"><EnvironmentOutlined /> {{ getHostname(item.url) || '—' }}</span>
                </div>
              </aside>

              <!-- ============ 右：内容区 ============ -->
              <section class="detail-body">
                <div class="body-scroll">
                  <!-- 标签行 -->
                  <div class="detail-tags">
                    <span class="chip chip-cat">{{ item.category_zh || item.category }}</span>
                    <span class="chip chip-sub">{{ item.subCategory_zh || item.subCategory }}</span>
                  </div>

                  <!-- 标题 -->
                  <h2 class="detail-title">{{ item.name_zh || item.name }}</h2>
                  <p v-if="item.name_zh && item.name !== item.name_zh" class="detail-enname">{{ item.name }}</p>

                  <!-- 评分：官方 + 用户社区评分 -->
                  <div class="detail-rating">
                    <span class="stars">
                      <component v-for="i in 5" :key="i" :is="i <= (item.rating || 0) ? StarFilled : StarOutlined" class="star" :class="{ on: i <= (item.rating || 0) }" />
                    </span>
                    <span class="rating-num">{{ item.rating || 0 }}.0</span>
                    <span class="rating-label">官方评分</span>
                  </div>

                  <!-- 用户评分区 -->
                  <div class="user-rating-card">
                    <div class="ur-head">
                      <div class="ur-stats">
                        <span class="ur-avg">{{ ratingAvg > 0 ? ratingAvg.toFixed(1) : '—' }}</span>
                        <div class="ur-detail">
                          <span class="stars sm">
                            <component v-for="i in 5" :key="i" :is="i <= Math.round(ratingAvg) ? StarFilled : StarOutlined" class="star" :class="{ on: i <= Math.round(ratingAvg) }" />
                          </span>
                          <span class="ur-count">{{ ratingCount }} 人评分</span>
                        </div>
                      </div>
                      <div class="ur-action">
                        <span class="ur-label">{{ userRating > 0 ? '我的评分' : (isLoggedIn ? '给个评分' : '登录后评分') }}</span>
                        <span class="stars editable">
                          <span
                            v-for="i in 5" :key="i" class="star" :class="{ on: i <= (hoverRating || userRating) }"
                            @mouseenter="hoverRating = i" @mouseleave="hoverRating = 0" @click="submitRating(i)"
                          >★</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- 简介 -->
                  <div class="detail-desc">
                    <p class="desc-zh">{{ item.content_zh || item.content || '暂无简介' }}</p>
                    <p v-if="item.content && item.content_zh && item.content !== item.content_zh" class="desc-en">{{ item.content }}</p>
                  </div>

                  <!-- 详细介绍 -->
                  <div v-if="(item.detail_zh || item.detail)" class="detail-full">
                    <div class="full-head"><FileTextOutlined /> 详细介绍</div>
                    <p class="full-zh">{{ item.detail_zh || item.detail }}</p>
                    <p v-if="item.detail && item.detail_zh && item.detail !== item.detail_zh" class="full-en">{{ item.detail }}</p>
                  </div>

                  <!-- 链接 -->
                  <a v-if="item.url" :href="item.url" target="_blank" rel="noopener noreferrer" class="detail-link">
                    <LinkOutlined /> {{ item.url }}
                  </a>

                  <!-- 评论区（小红书风格） -->
                  <div class="detail-comments">
                    <div class="comments-head">
                      <MessageOutlined /> <span>共 {{ commentCount }} 条评论</span>
                    </div>

                    <!-- 评论输入框 -->
                    <div class="comment-form">
                      <span v-if="isLoggedIn" class="comment-avatar" :style="avatarStyle(user!.avatarColor)"><UserOutlined /></span>
                      <span v-else class="comment-avatar guest"><UserOutlined /></span>
                      <input
                        v-model="newCommentText"
                        type="text"
                        :placeholder="isLoggedIn ? '说点什么…' : '登录后评论…'"
                        @focus="!isLoggedIn && openAuthModal()"
                        @keydown.enter="submitComment"
                      />
                      <button :disabled="!newCommentText.trim() || commentPosting" @click="submitComment">
                        {{ commentPosting ? '发布中' : '发布' }}
                      </button>
                    </div>

                    <!-- 评论列表 -->
                    <div v-if="topLevelComments.length" class="comment-list">
                      <div v-for="c in topLevelComments" :key="c.id" class="comment-item">
                        <span class="comment-avatar" :style="avatarStyle(c.avatarColor)"><UserOutlined /></span>
                        <div class="comment-main">
                              <div class="comment-meta">
                                <span class="comment-author">{{ c.username }}</span>
                                <span class="comment-date">{{ formatTime(c.createdAt) }}</span>
                              </div>
                              <p class="comment-text">{{ c.text }}</p>
                              <div class="comment-actions">
                                <button class="ca-btn" :class="{ liked: c.likedBy.includes(user?.id || '') }" @click="toggleCommentLike(c)">
                                  <HeartFilled v-if="c.likedBy.includes(user?.id || '')" />
                                  <HeartOutlined v-else />
                                  <span v-if="c.likedBy.length">{{ c.likedBy.length }}</span>
                                </button>
                                <button class="ca-btn" @click="toggleReply(c.id)">
                                  <MessageOutlined /><span>回复</span>
                                </button>
                                <button v-if="c.userId === user?.id" class="ca-btn danger" @click="deleteConfirmId = deleteConfirmId === c.id ? null : c.id">
                                  <DeleteOutlined /><span>删除</span>
                                </button>
                              </div>
                              <!-- 删除确认 -->
                              <div v-if="deleteConfirmId === c.id" class="delete-confirm">
                                <span>确认删除该评论及其回复？</span>
                                <button class="dc-cancel" @click="deleteConfirmId = null">取消</button>
                                <button class="dc-ok" @click="deleteComment(c.id)">删除</button>
                              </div>
                              <!-- 回复输入框 -->
                              <div v-if="replyTo === c.id" class="reply-form">
                                <input
                                  v-model="replyTexts[c.id]"
                                  type="text"
                                  placeholder="回复…"
                                  @keydown.enter="submitReply(c.id)"
                                />
                                <button :disabled="!(replyTexts[c.id] || '').trim()" @click="submitReply(c.id)">回复</button>
                                <button class="reply-cancel" @click="replyTo = null">取消</button>
                              </div>
                              <!-- 嵌套回复 -->
                              <div v-if="repliesOf(c.id).length" class="reply-list">
                                <div v-for="r in repliesOf(c.id)" :key="r.id" class="comment-item reply">
                                  <span class="comment-avatar sm" :style="avatarStyle(r.avatarColor)"><UserOutlined /></span>
                                  <div class="comment-main">
                                    <div class="comment-meta">
                                      <span class="comment-author">{{ r.username }}</span>
                                      <span class="comment-date">{{ formatTime(r.createdAt) }}</span>
                                    </div>
                                    <p class="comment-text">{{ r.text }}</p>
                                    <div class="comment-actions">
                                      <button class="ca-btn" :class="{ liked: r.likedBy.includes(user?.id || '') }" @click="toggleCommentLike(r)">
                                        <HeartFilled v-if="r.likedBy.includes(user?.id || '')" />
                                        <HeartOutlined v-else />
                                        <span v-if="r.likedBy.length">{{ r.likedBy.length }}</span>
                                      </button>
                                      <button v-if="r.userId === user?.id" class="ca-btn danger" @click="deleteComment(r.id)">
                                        <DeleteOutlined /><span>删除</span>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                      </div>
                    </div>
                    <div v-else class="comment-empty">
                      <MessageOutlined />
                      <span>{{ isLoggedIn ? '还没有评论，来抢沙发吧' : '登录后发表第一条评论' }}</span>
                    </div>
                  </div>
                </div>

                <!-- 底部操作栏（sticky） -->
                <div class="detail-actions">
                  <button class="action-btn like-btn" :class="{ active: liked, burst: likeBurst }" @click="toggleLike">
                    <component :is="liked ? HeartFilled : HeartOutlined" /><span>{{ likes }}</span>
                  </button>
                  <button class="action-btn" :class="{ active: saved }" @click="toggleSave">
                    <component :is="saved ? SaveFilled : SaveOutlined" /><span>{{ saved ? '已收藏' : '收藏' }}</span>
                  </button>
                  <button class="action-btn" @click="share"><ShareAltOutlined /><span>分享</span></button>
                  <a v-if="item.url" :href="item.url" target="_blank" rel="noopener noreferrer" class="action-visit">
                    访问应用 <ArrowUpOutlined />
                  </a>
                </div>
              </section>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- toast -->
    <Transition name="toast">
      <div v-if="toast" class="detail-toast">{{ toast }}</div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="less">
/* ============ 遮罩 ============ */
.detail-overlay {
  position: fixed; inset: 0; z-index: 1200;
  display: grid; place-items: center; padding: 24px;
  background: rgba(10, 10, 18, 0.62);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.detail-overlay.dark { background: rgba(4, 4, 10, 0.74); }

.detail-card {
  position: relative;
  width: 100%; max-width: 960px;
  max-height: calc(100vh - 48px);
  display: flex;
  border-radius: var(--radius-xl);
  overflow: hidden;
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-lg), inset 0 1px 0 var(--glass-highlight);
}
.detail-close {
  position: absolute; top: 12px; right: 12px; z-index: 20;
  display: grid; place-items: center;
  width: 36px; height: 36px;
  border: none; border-radius: 50%;
  background: rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(8px);
  color: #fff; font-size: 16px; cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  &:hover { background: rgba(0, 0, 0, 0.5); transform: rotate(90deg); }
}
.detail-grid { display: grid; grid-template-columns: 42% 58%; width: 100%; }

/* ============ 左：视觉面板 ============ */
.detail-visual {
  position: relative; background: var(--grad); overflow: hidden;
  min-height: 420px; display: flex; flex-direction: column;
}
.visual-aurora {
  position: absolute; inset: -20%;
  background: radial-gradient(circle at 30% 25%, rgba(255,255,255,0.28), transparent 55%),
              radial-gradient(circle at 75% 75%, rgba(0,0,0,0.22), transparent 55%);
  pointer-events: none;
}
.visual-blob { position: absolute; border-radius: 50%; filter: blur(40px); opacity: 0.5; pointer-events: none; }
.blob-1 { width: 220px; height: 220px; background: rgba(255,255,255,0.3); top: -40px; right: -30px; animation: blob-float 9s ease-in-out infinite; }
.blob-2 { width: 180px; height: 180px; background: rgba(0,0,0,0.2); bottom: 30px; left: -40px; animation: blob-float 11s ease-in-out infinite reverse; }
@keyframes blob-float { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(14px,-18px) scale(1.08); } }
.visual-content {
  position: relative; z-index: 2; flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 40px 24px; text-align: center;
}
.visual-appicon {
  width: 108px; height: 108px; border-radius: 28px;
  display: grid; place-items: center;
  background: rgba(255,255,255,0.95);
  box-shadow: 0 18px 48px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(255,255,255,0.5);
  overflow: hidden;
}
.visual-favicon { width: 64%; height: 64%; object-fit: contain; }
.visual-letter { font-size: 54px; font-weight: 800; color: var(--accent); font-family: var(--font-display); }
.visual-label {
  font-size: var(--text-sm); font-weight: 600; letter-spacing: 0.04em;
  color: rgba(255,255,255,0.85); padding: 4px 14px;
  background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.25);
  border-radius: var(--radius-full);
}
.visual-name {
  font-family: var(--font-display); font-size: 26px; font-weight: 800; color: #fff;
  text-shadow: 0 2px 16px rgba(0,0,0,0.3); letter-spacing: -0.01em; word-break: break-word;
}
.visual-bottom { position: relative; z-index: 2; padding: 16px 22px; }
.visual-host {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--text-xs); color: rgba(255,255,255,0.8); font-variant-numeric: tabular-nums;
}

/* ============ 右：内容区 ============ */
.detail-body { display: flex; flex-direction: column; min-width: 0; max-height: calc(100vh - 48px); }
.body-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 28px 30px 8px; }

.detail-tags { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.chip { font-size: var(--text-xs); font-weight: 600; padding: 4px 12px; border-radius: var(--radius-full); }
.chip-cat { color: var(--accent); background: var(--accent-soft); }
.chip-sub { color: var(--text-secondary); background: var(--glass-bg-soft); border: 1px solid var(--glass-border-inset); }

.detail-title {
  margin: 0; font-family: var(--font-display);
  font-size: 26px; font-weight: 800; letter-spacing: -0.02em;
  color: var(--text-primary); line-height: 1.25;
}
.detail-enname { margin: 4px 0 0; font-size: var(--text-sm); color: var(--text-muted); }

.detail-rating {
  display: flex; align-items: center; gap: 8px; margin: 16px 0 14px;
  padding: 10px 14px; border-radius: var(--radius-md);
  background: var(--glass-bg-soft); border: 1px solid var(--glass-border-inset);
}
.stars { display: inline-flex; gap: 2px; }
.stars.sm .star { font-size: 13px; }
.star { font-size: 16px; color: var(--text-muted); }
.star.on { color: #fadb14; }
.rating-num { font-weight: 800; font-size: var(--text-md); color: var(--text-primary); font-variant-numeric: tabular-nums; }
.rating-label { font-size: var(--text-xs); color: var(--text-muted); }

/* 用户评分卡 */
.user-rating-card {
  padding: 16px 18px; margin-bottom: 18px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--accent-soft), color-mix(in srgb, var(--accent) 4%, transparent));
  border: 1px solid color-mix(in srgb, var(--accent) 18%, transparent);
}
.ur-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.ur-stats { display: flex; align-items: center; gap: 12px; }
.ur-avg {
  font-family: var(--font-display); font-size: 32px; font-weight: 800;
  color: var(--text-primary); line-height: 1; font-variant-numeric: tabular-nums;
}
.ur-detail { display: flex; flex-direction: column; gap: 3px; }
.ur-count { font-size: var(--text-xs); color: var(--text-muted); }
.ur-action { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
.ur-label { font-size: var(--text-xs); color: var(--text-secondary); font-weight: 600; }
.stars.editable { gap: 4px; }
.stars.editable .star {
  font-size: 22px; cursor: pointer; opacity: 0.4;
  transition: color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
  &:hover { transform: scale(1.2); }
}
.stars.editable .star.on { opacity: 1; }

.detail-desc { margin-bottom: 18px; }
.desc-zh { margin: 0; font-size: var(--text-base); line-height: 1.75; color: var(--text-primary); white-space: pre-wrap; }
.desc-en {
  margin: 12px 0 0; font-size: var(--text-sm); line-height: 1.65; color: var(--text-muted);
  padding-left: 12px; border-left: 2px solid var(--glass-border-inset);
}

/* 详细介绍 */
.detail-full { margin-bottom: 18px; }
.full-head {
  display: inline-flex; align-items: center; gap: 7px;
  font-weight: 700; font-size: var(--text-sm); color: var(--text-primary); margin-bottom: 10px;
  :deep(.anticon) { color: var(--accent); }
}
.full-zh {
  margin: 0; font-size: var(--text-base); line-height: 1.85; color: var(--text-secondary);
  white-space: pre-wrap; padding: 14px 16px; border-radius: var(--radius-md);
  background: var(--glass-bg-soft); border: 1px solid var(--glass-border-inset);
}
.full-en { margin: 10px 0 0; font-size: var(--text-sm); line-height: 1.7; color: var(--text-muted); white-space: pre-wrap; }

.detail-link {
  display: inline-flex; align-items: center; gap: 6px; max-width: 100%; margin-bottom: 22px;
  font-size: var(--text-sm); color: var(--accent); text-decoration: none; word-break: break-all;
  transition: color var(--dur-fast) var(--ease-out);
  :deep(.anticon) { flex-shrink: 0; }
  &:hover { color: var(--accent-hover); }
}

/* ============ 评论区 ============ */
.detail-comments { border-top: 1px solid var(--glass-border-inset); padding-top: 18px; margin-top: 4px; }
.comments-head {
  display: inline-flex; align-items: center; gap: 7px;
  font-weight: 700; font-size: var(--text-md); color: var(--text-primary); margin-bottom: 14px;
  :deep(.anticon) { color: var(--accent); }
}
.comment-form {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: var(--radius-md);
  background: var(--glass-bg-soft); border: 1px solid var(--glass-border-inset);
  margin-bottom: 18px;
}
.comment-form input {
  flex: 1; min-width: 0; border: none; background: transparent; outline: none;
  padding: 8px 4px; font-family: inherit; font-size: var(--text-sm); color: var(--text-primary);
  &::placeholder { color: var(--text-muted); }
}
.comment-form button {
  appearance: none; cursor: pointer; border: none;
  padding: 7px 16px; border-radius: var(--radius-full);
  font-family: inherit; font-size: var(--text-xs); font-weight: 600;
  color: #fff; background: var(--accent);
  transition: opacity var(--dur-fast) var(--ease-out);
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}

.comment-list { display: flex; flex-direction: column; gap: 18px; }
.comment-item { display: flex; gap: 10px; }
.comment-avatar {
  display: grid; place-items: center;
  width: 36px; height: 36px; flex-shrink: 0;
  border-radius: 50%; color: #fff; font-size: 16px;
}
.comment-avatar.sm { width: 28px; height: 28px; font-size: 13px; }
.comment-avatar.guest { background: var(--glass-bg-soft) !important; color: var(--text-muted); border: 1px solid var(--glass-border-inset); }
.comment-main { flex: 1; min-width: 0; }
.comment-meta { display: flex; align-items: center; gap: 8px; }
.comment-author { font-weight: 600; font-size: var(--text-sm); color: var(--text-primary); }
.comment-date { font-size: var(--text-xs); color: var(--text-muted); }
.comment-text { margin: 4px 0 6px; font-size: var(--text-sm); line-height: 1.6; color: var(--text-secondary); word-break: break-word; }
.comment-actions { display: flex; align-items: center; gap: 4px; }
.ca-btn {
  appearance: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  border: none; background: transparent;
  padding: 4px 8px; border-radius: var(--radius-sm);
  font-family: inherit; font-size: var(--text-xs); font-weight: 500;
  color: var(--text-muted);
  transition: all var(--dur-fast) var(--ease-out);
  :deep(.anticon) { font-size: 13px; }
  &:hover { background: var(--glass-bg-soft); color: var(--text-secondary); }
  &.liked { color: #ec4899; :deep(.anticon) { color: #ec4899; } }
  &.danger:hover { color: var(--danger); }
}
.delete-confirm {
  display: inline-flex; align-items: center; gap: 8px;
  margin: 6px 0; padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  font-size: var(--text-xs); color: var(--text-secondary);
  .dc-cancel { appearance: none; border: none; background: transparent; cursor: pointer; color: var(--text-muted); font-family: inherit; font-size: var(--text-xs); padding: 3px 8px; border-radius: var(--radius-sm); }
  .dc-ok { appearance: none; border: none; background: var(--danger); color: #fff; cursor: pointer; font-family: inherit; font-size: var(--text-xs); padding: 3px 10px; border-radius: var(--radius-sm); }
}
.reply-form {
  display: flex; align-items: center; gap: 8px;
  margin: 8px 0; padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--glass-bg-soft); border: 1px solid var(--glass-border-inset);
}
.reply-form input {
  flex: 1; min-width: 0; border: none; background: transparent; outline: none;
  font-family: inherit; font-size: var(--text-sm); color: var(--text-primary);
}
.reply-form button {
  appearance: none; border: none; cursor: pointer; background: var(--accent); color: #fff;
  padding: 5px 14px; border-radius: var(--radius-full);
  font-family: inherit; font-size: var(--text-xs); font-weight: 600;
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}
.reply-cancel {
  appearance: none; border: none; cursor: pointer; background: transparent !important; color: var(--text-muted) !important;
  font-family: inherit; font-size: var(--text-xs);
}
.reply-list { margin-top: 12px; padding-left: 10px; border-left: 2px solid var(--glass-border-inset); display: flex; flex-direction: column; gap: 14px; }

.comment-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 36px 0; color: var(--text-muted);
  :deep(.anticon) { font-size: 28px; opacity: 0.4; }
  span { font-size: var(--text-sm); }
}

/* ============ 底部操作栏 ============ */
.detail-actions {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 30px; border-top: 1px solid var(--glass-border-inset);
  background: var(--glass-bg-strong);
}
.action-btn {
  appearance: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 7px;
  height: 38px; padding: 0 14px; border-radius: var(--radius-full);
  border: 1px solid var(--glass-border-inset); background: var(--glass-bg-soft);
  font-family: inherit; font-size: var(--text-sm); font-weight: 600;
  color: var(--text-secondary);
  transition: all var(--dur-fast) var(--ease-out);
  :deep(.anticon) { font-size: 16px; }
  &:hover { color: var(--text-primary); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
}
.action-btn.active { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); background: var(--accent-soft); }
.like-btn.active { color: #ec4899; border-color: color-mix(in srgb, #ec4899 40%, transparent); background: color-mix(in srgb, #ec4899 10%, transparent); }
.like-btn.active :deep(.anticon) { color: #ec4899; }
.like-btn.burst :deep(.anticon) { animation: heart-pop 0.42s var(--ease-spring); }
@keyframes heart-pop { 0% { transform: scale(1); } 35% { transform: scale(1.45); } 100% { transform: scale(1); } }
.action-visit {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 7px;
  height: 38px; padding: 0 18px; border-radius: var(--radius-full);
  text-decoration: none; font-size: var(--text-sm); font-weight: 600; color: #fff;
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #e8437a));
  box-shadow: var(--shadow-accent);
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  :deep(.anticon) { font-size: 13px; transform: rotate(45deg); }
  &:hover { transform: translateY(-2px); box-shadow: 0 12px 30px var(--accent-glow); }
}

.detail-toast {
  position: fixed; bottom: 36px; left: 50%; transform: translateX(-50%); z-index: 1300;
  padding: 11px 22px; border-radius: var(--radius-full);
  background: rgba(15, 15, 22, 0.9); backdrop-filter: blur(12px);
  color: #fff; font-size: var(--text-sm); font-weight: 500; box-shadow: var(--shadow-lg);
}

/* transitions */
.detail-fade-enter-active, .detail-fade-leave-active { transition: opacity 0.25s var(--ease-out); }
.detail-fade-enter-from, .detail-fade-leave-to { opacity: 0; }
.detail-pop-enter-active { transition: opacity 0.3s var(--ease-out), transform 0.3s var(--ease-spring); }
.detail-pop-leave-active { transition: opacity 0.2s var(--ease-out), transform 0.2s var(--ease-out); }
.detail-pop-enter-from { opacity: 0; transform: scale(0.94) translateY(12px); }
.detail-pop-leave-to { opacity: 0; transform: scale(0.96); }
.toast-enter-active, .toast-leave-active { transition: opacity 0.25s var(--ease-out), transform 0.25s var(--ease-out); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 16px); }

@media (max-width: 760px) {
  .detail-card { max-width: 100%; max-height: calc(100vh - 32px); }
  .detail-grid { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .detail-visual { min-height: 200px; }
  .visual-appicon { width: 76px; height: 76px; border-radius: 20px; }
  .visual-letter { font-size: 38px; }
  .visual-name { font-size: 20px; }
  .visual-content { gap: 10px; padding: 28px 20px; }
  .body-scroll { padding: 22px 20px 8px; }
  .detail-actions { padding: 12px 20px; flex-wrap: wrap; }
  .action-visit { margin-left: 0; flex: 1; justify-content: center; }
}
@media (prefers-reduced-motion: reduce) {
  .blob-1, .blob-2 { animation: none; }
  .detail-pop-enter-active, .detail-pop-leave-active { transition: opacity 0.2s; }
}
</style>
