<script setup lang="ts">
// PostEditorModal.vue — 发帖编辑器（标题 / 正文 / 多图上传 / 标签 / 封面选择）
// 封面选择逻辑（统一列表）：
//   selectedCover = 'generated'              → 主题大图做封面
//   selectedCover = 数字索引（0,1,2...）      → 对应的上传图片做封面（排第一位）
//   无图片时 selectedCover 强制为 'generated'
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { message } from 'ant-design-vue'
import {
  PictureOutlined,
  VideoCameraOutlined,
  PlusOutlined,
  CloseOutlined,
  DeleteOutlined,
  SendOutlined,
  StarOutlined,
  StarFilled,
} from '@ant-design/icons-vue'
import { usePosts, type Post } from '~/composables/usePosts'
import { useAuth } from '~/composables/useAuth'

const props = defineProps<{ open: boolean; post?: Post | null }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'created'): void; (e: 'updated', post: Post): void }>()

const { createPost, updatePost } = usePosts()
const { isLoggedIn, openAuthModal } = useAuth()

const title = ref('')
const content = ref('')
const images = ref<string[]>([])
const videos = ref<string[]>([])
const tags = ref<string[]>([])
const tagInput = ref('')
const uploading = ref(false)
const submitting = ref(false)

// 待上传文件（选择后仅本地预览，点击「发布」时才统一上传）
interface PendingFile { file: File; preview: string; kind: 'image' | 'video' }
const pendingFiles = ref<PendingFile[]>([])

// ── 封面控制 ──
// selectedCover: 'generated' = 用主题大图做封面; 数字 = 用对应索引的上传图片做封面
const selectedCover = ref<'generated' | number>('generated')
// 主题封面配色
const gradientPalettes = [
  { from: '#ff9a5c', to: '#f2633c', name: '霞光' },
  { from: '#f093fb', to: '#f5576c', name: '粉色' },
  { from: '#4facfe', to: '#00f2fe', name: '青色' },
  { from: '#43e97b', to: '#38f9d7', name: '绿色' },
  { from: '#fa709a', to: '#fee140', name: '橙粉' },
  { from: '#30cfd0', to: '#330867', name: '深蓝' },
  { from: '#a8edea', to: '#fed6e3', name: '薄荷粉' },
  { from: '#ff9a9e', to: '#fecfef', name: '浅粉' },
  { from: '#ffecd2', to: '#fcb69f', name: '暖橙' },
  { from: '#a1c4fd', to: '#c2e9fb', name: '天蓝' },
]
const selectedGradient = ref(0)

// 统一图片列表：已上传 images + 待上传 pendingFiles 中的图片，用于封面索引
// selectedCover 的数字索引基于此列表（generated 仍为字符串 'generated'）
const allImages = computed(() => {
  const uploaded = images.value.map((url) => ({ url, pending: false }))
  const pending = pendingFiles.value.filter((p) => p.kind === 'image').map((p) => ({ url: p.preview, pending: true, file: p.file }))
  return [...uploaded, ...pending]
})

const imageCount = computed(() => allImages.value.length)
// 当图片被删光时，selectedCover 自动切回 generated
watch(imageCount, (n) => {
  if (n === 0) selectedCover.value = 'generated'
  else if (typeof selectedCover.value === 'number' && selectedCover.value >= n) {
    selectedCover.value = Math.max(0, n - 1)
  }
}, { immediate: true })

// 是否生成主题封面：用户选了 generated，或者没有任何图片时强制
const wantGen = computed(() => selectedCover.value === 'generated' || imageCount.value === 0)

// ── 主题封面预览（防抖，避免每次按键请求服务端）──
const coverPreviewUrl = ref('')
let coverPreviewTimer: ReturnType<typeof setTimeout> | null = null
function updateCoverPreview() {
  if (!title.value.trim()) { coverPreviewUrl.value = ''; return }
  if (coverPreviewTimer) clearTimeout(coverPreviewTimer)
  coverPreviewTimer = setTimeout(() => {
    const t = encodeURIComponent(title.value.trim() || '未填写标题')
    const c = encodeURIComponent(content.value.trim().slice(0, 100))
    const tg = encodeURIComponent(tags.value.join(','))
    coverPreviewUrl.value = `/api/poster/cover?title=${t}&content=${c}&tags=${tg}&gradient=${selectedGradient.value}&t=${Date.now()}`
  }, 400)
}
watch([title, content, tags, selectedGradient], updateCoverPreview, { immediate: true })

const fileInput = ref<HTMLInputElement | null>(null)
const isEditing = computed(() => !!props.post?.id)

// 进入弹窗时重置
watch(() => props.open, (v) => {
  if (!v) return
  const p = props.post
  title.value = p?.title ?? ''
  content.value = p?.content ?? ''
  images.value = p ? [...(p.images || [])] : []
  videos.value = p ? [...(p.videos || [])] : []
  tags.value = p ? [...(p.tags || [])] : []
  tagInput.value = ''
  for (const pf of pendingFiles.value) URL.revokeObjectURL(pf.preview)
  pendingFiles.value = []
  selectedGradient.value = 0
  // 有图片默认用第一张做封面；无图片用主题大图
  selectedCover.value = (p && p.images?.length > 0) ? 0 : 'generated'
})

// 组件卸载时回收预览 blob URL 与防抖计时器，避免内存泄漏。
onBeforeUnmount(() => {
  if (coverPreviewTimer) clearTimeout(coverPreviewTimer)
  for (const pf of pendingFiles.value) URL.revokeObjectURL(pf.preview)
})

const canSubmit = computed(() => !!title.value.trim() && !!content.value.trim() && !submitting.value)
const totalMedia = computed(() => images.value.length + videos.value.length + pendingFiles.value.length)
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.ogg', '.ogv'])

function close() { emit('update:open', false) }

function pickFiles() {
  if (!isLoggedIn.value) { openAuthModal(); return }
  fileInput.value?.click()
}

// 选择文件 → 仅本地预览，不立即上传
function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  for (const file of Array.from(input.files)) {
    if (totalMedia.value >= 9) { message.warning('最多上传 9 个文件'); break }
    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase()
    const kind: 'image' | 'video' = VIDEO_EXTS.has(ext) ? 'video' : 'image'
    if (kind === 'video') {
      const vc = videos.value.length + pendingFiles.value.filter((p) => p.kind === 'video').length
      if (vc >= 4) { message.warning('最多上传 4 个视频'); continue }
    }
    pendingFiles.value.push({ file, preview: URL.createObjectURL(file), kind })
  }
  // 第一次添加图片时，自动选第一张做封面
  if (selectedCover.value === 'generated' && imageCount.value > 0) selectedCover.value = 0
  input.value = ''
}

// 从统一图片列表中删除指定索引的图片（自动判断是已上传还是待上传）
function removeImageItem(unifiedIndex: number) {
  const uploadedCount = images.value.length
  if (unifiedIndex < uploadedCount) {
    // 已上传图片
    images.value.splice(unifiedIndex, 1)
  } else {
    // 待上传图片
    const pendingIdx = unifiedIndex - uploadedCount
    const pendingImages = pendingFiles.value.filter((p) => p.kind === 'image')
    const target = pendingImages[pendingIdx]
    if (target) {
      const realIdx = pendingFiles.value.indexOf(target)
      URL.revokeObjectURL(target.preview)
      pendingFiles.value.splice(realIdx, 1)
    }
  }
  // 封面索引修正由 imageCount watcher 自动处理
}

function removeImage(i: number) {
  images.value.splice(i, 1)
}
function removePending(i: number) {
  const pf = pendingFiles.value[i]
  if (pf) URL.revokeObjectURL(pf.preview)
  pendingFiles.value.splice(i, 1)
}
function removeVideo(i: number) { videos.value.splice(i, 1) }

function addTag() {
  const t = tagInput.value.trim()
  if (!t) return
  if (tags.value.includes(t)) { tagInput.value = ''; return }
  if (tags.value.length >= 10) { message.warning('最多 10 个标签'); return }
  tags.value.push(t)
  tagInput.value = ''
}
function removeTag(i: number) { tags.value.splice(i, 1) }

// ── 发布/更新 ──
async function submit() {
  if (!isLoggedIn.value) { openAuthModal(); return }
  if (!canSubmit.value) return
  submitting.value = true
  try {
    // 1. 上传所有待传文件（点击「发布」时才真正请求 /api/upload）
    if (pendingFiles.value.length > 0) {
      uploading.value = true
      for (const pf of pendingFiles.value) {
        const fd = new FormData()
        fd.append('file', pf.file)
        try {
          const res = await $fetch<{ url: string; kind: string }>('/api/upload?purpose=post', { method: 'POST', body: fd })
          if (pf.kind === 'video') videos.value.push(res.url)
          else images.value.push(res.url)
        } catch {
          message.error(`文件「${pf.file.name}」上传失败`)
        }
      }
      for (const pf of pendingFiles.value) URL.revokeObjectURL(pf.preview)
      pendingFiles.value = []
      uploading.value = false
    }

    // 2. 封面逻辑 — 把用户选的封面图排到 images[0]
    //    selectedCover='generated' → 后端生成主题封面插到第一位
    //    selectedCover=数字        → 该图片排第一位做封面，后端不生成（除非无图）
    const useGen = wantGen.value
    let finalImages = [...images.value]
    if (!useGen && typeof selectedCover.value === 'number') {
      const idx = selectedCover.value
      if (idx > 0 && idx < finalImages.length) {
        const [picked] = finalImages.splice(idx, 1)
        finalImages = [picked, ...finalImages]
      }
    }

    const payload = {
      title: title.value.trim(),
      content: content.value.trim(),
      images: finalImages,
      videos: videos.value,
      tags: tags.value,
      coverGradient: selectedGradient.value,
      useCoverGen: useGen,
    }
    if (isEditing.value && props.post) {
      const updated = await updatePost(props.post.id, payload)
      message.success('已更新')
      emit('updated', updated)
    } else {
      await createPost(payload)
      message.success('发布成功！')
      emit('created')
    }
    close()
  } catch (err: unknown) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    message.error(msg || '操作失败，请重试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <a-modal
    :open="open"
    @update:open="(v: boolean) => emit('update:open', v)"
    :footer="null"
    :width="600"
    :title="null"
    :closable="false"
    :destroy-on-close="true"
    wrap-class-name="post-editor-modal"
    centered
  >
    <div class="editor">
      <!-- 渐变标题条 -->
      <header class="editor-head">
        <div class="eh-title">
          <span class="eh-icon"><PlusOutlined /></span>
          <h2>{{ isEditing ? '编辑笔记' : '发布笔记' }}</h2>
        </div>
        <button class="close-btn" @click="close" aria-label="关闭"><CloseOutlined /></button>
      </header>

      <!-- 图片上传区 -->
      <div class="images-section">
        <div class="section-label">
          <PictureOutlined />
          <span>添加图片/视频</span>
          <span class="section-counter">{{ totalMedia }} / 9</span>
        </div>
        <div class="images-grid">
          <!-- 统一图片列表：已上传 + 待上传，均可选为封面 -->
          <div v-for="(img, i) in allImages" :key="'img-'+i" class="img-item" :class="{ 'is-cover': selectedCover === i }" @click="selectedCover = i">
            <img :src="img.url" alt="" />
            <span v-if="img.pending" class="pending-badge">待上传</span>
            <button class="img-del" @click.stop="removeImageItem(i)" aria-label="删除"><DeleteOutlined /></button>
            <button class="cover-badge" :class="{ active: selectedCover === i }" @click.stop="selectedCover = i" :title="selectedCover === i ? '当前封面' : '设为封面'">
              <StarFilled v-if="selectedCover === i" />
              <StarOutlined v-else />
            </button>
            <span v-if="selectedCover === i" class="cover-tag">封面</span>
          </div>
          <!-- 视频 -->
          <div v-for="(vid, i) in videos" :key="'vid-'+i" class="img-item video-item">
            <video :src="vid" preload="metadata" />
            <span class="vid-badge"><VideoCameraOutlined /> 视频</span>
            <button class="img-del" @click="removeVideo(i)" aria-label="删除"><DeleteOutlined /></button>
          </div>
          <!-- 待上传视频 -->
          <div v-for="(pf, i) in pendingFiles.filter(p => p.kind === 'video')" :key="'pend-vid-'+i" class="img-item video-item">
            <video :src="pf.preview" preload="metadata" />
            <span class="vid-badge"><VideoCameraOutlined /> 视频</span>
            <button class="img-del" @click="removePending(pendingFiles.indexOf(pf))" aria-label="删除"><DeleteOutlined /></button>
            <span class="pending-badge">待上传</span>
          </div>
          <!-- 上传按钮 -->
          <button v-if="totalMedia < 9" class="img-add" @click="pickFiles" :disabled="uploading || submitting">
            <div v-if="uploading" class="spinner" />
            <template v-else>
              <PlusOutlined class="add-icon" />
              <span class="add-text">添加</span>
            </template>
          </button>
        </div>

        <!-- 主题封面大图卡片（有标题时显示，可被选为封面） -->
        <Transition name="slide-fade">
          <div v-if="title.trim()" class="cover-gen-card" :class="{ 'is-cover': selectedCover === 'generated' }" @click="selectedCover = 'generated'">
            <div class="cgc-preview">
              <img :src="coverPreviewUrl" alt="主题封面" class="cgc-img" :key="coverPreviewUrl" />
              <button class="cover-badge" :class="{ active: selectedCover === 'generated' }" @click.stop="selectedCover = 'generated'" :title="selectedCover === 'generated' ? '当前封面' : '设为封面'">
                <StarFilled v-if="selectedCover === 'generated'" />
                <StarOutlined v-else />
              </button>
              <span v-if="selectedCover === 'generated'" class="cover-tag">封面</span>
            </div>
            <div class="cgc-controls">
              <div class="cgc-header">
                <span class="cgc-label"><StarOutlined /> 主题文字大图</span>
                <span class="cgc-sub">根据标题内容自动生成</span>
              </div>
              <div class="gradient-picker">
                <button
                  v-for="(g, i) in gradientPalettes"
                  :key="i"
                  class="gp-swatch"
                  :class="{ active: selectedGradient === i }"
                  :style="{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }"
                  :title="g.name"
                  @click.stop="selectedGradient = i"
                />
              </div>
            </div>
          </div>
        </Transition>

        <p class="hint">点击 ★ 选择封面 · 最多 9 个文件（图片 ≤ 8MB，视频 ≤ 100MB）</p>
        <input ref="fileInput" type="file" accept="image/*,video/*" multiple hidden @change="onFiles" />
      </div>

      <!-- 标题 -->
      <div class="field">
        <label class="field-label">标题</label>
        <input
          v-model="title"
          class="title-input"
          type="text"
          maxlength="100"
          placeholder="填写标题更能吸引注意哦"
        />
      </div>

      <!-- 正文 -->
      <div class="field">
        <label class="field-label">正文内容</label>
        <textarea
          v-model="content"
          class="content-input"
          rows="5"
          maxlength="5000"
          placeholder="分享你的想法、经历或发现…"
        />
        <div class="char-count">{{ content.length }} / 5000</div>
      </div>

      <!-- 标签 -->
      <div class="field">
        <label class="field-label">标签</label>
        <div class="tags-row">
          <span v-for="(t, i) in tags" :key="t" class="tag-chip">
            #{{ t }}
            <button class="tag-x" @click="removeTag(i)" aria-label="移除标签"><CloseOutlined /></button>
          </span>
          <input
            v-model="tagInput"
            class="tag-input"
            type="text"
            maxlength="20"
            placeholder="输入标签后回车"
            @keydown.enter.prevent="addTag"
          />
        </div>
      </div>

      <!-- 底部操作 -->
      <footer class="editor-foot">
        <div class="foot-info">
          <span class="fi-item"><PictureOutlined /> {{ imageCount }} 图</span>
          <span class="fi-sep">·</span>
          <span class="fi-item">{{ tags.length }} 标签</span>
          <span v-if="selectedCover === 'generated'" class="fi-cover">封面：主题大图</span>
          <span v-else class="fi-cover">封面：图 {{ (selectedCover as number) + 1 }}</span>
        </div>
        <button class="publish-btn" :disabled="!canSubmit" @click="submit">
          <span v-if="submitting" class="btn-spinner" />
          <SendOutlined v-else />
          {{ isEditing ? '保存' : '发布' }}
        </button>
      </footer>
    </div>
  </a-modal>
</template>

<style scoped lang="less">
.editor {
  display: flex; flex-direction: column; gap: 16px;
  padding: 2px;
}

/* ── 标题条 ── */
.editor-head {
  display: flex; align-items: center; justify-content: space-between;
  padding-bottom: 12px; margin-bottom: 4px;
  border-bottom: 1px solid var(--border-color);
}
.eh-title { display: flex; align-items: center; gap: 10px; }
.eh-icon {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 10px;
  background: var(--accent-soft); color: var(--accent); font-size: 16px;
}
.editor-head h2 { font-size: var(--text-lg); font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.close-btn {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border: none; border-radius: 8px;
  background: var(--bg-subtle); color: var(--text-muted); cursor: pointer;
  font-size: 13px; transition: all var(--dur-fast);
}
.close-btn:hover { background: var(--danger); color: #fff; }

/* ── 区块通用 ── */
.section-label {
  display: flex; align-items: center; gap: 6px;
  font-size: var(--text-sm); font-weight: 600; color: var(--text-secondary);
  margin-bottom: 8px;
}
.section-counter { margin-left: auto; font-size: var(--text-xs); color: var(--text-muted); font-weight: 400; }
.field-label {
  font-size: var(--text-sm); font-weight: 600; color: var(--text-secondary);
  margin-bottom: 6px; display: block;
}

/* ── 图片网格 ── */
.images-section { display: flex; flex-direction: column; }
.images-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
  min-height: 80px;
}
.img-item {
  position: relative; aspect-ratio: 1; border-radius: var(--radius-md); overflow: hidden;
  border: 2px solid transparent; background: var(--bg-subtle);
  cursor: pointer; transition: all var(--dur-fast);
}
.img-item:hover { border-color: var(--border-strong); transform: translateY(-1px); }
.img-item.is-cover {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow-sm);
}
.img-item img, .img-item video { width: 100%; height: 100%; object-fit: cover; }
.img-del {
  position: absolute; top: 5px; right: 5px; width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
  border: none; border-radius: 7px; color: #fff;
  cursor: pointer; font-size: 11px; opacity: 0;
  transition: all var(--dur-fast); z-index: 3;
}
.img-item:hover .img-del { opacity: 1; }
.img-del:hover { background: var(--danger); }
.cover-badge {
  position: absolute; top: 5px; left: 5px; width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.45); backdrop-filter: blur(4px);
  border: none; border-radius: 7px; color: rgba(255,255,255,0.7);
  cursor: pointer; font-size: 12px; z-index: 2;
  transition: all var(--dur-fast);
}
.cover-badge:hover { background: rgba(0,0,0,0.7); color: #fff; }
.cover-badge.active { background: var(--accent); color: #fff; box-shadow: 0 2px 8px var(--accent-glow); }
.cover-tag {
  position: absolute; bottom: 5px; left: 5px;
  padding: 2px 8px; font-size: 10px; font-weight: 600;
  color: #fff; background: var(--accent);
  border-radius: 5px; backdrop-filter: blur(4px); z-index: 2;
}
.vid-badge {
  position: absolute; bottom: 5px; right: 5px; padding: 2px 7px;
  font-size: 10px; font-weight: 500; color: #fff;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(4px); border-radius: 5px;
}
.pending-badge {
  position: absolute; bottom: 5px; right: 5px; padding: 2px 7px;
  font-size: 10px; font-weight: 500; color: #fff;
  background: var(--info); border-radius: 5px;
}
.img-add {
  aspect-ratio: 1; border: 2px dashed var(--border-strong); border-radius: var(--radius-md);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  background: transparent; cursor: pointer; color: var(--text-muted);
  transition: all var(--dur-fast);
}
.img-add:hover:not(:disabled) {
  border-color: var(--accent); color: var(--accent);
  background: var(--accent-soft); transform: scale(1.02);
}
.img-add:disabled { opacity: 0.4; cursor: not-allowed; }
.add-icon { font-size: 22px; }
.add-text { font-size: 10px; font-weight: 500; }

/* ── 主题封面卡片 ── */
.cover-gen-card {
  display: flex; gap: 14px; padding: 12px;
  border-radius: var(--radius-lg);
  border: 2px solid var(--border-color); background: var(--bg-subtle);
  cursor: pointer; transition: all var(--dur);
  margin-top: 10px;
}
.cover-gen-card:hover { border-color: var(--border-strong); background: var(--bg-surface); }
.cover-gen-card.is-cover {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 4px 16px rgba(99,102,241,0.1);
}
.cgc-preview {
  position: relative; width: 90px; height: 120px; flex-shrink: 0;
  border-radius: var(--radius-md); overflow: hidden;
  background: var(--bg-surface); box-shadow: var(--shadow-sm);
}
.cgc-img { width: 100%; height: 100%; object-fit: cover; }
.cgc-controls { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 10px; }
.cgc-header { display: flex; flex-direction: column; gap: 2px; }
.cgc-label { font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 5px; }
.cgc-sub { font-size: var(--text-xs); color: var(--text-muted); }
.gradient-picker { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.gp-swatch {
  width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--bg-surface);
  cursor: pointer; transition: all var(--dur-fast);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.gp-swatch.active { transform: scale(1.2); box-shadow: 0 2px 8px rgba(0,0,0,0.2); border-color: var(--text-primary); }
.gp-swatch:hover { transform: scale(1.15); }

/* slide-fade 过渡 */
.slide-fade-enter-active, .slide-fade-leave-active { transition: all 0.3s var(--ease-out); }
.slide-fade-enter-from, .slide-fade-leave-to { opacity: 0; transform: translateY(-8px); }

/* ── 提示文字 ── */
.hint { font-size: var(--text-xs); color: var(--text-muted); margin: 6px 0 0; line-height: 1.5; }

/* ── 输入框 ── */
.field { display: flex; flex-direction: column; }
.title-input {
  width: 100%; padding: 11px 14px;
  border: 1.5px solid var(--border-color); border-radius: var(--radius-md);
  font-size: var(--text-md); font-weight: 500; background: var(--bg-surface); color: var(--text-primary);
  outline: none; transition: all var(--dur-fast);
}
.title-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.title-input::placeholder { color: var(--text-muted); font-weight: 400; }
.content-input {
  width: 100%; padding: 11px 14px;
  border: 1.5px solid var(--border-color); border-radius: var(--radius-md);
  font-size: var(--text-sm); line-height: 1.6; background: var(--bg-surface); color: var(--text-primary);
  outline: none; resize: vertical; min-height: 90px; font-family: var(--font-sans);
  transition: all var(--dur-fast);
}
.content-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.content-input::placeholder { color: var(--text-muted); }
.char-count { font-size: var(--text-xs); color: var(--text-muted); text-align: right; margin-top: 4px; }

/* ── 标签 ── */
.tags-row {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  padding: 8px 10px; border: 1.5px solid var(--border-color); border-radius: var(--radius-md);
  min-height: 44px; transition: all var(--dur-fast);
}
.tags-row:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.tag-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 6px 4px 10px;
  background: var(--accent-soft); color: var(--accent);
  border-radius: var(--radius-full); font-size: var(--text-xs); font-weight: 600;
  transition: all var(--dur-fast);
}
.tag-chip:hover { background: rgba(99,102,241,0.15); }
.tag-x {
  display: flex; align-items: center; justify-content: center;
  width: 16px; height: 16px;
  border: none; background: rgba(99,102,241,0.15); color: var(--accent);
  cursor: pointer; font-size: 9px; border-radius: 50%; line-height: 1;
  transition: all var(--dur-fast);
}
.tag-x:hover { background: var(--danger); color: #fff; }
.tag-input { border: none; outline: none; background: none; font-size: var(--text-sm); color: var(--text-primary); flex: 1; min-width: 100px; }
.tag-input::placeholder { color: var(--text-muted); }

/* ── 底部操作栏 ── */
.editor-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0 0; margin-top: 4px;
  border-top: 1px solid var(--border-color);
}
.foot-info { display: flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--text-muted); }
.fi-item { display: flex; align-items: center; gap: 3px; }
.fi-sep { opacity: 0.5; }
.fi-cover { margin-left: 8px; padding: 2px 8px; background: var(--accent-soft); color: var(--accent); border-radius: var(--radius-full); font-weight: 500; }
.publish-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 28px;
  border: none; border-radius: var(--radius-full);
  background: var(--accent); color: #fff;
  font-size: var(--text-sm); font-weight: 600; letter-spacing: 0.01em;
  cursor: pointer; transition: all var(--dur-fast);
  box-shadow: var(--shadow-sm);
}
.publish-btn:hover:not(:disabled) {
  background: var(--accent-hover); transform: translateY(-1px);
  box-shadow: var(--shadow-accent);
}
.publish-btn:active:not(:disabled) { transform: translateY(0); }
.publish-btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }

/* ── 加载动画 ── */
.spinner {
  width: 20px; height: 20px;
  border: 2px solid rgba(99,102,241,0.2);
  border-top-color: var(--accent);
  border-radius: 50%; animation: spin 0.6s linear infinite;
}
.btn-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%; animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
