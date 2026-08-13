<template>
  <div class="comments-section">
    <h2 class="section-title">
      <MessageOutlined /> 用户评论
    </h2>

    <!-- Comment form -->
    <div v-if="contentId" class="comment-form">
      <a-textarea
        v-model:value="newComment"
        :placeholder="isLoggedIn ? '写下你的想法…' : '请先登录后评论'"
        :rows="3"
        :disabled="!isLoggedIn || submitting"
        :maxlength="2000"
        @pressEnter="onEnter"
      />
      <div class="form-footer">
        <span class="char-hint">{{ newComment.length }} / 2000</span>
        <button
          class="submit-btn"
          :disabled="!isLoggedIn || !newComment.trim() || submitting"
          @click="submitComment"
        >
          {{ submitting ? '发布中…' : '发布评论' }}
        </button>
      </div>
    </div>

    <!-- No selection prompt -->
    <div v-else class="no-selection">
      <MessageOutlined class="ns-icon" />
      <p>选择一个应用，查看并参与讨论</p>
    </div>

    <!-- Comments list -->
    <div v-if="contentId" class="comments-list">
      <div v-if="loading" class="loading-hint">加载中…</div>
      <div v-else-if="!comments.length" class="empty-hint">
        还没有评论，来抢沙发吧
      </div>
      <div v-else class="comment-card" v-for="c in comments" :key="c.id">
        <div class="comment-avatar" :style="avatarBg(c.avatarColor)">{{ (c.username || '?')[0]?.toUpperCase() }}</div>
        <div class="comment-body">
          <div class="comment-meta">
            <span class="comment-author">{{ c.username }}</span>
            <span class="comment-date">{{ timeFmt(c.createdAt) }}</span>
          </div>
          <p class="comment-text">{{ c.text }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { MessageOutlined } from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';
import { useAuth } from '~/composables/useAuth';

const AVATAR_PALETTE = [
  ['#f2633c', '#e8437a'],
  ['#06b6d4', '#3b82f6'],
  ['#10b981', '#34d399'],
  ['#f59e0b', '#fbbf24'],
  ['#e8437a', '#c2410c'],
  ['#38bdf8', '#0ea5e9'],
];

const props = defineProps<{ contentId?: string }>();

const { isLoggedIn, user, openAuthModal } = useAuth();
const newComment = ref('');
const comments = ref<Array<{ id: string; text: string; username: string; userId: string; avatarColor: number; createdAt: number }>>([]);
const loading = ref(false);
const submitting = ref(false);

function avatarBg(color: number) {
  const p = AVATAR_PALETTE[color % AVATAR_PALETTE.length];
  return `background: linear-gradient(135deg, ${p[0]}, ${p[1]})`;
}

function timeFmt(ts: number) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

async function fetchComments() {
  if (!props.contentId) { comments.value = []; return; }
  loading.value = true;
  try {
    const data = await $fetch<unknown[]>('/api/comments', { params: { contentId: props.contentId } });
    comments.value = Array.isArray(data) ? data as typeof comments.value : [];
  } catch {
    comments.value = [];
  } finally {
    loading.value = false;
  }
}

async function submitComment() {
  const text = newComment.value.trim();
  if (!isLoggedIn.value) { openAuthModal(); return; }
  if (!text || submitting.value) return;
  submitting.value = true;
  try {
    const c = await $fetch<typeof comments.value[number]>('/api/comments', {
      method: 'POST',
      body: { contentId: props.contentId, text, targetType: 'content' },
    });
    comments.value = [c, ...comments.value];
    newComment.value = '';
    message.success('评论成功');
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; statusMessage?: string };
    const msg = err?.data?.statusMessage || err?.statusMessage || '评论失败';
    message.error(msg);
  } finally {
    submitting.value = false;
  }
}

function onEnter(e: KeyboardEvent) {
  // Shift+Enter for newline, Enter to submit
  if (e.shiftKey) return;
  e.preventDefault();
  submitComment();
}

watch(() => props.contentId, fetchComments, { immediate: false });
onMounted(fetchComments);
</script>

<style scoped>
.comments-section {
  max-width: 720px;
  margin: 40px auto;
  padding: 0 20px;
}

.section-title {
  font-size: var(--text-xl);
  font-weight: 700;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.comment-form {
  margin-bottom: 28px;
}

.form-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.char-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.submit-btn {
  padding: 8px 20px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-weight: 600;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), opacity var(--dur-fast);
}

.submit-btn:hover:not(:disabled) { background: var(--accent-hover); }
.submit-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.no-selection {
  text-align: center;
  padding: 48px 20px;
  color: var(--text-muted);
}

.ns-icon { font-size: 32px; margin-bottom: 8px; }
.no-selection p { margin: 0; font-size: var(--text-sm); }

.loading-hint, .empty-hint {
  text-align: center;
  padding: 32px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.comment-card {
  display: flex;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--border-color);
}

.comment-avatar {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: var(--text-md);
}

.comment-body { flex: 1; min-width: 0; }

.comment-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.comment-author {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.comment-date {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.comment-text {
  margin: 0;
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
