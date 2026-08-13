<script setup lang="ts">
// PostCard.vue — 小红书风格瀑布流卡片
import { computed } from 'vue'
import { HeartOutlined, MessageOutlined, PictureOutlined, PlayCircleFilled } from '@ant-design/icons-vue'
import type { Post } from '~/composables/usePosts'
import { avatarStyle } from '~/composables/useAvatar'

const props = defineProps<{
  post: Post
  currentUserId?: string
}>()
const emit = defineEmits<{ (e: 'click', post: Post): void; (e: 'toggle-like', post: Post): void }>()

const liked = computed(() => props.currentUserId ? props.post.likedBy.includes(props.currentUserId) : false)
const isOwn = computed(() => !!(props.currentUserId && props.post.userId === props.currentUserId))
const likeCount = computed(() => props.post.likedBy.length)
const cover = computed(() => props.post.images[0] || '')
const hasVideo = computed(() => (props.post.videos?.length ?? 0) > 0)
const videoCover = computed(() => props.post.videos?.[0] || '')
const mediaCount = computed(() => (props.post.images?.length ?? 0) + (props.post.videos?.length ?? 0))
const placeholderGrad = computed(() => {
  const grads = [
    'linear-gradient(135deg,#ff9a5c,#f2633c)',
    'linear-gradient(135deg,#f2633c,#e8437a)',
    'linear-gradient(135deg,#ffc53d,#f59e0b)',
    'linear-gradient(135deg,#10b981,#0d9488)',
    'linear-gradient(135deg,#e8437a,#c2410c)',
    'linear-gradient(135deg,#38bdf8,#0ea5e9)',
  ]
  let h = 0
  for (const ch of props.post.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return grads[h % grads.length]
})

function onClick() { emit('click', props.post) }
function onLike(e: Event) {
  e.stopPropagation()
  // 不能给自己的帖子点赞
  if (props.currentUserId && props.post.userId === props.currentUserId) return
  emit('toggle-like', props.post)
}

const titleLine = computed(() => props.post.title)
// Excerpt: first ~60 chars of content, single line
const excerpt = computed(() => props.post.content.replace(/\n/g, ' ').slice(0, 60))
</script>

<template>
  <article class="post-card enter-up" :style="{ '--d': '0s' }" @click="onClick">
    <div class="cover">
      <!-- Video cover (priority: video shows first) -->
      <video v-if="hasVideo && videoCover" :src="videoCover" preload="metadata" muted />
      <!-- Image cover -->
      <img v-else-if="cover" :src="cover" :alt="post.title" loading="lazy" />
      <!-- Placeholder -->
      <div v-else class="cover-placeholder" :style="{ background: placeholderGrad }">
        <PictureOutlined class="placeholder-icon" />
      </div>
      <!-- Play icon for videos -->
      <span v-if="hasVideo" class="play-overlay"><PlayCircleFilled /></span>
      <span v-if="mediaCount > 1" class="img-count">{{ mediaCount }} 个内容</span>
    </div>
    <div class="body">
      <h3 class="title">{{ titleLine }}</h3>
      <p v-if="excerpt" class="excerpt">{{ excerpt }}{{ post.content.length > 60 ? '…' : '' }}</p>
      <div v-if="post.tags.length" class="tags">
        <NuxtLink v-for="t in post.tags.slice(0, 3)" :key="t" :to="`/topic/${encodeURIComponent(t)}`" class="tag" @click.stop>#{{ t }}</NuxtLink>
      </div>
      <div class="footer">
        <NuxtLink :to="`/user/${post.userId}`" class="author" @click.stop>
          <span class="avatar" :style="avatarStyle(post.avatarColor)">{{ post.username.charAt(0).toUpperCase() }}</span>
          <span class="name">{{ post.username }}</span>
        </NuxtLink>
        <div class="stats">
          <button class="stat" :class="{ liked, disabled: isOwn }" :disabled="isOwn" :title="isOwn ? '不能给自己的帖子点赞' : (liked ? '取消点赞' : '点赞')" @click="onLike">
            <HeartOutlined />
            <span v-if="likeCount">{{ likeCount }}</span>
          </button>
          <span class="stat muted">
            <MessageOutlined />
            <span v-if="post.commentCount">{{ post.commentCount }}</span>
          </span>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped lang="less">
.post-card {
  break-inside: avoid;
  margin-bottom: 16px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-sm);
  transition: transform var(--dur) var(--ease-out), box-shadow var(--dur) var(--ease-out);
  display: block;
  width: 100%;
}
.post-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.cover {
  position: relative;
  width: 100%;
  overflow: hidden;
  background: var(--bg-subtle);
}
.cover img, .cover video {
  display: block;
  width: 100%;
  height: auto;
  transition: transform var(--dur-slow) var(--ease-out);
}
.cover video { object-fit: cover; aspect-ratio: 4 / 3; background: #000; }
.post-card:hover .cover img, .post-card:hover .cover video {
  transform: scale(1.05);
}
.play-overlay {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 42px; color: rgba(255,255,255,0.9);
  filter: drop-shadow(0 2px 8px rgba(0,0,0,0.4));
  pointer-events: none; z-index: 2;
  transition: transform var(--dur) var(--ease-out);
}
.post-card:hover .play-overlay { transform: translate(-50%, -50%) scale(1.1); }
.cover-placeholder {
  width: 100%;
  aspect-ratio: 4 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
}
.placeholder-icon {
  font-size: 38px;
  color: rgba(255, 255, 255, 0.85);
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.2));
}
.img-count {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: var(--text-xs);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  backdrop-filter: blur(6px);
}

.body {
  padding: 12px 14px 10px;
}
.title {
  font-family: var(--font-display);
  font-size: var(--text-md);
  font-weight: 600;
  line-height: var(--leading-snug);
  color: var(--text-primary);
  margin: 0 0 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  transition: color var(--dur-fast) var(--ease-out);
}
.post-card:hover .title { color: var(--accent); }
.excerpt {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: var(--leading-snug);
  margin: 0 0 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}
.tag {
  font-size: var(--text-xs);
  color: var(--accent);
  background: var(--accent-soft);
  padding: 1px 7px;
  border-radius: var(--radius-full);
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.author {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.name {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.stat {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  transition: color var(--dur-fast);
}
.stat:hover { color: var(--danger); }
.stat.liked { color: var(--danger); }
.stat.disabled,
.stat:disabled { opacity: 0.4; cursor: not-allowed; }
.stat.disabled:hover,
.stat:disabled:hover { color: var(--text-secondary); }
.stat.muted { cursor: default; }
.stat.muted:hover { color: var(--text-secondary); }
</style>
