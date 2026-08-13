<script setup lang="ts">
// pages/user/[id].vue — 用户主页
// 展示：头像、用户名、简介、统计（帖子/关注/粉丝/获赞/收藏）、
// 关注按钮 + 私信入口、发布的笔记网格。
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  MessageOutlined,
  EditOutlined,
  AppstoreOutlined,
  HeartOutlined,
  StarOutlined,
  UserOutlined,
} from '@ant-design/icons-vue'
import { avatarStyle, avatarStyleFull } from '~/composables/useAvatar'
import { useAuth } from '~/composables/useAuth'
import { useFollows } from '~/composables/useFollows'
import type { Post } from '~/composables/usePosts'
import { apiError } from '~/composables/useApiError'
import FollowButton from '~/components/FollowButton.vue'
import PostCard from '~/components/PostCard.vue'
import PostDetailModal from '~/components/PostDetailModal.vue'
import PostEditorModal from '~/components/PostEditorModal.vue'

const route = useRoute()
const { user: currentUser, isLoggedIn } = useAuth()
const userId = computed(() => route.params.id as string)

interface ProfileData {
  id: string
  username: string
  avatarColor: number
  avatarUrl: string
  backgroundUrl: string
  bio: string
  role: 'admin' | 'user'
  createdAt: number
  isSelf: boolean
  stats: {
    postCount: number
    followingCount: number
    followersCount: number
    totalLikes: number
    totalCollected: number
  }
  isFollowing: boolean
}

const profile = ref<ProfileData | null>(null)
const userPosts = ref<Post[]>([])
const loading = ref(true)
const error = ref('')

// Deterministic gradient for users without a custom background
const bannerGradient = computed(() => {
  const grads = [
    'linear-gradient(135deg,#f2633c,#e8437a)',
    'linear-gradient(135deg,#06b6d4,#3b82f6)',
    'linear-gradient(135deg,#10b981,#06b6d4)',
    'linear-gradient(135deg,#f59e0b,#ef4444)',
    'linear-gradient(135deg,#e8437a,#c2410c)',
    'linear-gradient(135deg,#38bdf8,#0ea5e9)',
  ]
  let h = 0
  for (const ch of (profile.value?.id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return grads[h % grads.length]
})
// Followers / following modal lists
const listOpen = ref(false)
const listMode = ref<'followers' | 'following'>('followers')
const listUsers = ref<{ id: string; username: string; avatarColor: number; bio: string }[]>([])
const listLoading = ref(false)

// Detail modal
const selectedPost = ref<Post | null>(null)
const detailOpen = ref(false)

// Editor modal
const editingPost = ref<Post | null>(null)
const editorOpen = ref(false)

// 私信：复用 app.vue 中唯一的全局 <ChatPanel>，避免重复挂载。
const { openChat } = useChatPanel()

async function loadProfile() {
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<ProfileData>(`/api/users/${userId.value}/profile`)
    profile.value = data
    // Hydrate follows cache for the follow button
    await loadPosts()
  } catch (err: unknown) {
    const e = err as { statusMessage?: string }
    error.value = e?.statusMessage || '用户不存在'
  } finally {
    loading.value = false
  }
}

async function loadPosts() {
  try {
    const all = await $fetch<Post[]>('/api/posts', { params: { userId: userId.value } })
    userPosts.value = all
  } catch {
    userPosts.value = []
  }
}

async function openList(mode: 'followers' | 'following') {
  listMode.value = mode
  listOpen.value = true
  listLoading.value = true
  try {
    const { fetchFollowers, fetchFollowing } = useFollows()
    const users = mode === 'followers' ? await fetchFollowers(userId.value) : await fetchFollowing(userId.value)
    listUsers.value = users
  } catch {
    listUsers.value = []
  } finally {
    listLoading.value = false
  }
}

function openDetail(post: Post) {
  selectedPost.value = post
  detailOpen.value = true
}

async function onToggleLike(post: Post) {
  if (!isLoggedIn.value) return
  if (post.userId === currentUser.value?.id) { message.warning('不能给自己的帖子点赞'); return }
  try {
    const res = await $fetch<{ liked: boolean }>(`/api/posts/${post.id}/like`, { method: 'POST' })
    const uid = currentUser.value?.id
    if (uid) {
      if (res.liked) { if (!post.likedBy.includes(uid)) post.likedBy.push(uid) }
      else { post.likedBy = post.likedBy.filter((u) => u !== uid) }
    }
  } catch (e: unknown) {
    message.error(apiError(e))
  }
}

function startEdit(post: Post) {
  if (!isLoggedIn.value) return
  editingPost.value = post
  editorOpen.value = true
}

async function onPostUpdated(updated: Post) {
  // 同步本地帖子列表与详情弹窗（成功提示由 PostEditorModal 统一给出）
  const idx = userPosts.value.findIndex((p) => p.id === updated.id)
  if (idx !== -1) userPosts.value[idx] = { ...userPosts.value[idx], ...updated }
  if (selectedPost.value?.id === updated.id) {
    selectedPost.value = { ...selectedPost.value, ...updated }
  }
}

function startChat() {
  if (!isLoggedIn.value) return
  openChat(profile.value?.id)
}

function timeFmt(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
}

watch(userId, () => { loadProfile() }, { immediate: false })
onMounted(() => { loadProfile() })

useHead({ title: '用户主页' })
</script>

<template>
  <div class="profile-page">
    <!-- Loading -->
    <div v-if="loading" class="loading-state glass">
      <div class="spinner" />
      <p>加载中…</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="error-state glass-soft">
      <UserOutlined class="err-icon" />
      <h2>{{ error }}</h2>
      <NuxtLink to="/community" class="back-link">返回社区</NuxtLink>
    </div>

    <!-- Profile -->
    <template v-else-if="profile">
      <!-- 背景横幅 -->
      <div class="profile-banner" :class="{ empty: !profile.backgroundUrl }">
        <img v-if="profile.backgroundUrl" :src="profile.backgroundUrl" alt="主页背景" />
        <div v-else class="banner-gradient" :style="{ background: bannerGradient }" />
        <div class="banner-scrim" />
      </div>

      <!-- 顶部信息卡 -->
      <header class="profile-header glass-strong">
        <div class="ph-top">
          <span class="ph-avatar" :style="avatarStyleFull(profile.avatarColor, profile.avatarUrl)">
            <span v-if="!profile.avatarUrl" class="ph-avatar-letter">{{ profile.username.charAt(0).toUpperCase() }}</span>
          </span>
          <div class="ph-info">
            <div class="ph-name-row">
              <h1 class="ph-name">{{ profile.username }}</h1>
              <span v-if="profile.role === 'admin'" class="ph-badge">管理员</span>
            </div>
            <p class="ph-bio">{{ profile.bio || '这个人很懒，什么都没留下' }}</p>
            <span class="ph-joined">加入于 {{ timeFmt(profile.createdAt) }}</span>
          </div>
          <div class="ph-actions">
            <NuxtLink v-if="profile.isSelf" to="/settings" class="ph-btn ghost">
              <EditOutlined /> 编辑资料
            </NuxtLink>
            <template v-else>
              <FollowButton
                :target-user-id="profile.id"
                :initial-following="profile.isFollowing"
                size="default"
                @change="loadProfile"
              />
              <button class="ph-btn" @click="startChat" :disabled="!isLoggedIn">
                <MessageOutlined /> 私信
              </button>
            </template>
          </div>
        </div>

        <!-- 统计 -->
        <div class="ph-stats">
          <button class="stat-item" @click="openList('followers')">
            <strong>{{ profile.stats.followersCount }}</strong>
            <span>粉丝</span>
          </button>
          <button class="stat-item" @click="openList('following')">
            <strong>{{ profile.stats.followingCount }}</strong>
            <span>关注</span>
          </button>
          <div class="stat-item static">
            <strong>{{ profile.stats.postCount }}</strong>
            <span>笔记</span>
          </div>
          <div class="stat-item static">
            <strong>{{ profile.stats.totalLikes }}</strong>
            <span>获赞</span>
          </div>
          <div class="stat-item static">
            <strong>{{ profile.stats.totalCollected }}</strong>
            <span>被收藏</span>
          </div>
        </div>
      </header>

      <!-- 笔记网格 -->
      <section class="posts-section">
        <h2 class="section-title">
          <AppstoreOutlined /> TA的笔记 ({{ userPosts.length }})
        </h2>
        <div v-if="userPosts.length" class="posts-grid">
          <PostCard
            v-for="post in userPosts"
            :key="post.id"
            :post="post"
            :current-user-id="currentUser?.id"
            @click="openDetail(post)"
            @toggle-like="onToggleLike(post)"
          />
        </div>
        <div v-else class="empty-posts glass-soft">
          <AppstoreOutlined class="empty-icon" />
          <p>{{ profile.isSelf ? '你还没有发布笔记' : 'TA还没有发布笔记' }}</p>
          <NuxtLink v-if="profile.isSelf" to="/community" class="ph-btn">去发布</NuxtLink>
        </div>
      </section>
    </template>

    <!-- 粉丝/关注列表弹窗 -->
    <a-modal
      :open="listOpen"
      @update:open="(v: boolean) => (listOpen = v)"
      :footer="null"
      :title="listMode === 'followers' ? '粉丝' : '关注'"
      :width="440"
      centered
      :destroy-on-close="true"
    >
      <div class="user-list">
        <div v-if="listLoading" class="list-loading">加载中…</div>
        <NuxtLink
          v-for="u in listUsers"
          :key="u.id"
          :to="`/user/${u.id}`"
          class="user-list-item"
          @click="listOpen = false"
        >
          <span class="ul-avatar" :style="avatarStyle(u.avatarColor)">{{ u.username.charAt(0).toUpperCase() }}</span>
          <div class="ul-info">
            <span class="ul-name">{{ u.username }}</span>
            <span class="ul-bio">{{ u.bio || '暂无简介' }}</span>
          </div>
        </NuxtLink>
        <div v-if="!listLoading && !listUsers.length" class="list-empty">暂无{{ listMode === 'followers' ? '粉丝' : '关注' }}</div>
      </div>
    </a-modal>

    <!-- 详情弹窗 -->
    <PostDetailModal v-model:open="detailOpen" :post="selectedPost" @toggle-like="onToggleLike" @edit="startEdit" />

    <!-- 发帖/编辑弹窗 -->
    <PostEditorModal v-model:open="editorOpen" :post="editingPost" @updated="onPostUpdated" />
  </div>
</template>

<style scoped lang="less">
.profile-page { max-width: 1000px; margin: 0 auto; padding: 24px 20px 60px; min-height: 60vh; }

/* ── Background banner ── */
.profile-banner {
  position: relative; height: 240px; border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  overflow: hidden; margin-bottom: -50px; z-index: 1;
}
.profile-banner img { width: 100%; height: 100%; object-fit: cover; display: block; }
.banner-gradient { width: 100%; height: 100%; }
.banner-scrim {
  position: absolute; inset: 0;
  background: linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.35));
}

.loading-state, .error-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 60px; border-radius: var(--radius-xl); text-align: center;
}
.spinner {
  width: 36px; height: 36px; border: 3px solid var(--border-color);
  border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.err-icon { font-size: 48px; color: var(--text-muted); }
.error-state h2 { margin: 0; color: var(--text-secondary); }
.back-link { color: var(--accent); text-decoration: none; font-weight: 600; }
.back-link:hover { text-decoration: underline; }

/* ── Header ── */
.profile-header {
  border-radius: var(--radius-xl); padding: 28px; margin-bottom: 28px;
  position: relative; z-index: 2;
}
.ph-top { display: flex; gap: 22px; align-items: flex-start; flex-wrap: wrap; }
.ph-avatar {
  width: 92px; height: 92px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 36px; font-weight: 700;
  box-shadow: var(--shadow-md); overflow: hidden;
  border: 4px solid var(--bg-surface);
}
.ph-info { flex: 1; min-width: 200px; }
.ph-name-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ph-name { margin: 0; font-size: var(--text-2xl); font-weight: 700; color: var(--text-primary); }
.ph-badge {
  background: var(--accent-soft); color: var(--accent);
  font-size: var(--text-xs); font-weight: 600; padding: 2px 10px; border-radius: var(--radius-full);
}
.ph-bio { margin: 8px 0; font-size: var(--text-sm); color: var(--text-secondary); line-height: var(--leading-snug); }
.ph-joined { font-size: var(--text-xs); color: var(--text-muted); }

.ph-actions { display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; }
.ph-btn {
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--accent); color: #fff; border: none; border-radius: var(--radius-full);
  padding: 8px 18px; font-size: var(--text-sm); font-weight: 600; cursor: pointer;
  transition: all var(--dur-fast); text-decoration: none;
}
.ph-btn:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }
.ph-btn.ghost { background: var(--glass-bg-strong); color: var(--text-secondary); border: 1px solid var(--border-color); }
.ph-btn.ghost:hover { color: var(--accent); border-color: var(--accent); }
.ph-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.ph-stats {
  display: flex; gap: 8px; margin-top: 22px; padding-top: 20px;
  border-top: 1px solid var(--border-color); flex-wrap: wrap;
}
.stat-item {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  background: none; border: none; cursor: pointer; padding: 8px 18px;
  border-radius: var(--radius-md); transition: background var(--dur-fast);
}
.stat-item:not(.static):hover { background: var(--accent-soft); }
.stat-item.static { cursor: default; }
.stat-item strong { font-size: var(--text-lg); font-weight: 700; color: var(--text-primary); }
.stat-item span { font-size: var(--text-xs); color: var(--text-muted); }

/* ── Posts ── */
.section-title {
  font-size: var(--text-lg); font-weight: 700; color: var(--text-primary);
  margin: 0 0 16px; display: flex; align-items: center; gap: 8px;
}
.posts-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;
}
.posts-grid :deep(.post-card) { margin-bottom: 0; }

.empty-posts {
  text-align: center; padding: 48px 20px; border-radius: var(--radius-xl);
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.empty-icon { font-size: 40px; color: var(--text-muted); }
.empty-posts p { margin: 0 0 12px; color: var(--text-secondary); }

/* ── User list modal ── */
.user-list { max-height: 420px; overflow-y: auto; }
.list-loading, .list-empty { text-align: center; padding: 30px; color: var(--text-muted); }
.user-list-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 8px;
  border-radius: var(--radius-md); text-decoration: none; transition: background var(--dur-fast);
}
.user-list-item:hover { background: var(--accent-soft); }
.ul-avatar {
  width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600; font-size: var(--text-sm);
}
.ul-info { display: flex; flex-direction: column; min-width: 0; }
.ul-name { font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }
.ul-bio { font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

@media (max-width: 600px) {
  .ph-top { flex-direction: column; align-items: center; text-align: center; }
  .ph-info { text-align: center; }
  .ph-name-row { justify-content: center; }
  .ph-actions { justify-content: center; }
}
</style>
