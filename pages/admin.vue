<script setup lang="ts">
// 后台管理：内容 / 分组 / 标签 三张表的完整 CRUD。
//
// 稳健性策略（彻底规避 ant-design-vue 在本 Nuxt 项目 SSR 下屡发的
// 切换失效 / cssinjs 尺寸错乱 / 自动引入水合错乱问题）：
// - 本页【不使用任何 antd 组件】，全部用原生 Vue + scoped CSS 自绘
//   （Tabs / Table / Modal / Select / 评分 / 通知 / 确认框）。
// - 图标仍用 @ant-design/icons-vue 显式引入（该库在本项目 SSR 稳定，
//   application.vue / Header / Sider 均已验证）。
// - 数据层走已加固的 /api/* 接口（原子写入、只读降级、并发互斥）。
// - 页面 SSR 安全：首屏渲染空表 + 加载态，数据在 onMounted（仅客户端）拉取；
//   弹窗 / 通知初始均不可见，SSR 不产生多余 DOM，零水合错配。
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useTheme } from '~/composables/useTheme'
import { useAuth } from '~/composables/useAuth'
import { useContentStore } from '~/stores/contentStore'
import { useMenuStore } from '~/stores/menuStore'
import { apiError } from '~/composables/useApiError'
import {
  DashboardOutlined,
  FileTextOutlined,
  AppstoreOutlined,
  TagsOutlined,
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  LinkOutlined,
  InboxOutlined,
  LeftOutlined,
  RightOutlined,
  CloseOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  InfoCircleFilled,
  LockOutlined,
} from '@ant-design/icons-vue'

definePageMeta({ title: '后台管理' })

const { themeMode } = useTheme()
const contentStore = useContentStore()
const menuStore = useMenuStore()

const { user, isLoggedIn, isAdmin, fetchMe, openAuthModal } = useAuth()
// 权限守卫：检查登录态与角色。loading = 正在判定；denied = 已登录但非 admin
const authState = ref<'loading' | 'denied' | 'denied-not-logged-in' | 'ok'>('loading')
const isDark = computed(() => themeMode.value === 'dark')

const activeTab = ref<'content' | 'category' | 'tag'>('content')
const PAGE_SIZE = 10

// ─────────────────────────── 通用 UI ───────────────────────────
// 轻量通知（替代 antd message）
interface Toast { id: number; type: 'success' | 'error' | 'warning' | 'info'; text: string }
const toasts = ref<Toast[]>([])
let toastSeq = 0
function notify(type: Toast['type'], text: string) {
  const id = ++toastSeq
  toasts.value.push({ id, type, text })
  setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id) }, 3200)
}
const ok = (t: string) => notify('success', t)
const err = (t: string) => notify('error', t)
const warn = (t: string) => notify('warning', t)

// 轻量确认框（替代 antd Modal.confirm），返回布尔
const confirmState = reactive({
  visible: false,
  title: '',
  content: '',
  okText: '确定',
  cancelText: '取消',
  danger: false,
  loading: false,
})
let confirmResolver: ((v: boolean) => void) | null = null
function showConfirm(opts: { title: string; content: string; okText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    confirmResolver = resolve
    Object.assign(confirmState, {
      visible: true,
      title: opts.title,
      content: opts.content,
      okText: opts.okText || '确定',
      cancelText: '取消',
      danger: !!opts.danger,
      loading: false,
    })
  })
}
function closeConfirm(result: boolean) {
  confirmState.visible = false
  if (confirmResolver) {
    const r = confirmResolver
    confirmResolver = null
    r(result)
  }
}

// 分页工具
function totalPages(total: number, size: number) {
  return Math.max(1, Math.ceil(total / size))
}
function pagedItems<T>(list: T[], page: number, size: number): T[] {
  const start = (page - 1) * size
  return list.slice(start, start + size)
}
function pageWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const set = new Set<number>([1, total, current, current - 1, current + 1])
  const arr = [...set].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  for (let i = 0; i < arr.length; i++) {
    if (i > 0 && arr[i] - arr[i - 1] > 1) out.push('…')
    out.push(arr[i])
  }
  return out
}
function errMsg(e: unknown): string {
  return apiError(e)
}

// ─────────────────────────── 内容管理 ───────────────────────────
const contentLoading = ref(false)
const contentList = ref<any[]>([])
const searchText = ref('')
const filterCategory = ref<string>('')
const filterTag = ref<string>('')
const contentPage = ref(1)

async function loadContent() {
  contentLoading.value = true
  try {
    const data = await $fetch<any[]>('/api/content')
    contentList.value = Array.isArray(data) ? data : []
  } catch (e: any) {
    err('加载内容失败：' + errMsg(e))
    contentList.value = contentStore.contentItems as any[]
  } finally {
    contentLoading.value = false
  }
}

const contentCategoryFilterOptions = computed(() =>
  Array.from(new Set(contentList.value.map((i) => i.category).filter(Boolean))).map((c) => {
    const hit = contentList.value.find((i) => i.category === c)
    return { value: c, label: hit?.category_zh || c }
  }),
)
const contentTagFilterOptions = computed(() => {
  const m = new Map<string, string>()
  contentList.value.forEach((i) => {
    if (i.subCategory && !m.has(i.subCategory)) m.set(i.subCategory, i.subCategory_zh || '')
  })
  return Array.from(m, ([value, label]) => ({ value, label: label || value }))
})

const filteredContent = computed(() => {
  const kw = searchText.value.trim().toLowerCase()
  return contentList.value.filter((item) => {
    const matchSearch =
      !kw ||
      (item.name || '').toLowerCase().includes(kw) ||
      (item.name_zh || '').toLowerCase().includes(kw)
    const matchCat = !filterCategory.value || item.category === filterCategory.value
    const matchTag = !filterTag.value || item.subCategory === filterTag.value
    return matchSearch && matchCat && matchTag
  })
})
const totalContentPages = computed(() => totalPages(filteredContent.value.length, PAGE_SIZE))
const pagedFilteredContent = computed(() => pagedItems(filteredContent.value, contentPage.value, PAGE_SIZE))
const contentPageWindow = computed(() => pageWindow(contentPage.value, totalContentPages.value))

const defaultContentForm = () => ({
  id: null as string | null,
  category: '',
  category_zh: '',
  subCategory: '',
  subCategory_zh: '',
  name: '',
  name_zh: '',
  content: '',
  content_zh: '',
  detail: '',
  detail_zh: '',
  url: '',
  rating: 0,
})
const contentForm = reactive(defaultContentForm())
const hoverRating = ref(0)
const contentModalVisible = ref(false)
const contentSaving = ref(false)
const contentIsEdit = ref(false)

function openContentCreate() {
  Object.assign(contentForm, defaultContentForm())
  contentIsEdit.value = false
  contentModalVisible.value = true
}
function openContentEdit(record: any) {
  Object.assign(contentForm, defaultContentForm(), {
    id: record.id ?? null,
    category: record.category || '',
    category_zh: record.category_zh || '',
    subCategory: record.subCategory || '',
    subCategory_zh: record.subCategory_zh || '',
    name: record.name || '',
    content_zh: record.content_zh || '',
    detail: record.detail || '',
    detail_zh: record.detail_zh || '',
    content: record.content || '',
    url: record.url || '',
    rating: Number(record.rating) || 0,
  })
  contentIsEdit.value = true
  contentModalVisible.value = true
}
function onContentCategoryInput() {
  const cat = menuStore.menuItems.find((c) => c.title === contentForm.category)
  contentForm.category_zh = cat ? cat.title_zh : ''
}
function onContentTagInput() {
  const tag = tagsList.value.find((t) => t.name === contentForm.subCategory)
  if (tag) {
    contentForm.subCategory_zh = tag.name_zh || tag.name
    if (!contentForm.category && tag.category) {
      contentForm.category = tag.category
      contentForm.category_zh = tag.category_zh || ''
    }
  } else {
    // 自由输入的新标签：中文名默认同英文名
    contentForm.subCategory_zh = contentForm.subCategory_zh || contentForm.subCategory
  }
}

async function saveContent() {
  if (!contentForm.name?.trim()) { warn('请填写名称'); return }
  contentSaving.value = true
  try {
    const body = {
      category: contentForm.category.trim() || 'Uncategorized',
      category_zh: contentForm.category_zh.trim() || '未分类',
      subCategory: contentForm.subCategory.trim() || 'General',
      subCategory_zh: contentForm.subCategory_zh.trim() || '通用',
      name: contentForm.name.trim(),
      name_zh: (contentForm.name_zh || contentForm.name).trim(),
      content: contentForm.content || '',
      content_zh: contentForm.content_zh || contentForm.content || '',
      detail: contentForm.detail || '',
      detail_zh: contentForm.detail_zh || contentForm.detail || '',
      url: contentForm.url.trim(),
      rating: Number(contentForm.rating) || 0,
    }
    if (contentIsEdit.value && contentForm.id) {
      await $fetch(`/api/content/${contentForm.id}`, { method: 'PUT', body })
      ok('内容已更新')
    } else {
      await $fetch('/api/content', { method: 'POST', body })
      ok('内容已新增')
    }
    contentModalVisible.value = false
    await Promise.all([loadContent(), contentStore.fetchContent()])
  } catch (e: any) {
    err('保存失败：' + errMsg(e))
  } finally {
    contentSaving.value = false
  }
}

async function onDeleteContent(record: any) {
  const yes = await showConfirm({
    title: '删除内容',
    content: `确认删除内容「${record.name_zh || record.name}」？该操作不可撤销。`,
    okText: '删除',
    danger: true,
  })
  if (!yes) return
  try {
    await $fetch(`/api/content/${record.id}`, { method: 'DELETE' })
    ok('内容已删除')
    await Promise.all([loadContent(), contentStore.fetchContent()])
  } catch (e: any) {
    err('删除失败：' + errMsg(e))
  }
}

// ─────────────────────────── 分组管理 ───────────────────────────
const catLoading = ref(false)
const categoryList = ref<any[]>([])
const catPage = ref(1)

async function loadCategories() {
  catLoading.value = true
  try {
    const data = await $fetch<any[]>('/api/categories')
    categoryList.value = Array.isArray(data) ? data : []
  } catch (e: any) {
    err('加载分组失败：' + errMsg(e))
    categoryList.value = menuStore.menuItems as any[]
  } finally {
    catLoading.value = false
  }
}

const categoryCountMap = computed(() => {
  const m = new Map<string, number>()
  contentList.value.forEach((i) => {
    if (i.category) m.set(i.category, (m.get(i.category) || 0) + 1)
  })
  return m
})
const totalCatPages = computed(() => totalPages(categoryList.value.length, PAGE_SIZE))
const pagedCategories = computed(() => pagedItems(categoryList.value, catPage.value, PAGE_SIZE))
const catPageWindow = computed(() => pageWindow(catPage.value, totalCatPages.value))

const iconSuggestions = [
  'AppstoreOutlined', 'CodeOutlined', 'FormatPainterOutlined', 'LaptopOutlined',
  'CameraOutlined', 'SoundOutlined', 'RocketOutlined', 'BookOutlined',
  'DatabaseOutlined', 'CloudOutlined', 'ToolOutlined', 'StarOutlined',
  'FireOutlined', 'ThunderboltOutlined', 'ShopOutlined', 'GlobalOutlined',
  'SafetyOutlined', 'ExperimentOutlined', 'BulbOutlined', 'SkinOutlined',
]

const defaultCatForm = () => ({ id: null as string | null, title: '', title_zh: '', icon: 'AppstoreOutlined' })
const catForm = reactive(defaultCatForm())
const catModalVisible = ref(false)
const catSaving = ref(false)
const catIsEdit = ref(false)

function openCatCreate() {
  Object.assign(catForm, defaultCatForm())
  catIsEdit.value = false
  catModalVisible.value = true
}
function openCatEdit(record: any) {
  Object.assign(catForm, defaultCatForm(), {
    id: record.id ?? null,
    title: record.title || '',
    title_zh: record.title_zh || '',
    icon: record.icon || 'AppstoreOutlined',
  })
  catIsEdit.value = true
  catModalVisible.value = true
}
async function saveCategory() {
  if (!catForm.title?.trim()) { warn('请填写英文名'); return }
  catSaving.value = true
  try {
    const body = {
      title: catForm.title.trim(),
      title_zh: (catForm.title_zh || catForm.title).trim(),
      icon: catForm.icon.trim() || 'AppstoreOutlined',
    }
    if (catIsEdit.value && catForm.id) {
      await $fetch(`/api/categories/${catForm.id}`, { method: 'PUT', body })
      ok('分组已更新')
    } else {
      await $fetch('/api/categories', { method: 'POST', body })
      ok('分组已新增')
    }
    catModalVisible.value = false
    await Promise.all([loadCategories(), menuStore.fetchMenu()])
  } catch (e: any) {
    err('保存失败：' + errMsg(e))
  } finally {
    catSaving.value = false
  }
}
async function onDeleteCategory(record: any) {
  const count = categoryCountMap.value.get(record.title) || 0
  const yes = await showConfirm({
    title: '删除分组',
    content:
      count > 0
        ? `分组「${record.title_zh || record.title}」下还有 ${count} 条内容。删除分组不会级联删除这些内容（内容将变为「未分组」状态）。确认继续？`
        : `确认删除分组「${record.title_zh || record.title}」？`,
    okText: '删除',
    danger: true,
  })
  if (!yes) return
  try {
    await $fetch(`/api/categories/${record.id}`, { method: 'DELETE' })
    ok('分组已删除')
    await Promise.all([loadCategories(), menuStore.fetchMenu()])
  } catch (e: any) {
    err('删除失败：' + errMsg(e))
  }
}

// ─────────────────────────── 标签管理 ───────────────────────────
const tagLoading = ref(false)
const tagsList = ref<any[]>([])
const tagSearch = ref('')
const tagFilterCategory = ref<string>('')
const tagPage = ref(1)

async function loadTags() {
  tagLoading.value = true
  try {
    const data = await $fetch<any[]>('/api/tags')
    tagsList.value = Array.isArray(data) ? data : []
  } catch (e: any) {
    err('加载标签失败：' + errMsg(e))
    tagsList.value = []
  } finally {
    tagLoading.value = false
  }
}

const tagRefCountMap = computed(() => {
  const m = new Map<string, number>()
  contentList.value.forEach((i) => {
    if (i.subCategory) m.set(i.subCategory, (m.get(i.subCategory) || 0) + 1)
  })
  return m
})
const tagCategoryOptions = computed(() => {
  const m = new Map<string, string>()
  tagsList.value.forEach((t) => {
    if (t.category) m.set(t.category, t.category_zh || t.category)
  })
  return Array.from(m, ([value, label]) => ({ value, label }))
})
const filteredTags = computed(() => {
  const kw = tagSearch.value.trim().toLowerCase()
  return tagsList.value.filter((t) => {
    const matchSearch =
      !kw ||
      (t.name || '').toLowerCase().includes(kw) ||
      (t.name_zh || '').toLowerCase().includes(kw)
    const matchCat = !tagFilterCategory.value || t.category === tagFilterCategory.value
    return matchSearch && matchCat
  })
})
const totalTagPages = computed(() => totalPages(filteredTags.value.length, PAGE_SIZE))
const pagedFilteredTags = computed(() => pagedItems(filteredTags.value, tagPage.value, PAGE_SIZE))
const tagPageWindow = computed(() => pageWindow(tagPage.value, totalTagPages.value))

const defaultTagForm = () => ({
  id: null as string | null,
  name: '',
  name_zh: '',
  category: '',
  category_zh: '',
})
const tagForm = reactive(defaultTagForm())
const tagModalVisible = ref(false)
const tagSaving = ref(false)
const tagIsEdit = ref(false)

function openTagCreate() {
  Object.assign(tagForm, defaultTagForm())
  tagIsEdit.value = false
  tagModalVisible.value = true
}
function openTagEdit(record: any) {
  Object.assign(tagForm, defaultTagForm(), {
    id: record.id ?? null,
    name: record.name || '',
    name_zh: record.name_zh || '',
    category: record.category || '',
    category_zh: record.category_zh || '',
  })
  tagIsEdit.value = true
  tagModalVisible.value = true
}
function onTagCategoryInput() {
  const cat = menuStore.menuItems.find((c) => c.title === tagForm.category)
  tagForm.category_zh = cat ? cat.title_zh : ''
}
async function saveTag() {
  if (!tagForm.name?.trim()) { warn('请填写标签名'); return }
  tagSaving.value = true
  try {
    const body = {
      name: tagForm.name.trim(),
      name_zh: (tagForm.name_zh || tagForm.name).trim(),
      category: tagForm.category.trim(),
      category_zh: tagForm.category_zh.trim(),
    }
    if (tagIsEdit.value && tagForm.id) {
      await $fetch(`/api/tags/${tagForm.id}`, { method: 'PUT', body })
      ok('标签已更新')
    } else {
      await $fetch('/api/tags', { method: 'POST', body })
      ok('标签已新增')
    }
    tagModalVisible.value = false
    await loadTags()
  } catch (e: any) {
    err('保存失败：' + errMsg(e))
  } finally {
    tagSaving.value = false
  }
}
async function onDeleteTag(tag: any) {
  const count = tagRefCountMap.value.get(tag.name) || 0
  const yes = await showConfirm({
    title: '删除标签',
    content:
      count > 0
        ? `标签「${tag.name_zh || tag.name}」当前被 ${count} 条内容引用。删除仅移除标签定义，不会影响已引用它的内容。确认继续？`
        : `确认删除标签「${tag.name_zh || tag.name}」？该标签当前未被任何内容引用。`,
    okText: '删除',
    danger: true,
  })
  if (!yes) return
  try {
    await $fetch(`/api/tags/${tag.id}`, { method: 'DELETE' })
    ok('标签已删除')
    await loadTags()
  } catch (e: any) {
    err('删除失败：' + errMsg(e))
  }
}

// ─────────────────────────── 全局 ───────────────────────────
const anyLoading = computed(() => contentLoading.value || catLoading.value || tagLoading.value)
// ─────────────────────────── 数字滚动动效 ───────────────────────────
// SSR 安全：rAF 缓动仅客户端有意义；watch 在 SSR 不会触发（onMounted 不执行）。
function useCountUp(source: () => number) {
  const display = ref(source())
  let raf = 0
  watch(source, (to, prev = 0) => {
    const from = prev || 0
    cancelAnimationFrame(raf)
    const start = performance.now()
    const dur = 650
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      display.value = Math.round(from + (to - from) * eased)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    if (import.meta.client) raf = requestAnimationFrame(step)
    else display.value = to
  })
  return display
}
const contentCount = useCountUp(() => contentList.value.length)
const categoryCount = useCountUp(() => categoryList.value.length)
const tagCount = useCountUp(() => tagsList.value.length)

async function refreshAll(silent = false) {
  await Promise.all([
    loadContent(),
    loadCategories(),
    loadTags(),
    contentStore.fetchContent(),
    menuStore.fetchMenu(),
  ])
  if (!silent) ok('数据已刷新')
}

// 筛选条件变化时回到第一页；列表收缩时夹紧页码
watch([searchText, filterCategory, filterTag], () => { contentPage.value = 1 })
watch([tagSearch, tagFilterCategory], () => { tagPage.value = 1 })
watch(() => filteredContent.value.length, () => {
  if (contentPage.value > totalContentPages.value) contentPage.value = totalContentPages.value
})
watch(() => filteredTags.value.length, () => {
  if (tagPage.value > totalTagPages.value) tagPage.value = totalTagPages.value
})
watch(() => categoryList.value.length, () => {
  if (catPage.value > totalCatPages.value) catPage.value = totalCatPages.value
})

// Esc 关闭最上层弹窗 / 确认框
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (confirmState.visible) { closeConfirm(false); return }
  if (contentModalVisible.value && !contentSaving.value) contentModalVisible.value = false
  else if (catModalVisible.value && !catSaving.value) catModalVisible.value = false
  else if (tagModalVisible.value && !tagSaving.value) tagModalVisible.value = false
}
onMounted(async () => {
  // 权限守卫：先确认登录态与角色，通过后才加载数据
  await fetchMe()
  if (!isLoggedIn.value) {
    authState.value = 'denied-not-logged-in'
    return
  }
  if (!isAdmin.value) {
    authState.value = 'denied'
    return
  }
  authState.value = 'ok'
  window.addEventListener('keydown', onKeydown)
  refreshAll(true)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="admin-page" :class="{ dark: isDark }">
    <!-- 权限守卫：非 admin 显示拒绝/加载界面 -->
    <div v-if="authState === 'loading'" class="guard-screen">
      <span class="guard-spinner" />
      <p>正在验证权限…</p>
    </div>
    <div v-else-if="authState === 'denied-not-logged-in'" class="guard-screen">
      <LockOutlined class="guard-icon" />
      <h2 class="guard-title">需要登录</h2>
      <p class="guard-text">后台管理仅限管理员访问，请先登录管理员账号。</p>
      <button class="btn btn-primary" @click="openAuthModal">登录</button>
    </div>
    <div v-else-if="authState === 'denied'" class="guard-screen">
      <LockOutlined class="guard-icon" />
      <h2 class="guard-title">权限不足</h2>
      <p class="guard-text">当前账号（{{ user?.username }}）没有管理员权限，无法访问后台管理。</p>
      <nuxt-link to="/application" class="btn btn-ghost">返回应用推荐</nuxt-link>
    </div>
    <template v-else>
    <!-- 顶部品牌栏 -->
    <header class="admin-hero surface enter-up" style="--d:0s">
      <div class="hero-brand">
        <div class="hero-icon"><DashboardOutlined /></div>
        <div class="hero-text">
          <h1 class="hero-title">后台管理</h1>
          <p class="hero-sub">应用推荐 · 内容 / 分组 / 标签 可视化管理中枢</p>
        </div>
      </div>
      <button class="btn btn-primary hero-refresh" :disabled="anyLoading" @click="() => refreshAll()">
        <ReloadOutlined :spin="anyLoading" /> 刷新数据
      </button>
    </header>

    <!-- 概览统计卡片 -->
    <div class="stat-grid">
      <button
        class="stat-card surface enter-up"
        :class="{ active: activeTab === 'content' }"
        style="--d:0.06s"
        @click="activeTab = 'content'"
      >
        <span class="stat-icon stat-icon-indigo"><FileTextOutlined /></span>
        <span class="stat-meta">
          <span class="stat-num">{{ contentList.length }}</span>
        </span>
        <span class="stat-spark" />
      </button>
      <button
        class="stat-card surface enter-up"
        :class="{ active: activeTab === 'category' }"
        style="--d:0.12s"
        @click="activeTab = 'category'"
      >
        <span class="stat-icon stat-icon-cyan"><AppstoreOutlined /></span>
        <span class="stat-meta">
          <span class="stat-num">{{ categoryList.length }}</span>
          <span class="stat-label">内容分组</span>
        </span>
        <span class="stat-spark" />
      </button>
      <button
        class="stat-card surface enter-up"
        :class="{ active: activeTab === 'tag' }"
        style="--d:0.18s"
        @click="activeTab = 'tag'"
      >
        <span class="stat-icon stat-icon-violet"><TagsOutlined /></span>
        <span class="stat-meta">
          <span class="stat-num">{{ tagsList.length }}</span>
          <span class="stat-label">预定义标签</span>
        </span>
        <span class="stat-spark" />
      </button>
    </div>

    <!-- 标签栏 -->
    <nav class="admin-tabs enter-up" role="tablist" style="--d:0.24s">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'content' }"
        role="tab"
        @click="activeTab = 'content'"
      ><FileTextOutlined /> 内容管理</button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'category' }"
        role="tab"
        @click="activeTab = 'category'"
      ><AppstoreOutlined /> 分组管理</button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'tag' }"
        role="tab"
        @click="activeTab = 'tag'"
      ><TagsOutlined /> 标签管理</button>
    </nav>

    <!-- ========== 内容管理 ========== -->
    <section v-show="activeTab === 'content'" class="panel">
      <div class="toolbar surface">
        <div class="field search-field">
          <SearchOutlined class="field-icon" />
          <input v-model="searchText" type="text" placeholder="按名称搜索" />
        </div>
        <select v-model="filterCategory" class="field">
          <option value="">全部分组</option>
          <option v-for="o in contentCategoryFilterOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <select v-model="filterTag" class="field">
          <option value="">全部标签</option>
          <option v-for="o in contentTagFilterOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <div class="toolbar-spacer" />
        <button class="btn btn-primary" @click="openContentCreate"><PlusOutlined /> 新增内容</button>
      </div>

      <div class="table-card surface">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th class="col-name">名称</th>
                <th class="col-cat">分组</th>
                <th class="col-tag">标签</th>
                <th class="col-url">URL</th>
                <th class="col-rating">评分</th>
                <th class="col-action">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in pagedFilteredContent" :key="item.id || item.name">
                <td class="col-name">
                  <div class="name-zh">{{ item.name_zh || item.name }}</div>
                  <div class="name-en">{{ item.name }}</div>
                </td>
                <td>
                  <div class="cat-zh">{{ item.category_zh || item.category }}</div>
                  <div class="cat-en">{{ item.category }}</div>
                </td>
                <td><span class="chip chip-indigo">{{ item.subCategory_zh || item.subCategory }}</span></td>
                <td class="col-url">
                  <a v-if="item.url" :href="item.url" target="_blank" rel="noopener" class="url-link">
                    <LinkOutlined /> <span class="url-text">{{ item.url }}</span>
                  </a>
                  <span v-else class="muted">—</span>
                </td>
                <td>
                  <span class="stars readonly">
                    <span
                      v-for="n in 5"
                      :key="n"
                      class="star"
                      :class="{ on: n <= (item.rating || 0) }"
                    >★</span>
                  </span>
                </td>
                <td class="col-action">
                  <button class="btn-link" @click="openContentEdit(item)"><EditOutlined /> 编辑</button>
                  <button class="btn-link danger" @click="onDeleteContent(item)"><DeleteOutlined /> 删除</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!contentLoading && !filteredContent.length" class="table-empty">
            <InboxOutlined /><span>暂无内容</span>
          </div>
          <div v-if="contentLoading" class="table-loading"><span class="spinner" /></div>
        </div>

        <div v-if="filteredContent.length" class="pagination">
          <span class="page-info">共 {{ filteredContent.length }} 条 · 第 {{ contentPage }} / {{ totalContentPages }} 页</span>
          <div class="page-controls">
            <button class="page-btn" :disabled="contentPage <= 1" @click="contentPage--"><LeftOutlined /></button>
            <button
              v-for="(p, i) in contentPageWindow"
              :key="i"
              class="page-btn"
              :class="{ active: p === contentPage, ellipsis: p === '…' }"
              :disabled="p === '…'"
              @click="typeof p === 'number' && (contentPage = p)"
            >{{ p }}</button>
            <button class="page-btn" :disabled="contentPage >= totalContentPages" @click="contentPage++"><RightOutlined /></button>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== 分组管理 ========== -->
    <section v-show="activeTab === 'category'" class="panel">
      <div class="toolbar surface">
        <span class="toolbar-title">共 {{ categoryList.length }} 个分组</span>
        <div class="toolbar-spacer" />
        <button class="btn btn-primary" @click="openCatCreate"><PlusOutlined /> 新增分组</button>
      </div>

      <div class="table-card surface">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>中文名</th>
                <th>英文名</th>
                <th class="col-icon">图标</th>
                <th class="col-count">内容数</th>
                <th class="col-action">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in pagedCategories" :key="item.id || item.title">
                <td class="strong">{{ item.title_zh || item.title }}</td>
                <td class="muted-en">{{ item.title }}</td>
                <td><span class="chip chip-blue">{{ item.icon }}</span></td>
                <td>
                  <span class="chip" :class="(categoryCountMap.get(item.title) || 0) > 0 ? 'chip-cyan' : 'chip-default'">
                    {{ categoryCountMap.get(item.title) || 0 }}
                  </span>
                </td>
                <td class="col-action">
                  <button class="btn-link" @click="openCatEdit(item)"><EditOutlined /> 编辑</button>
                  <button class="btn-link danger" @click="onDeleteCategory(item)"><DeleteOutlined /> 删除</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!catLoading && !categoryList.length" class="table-empty">
            <InboxOutlined /><span>暂无分组</span>
          </div>
          <div v-if="catLoading" class="table-loading"><span class="spinner" /></div>
        </div>

        <div v-if="categoryList.length" class="pagination">
          <span class="page-info">共 {{ categoryList.length }} 条 · 第 {{ catPage }} / {{ totalCatPages }} 页</span>
          <div class="page-controls">
            <button class="page-btn" :disabled="catPage <= 1" @click="catPage--"><LeftOutlined /></button>
            <button
              v-for="(p, i) in catPageWindow"
              :key="i"
              class="page-btn"
              :class="{ active: p === catPage, ellipsis: p === '…' }"
              :disabled="p === '…'"
              @click="typeof p === 'number' && (catPage = p)"
            >{{ p }}</button>
            <button class="page-btn" :disabled="catPage >= totalCatPages" @click="catPage++"><RightOutlined /></button>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== 标签管理 ========== -->
    <section v-show="activeTab === 'tag'" class="panel">
      <div class="toolbar surface">
        <div class="field search-field">
          <SearchOutlined class="field-icon" />
          <input v-model="tagSearch" type="text" placeholder="按标签名 / 中文名搜索" />
        </div>
        <select v-model="tagFilterCategory" class="field">
          <option value="">全部分组</option>
          <option v-for="o in tagCategoryOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <span class="toolbar-title">{{ filteredTags.length }} / {{ tagsList.length }}</span>
        <div class="toolbar-spacer" />
        <button class="btn btn-primary" @click="openTagCreate"><PlusOutlined /> 新增标签</button>
      </div>

      <div class="table-card surface">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th class="col-name">标签名</th>
                <th>中文名</th>
                <th class="col-cat">所属分组</th>
                <th class="col-count">引用次数</th>
                <th class="col-action">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in pagedFilteredTags" :key="item.id || item.name">
                <td class="strong">{{ item.name }}</td>
                <td>{{ item.name_zh || '—' }}</td>
                <td>
                  <template v-if="item.category">
                    <div class="cat-zh">{{ item.category_zh || item.category }}</div>
                    <div class="cat-en">{{ item.category }}</div>
                  </template>
                  <span v-else class="muted">未分组</span>
                </td>
                <td>
                  <span class="chip" :class="(tagRefCountMap.get(item.name) || 0) > 0 ? 'chip-purple' : 'chip-default'">
                    {{ tagRefCountMap.get(item.name) || 0 }}
                  </span>
                </td>
                <td class="col-action">
                  <button class="btn-link" @click="openTagEdit(item)"><EditOutlined /> 编辑</button>
                  <button class="btn-link danger" @click="onDeleteTag(item)"><DeleteOutlined /> 删除</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!tagLoading && !filteredTags.length" class="table-empty">
            <InboxOutlined /><span>暂无标签</span>
          </div>
          <div v-if="tagLoading" class="table-loading"><span class="spinner" /></div>
        </div>

        <div v-if="filteredTags.length" class="pagination">
          <span class="page-info">共 {{ filteredTags.length }} 条 · 第 {{ tagPage }} / {{ totalTagPages }} 页</span>
          <div class="page-controls">
            <button class="page-btn" :disabled="tagPage <= 1" @click="tagPage--"><LeftOutlined /></button>
            <button
              v-for="(p, i) in tagPageWindow"
              :key="i"
              class="page-btn"
              :class="{ active: p === tagPage, ellipsis: p === '…' }"
              :disabled="p === '…'"
              @click="typeof p === 'number' && (tagPage = p)"
            >{{ p }}</button>
            <button class="page-btn" :disabled="tagPage >= totalTagPages" @click="tagPage++"><RightOutlined /></button>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== 内容编辑弹窗 ========== -->
    <Teleport to="body">
      <div v-if="contentModalVisible" class="modal-backdrop" @click.self="!contentSaving && (contentModalVisible = false)">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-head">
            <h3>{{ contentIsEdit ? '编辑内容' : '新增内容' }}</h3>
            <button class="icon-btn" :disabled="contentSaving" @click="contentModalVisible = false"><CloseOutlined /></button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <label class="form-label req">名称 (name)</label>
              <input v-model="contentForm.name" class="form-input" placeholder="中英文均可" />
            </div>
            <div class="form-row">
              <label class="form-label">中文名称 (name_zh)</label>
              <input v-model="contentForm.name_zh" class="form-input" placeholder="留空则默认同 name" />
            </div>
            <div class="form-row">
              <label class="form-label">分组 (category)</label>
              <input
                v-model="contentForm.category"
                class="form-input"
                list="dl-content-cat"
                placeholder="选择或输入分组"
                @change="onContentCategoryInput"
              />
              <datalist id="dl-content-cat">
                <option v-for="c in menuStore.menuItems" :key="c.title" :value="c.title">{{ c.title_zh }}</option>
              </datalist>
            </div>
            <div class="form-row">
              <label class="form-label">标签 (subCategory)</label>
              <input
                v-model="contentForm.subCategory"
                class="form-input"
                list="dl-content-tag"
                placeholder="选择已有标签或输入新标签"
                @change="onContentTagInput"
              />
              <datalist id="dl-content-tag">
                <option v-for="t in tagsList" :key="t.id || t.name" :value="t.name">{{ t.name_zh }}</option>
              </datalist>
            </div>
            <div class="form-row">
              <label class="form-label">描述 (content)</label>
              <textarea v-model="contentForm.content" class="form-input" rows="2" placeholder="英文描述" />
            </div>
            <div class="form-row">
              <label class="form-label">中文描述 (content_zh)</label>
              <textarea v-model="contentForm.content_zh" class="form-input" rows="2" placeholder="留空则默认同 content" />
            </div>
            <div class="form-row">
              <label class="form-label">详细介绍 (detail)</label>
              <textarea v-model="contentForm.detail" class="form-input" rows="4" placeholder="英文详细介绍（选填）" />
            </div>
            <div class="form-row">
              <label class="form-label">中文详细介绍 (detail_zh)</label>
              <textarea v-model="contentForm.detail_zh" class="form-input" rows="4" placeholder="留空则默认同 detail" />
            </div>
            <div class="form-row">
              <label class="form-label">链接 (url)</label>
              <input v-model="contentForm.url" class="form-input" placeholder="https://..." />
            </div>
            <div class="form-row">
              <label class="form-label">评分 (rating)</label>
              <div class="stars editable">
                <span
                  v-for="n in 5"
                  :key="n"
                  class="star"
                  :class="{ on: n <= (hoverRating || contentForm.rating) }"
                  @mouseenter="hoverRating = n"
                  @mouseleave="hoverRating = 0"
                  @click="contentForm.rating = n"
                >★</span>
                <button v-if="contentForm.rating" class="rate-clear" @click="contentForm.rating = 0">清除</button>
                <span class="rate-num">{{ contentForm.rating }} / 5</span>
              </div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" :disabled="contentSaving" @click="contentModalVisible = false">取消</button>
            <button class="btn btn-primary" :disabled="contentSaving" @click="saveContent">
              <ReloadOutlined v-if="contentSaving" :spin="true" /> 保存
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ========== 分组编辑弹窗 ========== -->
    <Teleport to="body">
      <div v-if="catModalVisible" class="modal-backdrop" @click.self="!catSaving && (catModalVisible = false)">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-head">
            <h3>{{ catIsEdit ? '编辑分组' : '新增分组' }}</h3>
            <button class="icon-btn" :disabled="catSaving" @click="catModalVisible = false"><CloseOutlined /></button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <label class="form-label req">英文名 (title)</label>
              <input v-model="catForm.title" class="form-input" placeholder="如 Development" />
            </div>
            <div class="form-row">
              <label class="form-label">中文名 (title_zh)</label>
              <input v-model="catForm.title_zh" class="form-input" placeholder="留空则默认同 title" />
            </div>
            <div class="form-row">
              <label class="form-label">图标 (icon)</label>
              <input v-model="catForm.icon" class="form-input" placeholder="Ant Design 图标名" />
              <div class="icon-suggest">
                <span class="muted">常用建议：</span>
                <span
                  v-for="ic in iconSuggestions"
                  :key="ic"
                  class="chip chip-blue icon-chip"
                  :class="{ 'icon-chip-active': catForm.icon === ic }"
                  @click="catForm.icon = ic"
                >{{ ic }}</span>
              </div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" :disabled="catSaving" @click="catModalVisible = false">取消</button>
            <button class="btn btn-primary" :disabled="catSaving" @click="saveCategory">
              <ReloadOutlined v-if="catSaving" :spin="true" /> 保存
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ========== 标签编辑弹窗 ========== -->
    <Teleport to="body">
      <div v-if="tagModalVisible" class="modal-backdrop" @click.self="!tagSaving && (tagModalVisible = false)">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-head">
            <h3>{{ tagIsEdit ? '编辑标签' : '新增标签' }}</h3>
            <button class="icon-btn" :disabled="tagSaving" @click="tagModalVisible = false"><CloseOutlined /></button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <label class="form-label req">标签名 (name)</label>
              <input v-model="tagForm.name" class="form-input" placeholder="英文标签名，如 Prototyping" />
            </div>
            <div class="form-row">
              <label class="form-label">中文名 (name_zh)</label>
              <input v-model="tagForm.name_zh" class="form-input" placeholder="留空则默认同 name" />
            </div>
            <div class="form-row">
              <label class="form-label">所属分组 (category)</label>
              <input
                v-model="tagForm.category"
                class="form-input"
                list="dl-tag-cat"
                placeholder="选择分组（可选）"
                @change="onTagCategoryInput"
              />
              <datalist id="dl-tag-cat">
                <option v-for="c in menuStore.menuItems" :key="c.title" :value="c.title">{{ c.title_zh }}</option>
              </datalist>
            </div>
            <div class="form-row">
              <label class="form-label">分组中文名 (category_zh)</label>
              <input v-model="tagForm.category_zh" class="form-input" placeholder="自动联动，可手动修改" />
            </div>
            <p class="form-note">
              <InfoCircleFilled /> 标签为独立定义，可在新增内容时直接选用。删除标签仅移除定义，不影响已引用它的内容。
            </p>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" :disabled="tagSaving" @click="tagModalVisible = false">取消</button>
            <button class="btn btn-primary" :disabled="tagSaving" @click="saveTag">
              <ReloadOutlined v-if="tagSaving" :spin="true" /> 保存
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ========== 确认框 ========== -->
    <Teleport to="body">
      <div v-if="confirmState.visible" class="modal-backdrop" @click.self="closeConfirm(false)">
        <div class="modal modal-sm" role="alertdialog" aria-modal="true">
          <div class="confirm-body">
            <span class="confirm-icon" :class="{ danger: confirmState.danger }">
              <WarningFilled v-if="confirmState.danger" />
              <InfoCircleFilled v-else />
            </span>
            <div>
              <h3 class="confirm-title">{{ confirmState.title }}</h3>
              <p class="confirm-content">{{ confirmState.content }}</p>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" @click="closeConfirm(false)">{{ confirmState.cancelText }}</button>
            <button
              class="btn"
              :class="confirmState.danger ? 'btn-danger' : 'btn-primary'"
              @click="closeConfirm(true)"
            >{{ confirmState.okText }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ========== 通知 ========== -->
    <Teleport to="body">
      <div class="toast-wrap">
        <TransitionGroup name="toast">
          <div v-for="t in toasts" :key="t.id" class="toast" :class="'toast-' + t.type">
            <CheckCircleFilled v-if="t.type === 'success'" />
            <CloseCircleFilled v-else-if="t.type === 'error'" />
            <WarningFilled v-else-if="t.type === 'warning'" />
            <InfoCircleFilled v-else />
            <span>{{ t.text }}</span>
          </div>
        </TransitionGroup>
      </div>
    </Teleport>
    </template>
  </div>
</template>

<style scoped lang="less">
.admin-page {
  min-height: calc(100vh - 64px);
  color: var(--text-primary);
  font-family: var(--font-sans);
}

/* ---- 权限守卫界面 ---- */
.guard-screen {
  min-height: calc(100vh - 64px);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 16px; text-align: center; padding: 40px 24px;
}
.guard-spinner {
  width: 36px; height: 36px; border-radius: 50%;
  border: 3px solid var(--glass-border-inset);
  border-top-color: var(--accent);
  animation: spin 0.7s linear infinite;
}
.guard-icon { font-size: 56px; color: var(--accent); }
.guard-title { margin: 0; font-size: 24px; font-weight: 800; color: var(--text-primary); }
.guard-text { margin: 0; font-size: var(--text-base); color: var(--text-secondary); max-width: 420px; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ---- 玻璃拟态表面（与全站玻璃主题一致） ---- */
.surface {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-highlight), var(--shadow-sm);
}

/* ---- 顶部概览 ---- */
.admin-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 26px;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  margin-bottom: 20px;
}
.hero-brand { display: flex; align-items: center; gap: 16px; }
.hero-icon {
  display: grid; place-items: center;
  width: 48px; height: 48px;
  border-radius: var(--radius-md);
  font-size: 22px; color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--border-color);
}
.hero-title {
  margin: 0; font-family: var(--font-display);
  font-size: var(--text-2xl); font-weight: 700;
  letter-spacing: -0.01em; color: var(--text-primary);
}
.hero-sub { margin: 4px 0 0; font-size: var(--text-sm); color: var(--text-secondary); }
.hero-refresh { white-space: nowrap; }

/* ---- 统计卡片 ---- */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 22px;
}
.stat-card {
  appearance: none; cursor: pointer;
  position: relative;
  display: flex; align-items: center; gap: 16px;
 padding: 20px 22px;
 border-radius: var(--radius-lg);
 font-family: inherit; text-align: left;
 transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  &:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
  &.active {
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    box-shadow: var(--shadow-accent), inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent);
  }
}
.stat-icon {
  display: grid; place-items: center;
  width: 52px; height: 52px; flex-shrink: 0;
 border-radius: var(--radius-md);
 font-size: 24px; color: #fff;
 box-shadow: var(--shadow-sm);
}
.stat-icon-indigo { background: linear-gradient(135deg, #f2633c, #e8437a); }
.stat-icon-cyan   { background: linear-gradient(135deg, #06b6d4, #3b82f6); }
.stat-icon-violet { background: linear-gradient(135deg, #e8437a, #c2410c); }
.stat-meta { display: flex; flex-direction: column; line-height: 1.1; }
.stat-num {
  font-family: var(--font-display);
  font-size: 30px; font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}
.stat-label { font-size: var(--text-sm); color: var(--text-secondary); margin-top: 4px; }
.stat-num { font-variant-numeric: tabular-nums; }
/* 卡片底部高亮条：悬停时滑入，激活时常驻 */
.stat-spark {
  position: absolute; left: 16px; right: 16px; bottom: 0;
  height: 3px; border-radius: 3px 3px 0 0;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: 0; transform: scaleX(0.4);
  transition: opacity var(--dur) var(--ease-out), transform var(--dur) var(--ease-out);
}
.stat-card:hover .stat-spark { opacity: 0.5; transform: scaleX(1); }
.stat-card.active .stat-spark { opacity: 1; transform: scaleX(1); }

/* 面板切换淡入 */
.panel > .toolbar, .panel > .table-card { animation: fade-up var(--dur-enter) var(--ease-out) both; }

@media (max-width: 720px) {
  .stat-grid { grid-template-columns: 1fr; gap: 12px; margin-bottom: 18px; }
  .admin-hero { padding: 16px 18px; }
}

/* ---- 标签栏：胶囊式切换，带背景高光与平滑过渡 ---- */
.admin-tabs {
  display: inline-flex; gap: 4px; margin-bottom: 18px;
  padding: 5px;
  border-radius: var(--radius-full);
  background: var(--glass-bg-soft);
 border: 1px solid var(--glass-border-inset);
  align-self: flex-start;
}
.tab-btn {
  appearance: none; border: none;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 18px; cursor: pointer;
  font-family: inherit; font-size: var(--text-base); font-weight: 600;
  color: var(--text-secondary);
 border-radius: var(--radius-full);
 position: relative;
 transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  :deep(.anticon) { font-size: 16px; }
  &:hover { color: var(--text-primary); background: color-mix(in srgb, var(--accent) 6%, transparent); }
  &.active {
    color: #fff;
    background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #e8437a));
    box-shadow: var(--shadow-accent);
  }
}

/* ---- 工具栏 ---- */
.toolbar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 14px 18px; border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm); margin-bottom: 16px;
}
.toolbar-title { font-weight: 600; color: var(--text-primary); }
.toolbar-spacer { flex: 1; }
.muted { color: var(--text-muted); }
.muted-en { color: var(--text-muted); font-size: var(--text-xs); }
.strong { font-weight: 600; color: var(--text-primary); }

/* ---- 表单控件 ---- */
.field {
  appearance: none;
  height: 36px; padding: 0 12px;
  font-family: inherit; font-size: var(--text-base);
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  &.search-field { position: relative; display: inline-flex; align-items: center; }
  &:focus, &:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
}
.field.search-field { width: 220px; max-width: 60vw; padding-left: 34px; }
.field.search-field .field-icon {
  position: absolute; left: 11px; color: var(--text-muted); font-size: 14px; pointer-events: none;
}
select.field { cursor: pointer; padding-right: 28px; }

/* ---- 按钮 ---- */
.btn {
  appearance: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 36px; padding: 0 16px;
  font-family: inherit; font-size: var(--text-base); font-weight: 500;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  &:disabled { opacity: 0.55; cursor: not-allowed; }
  &:not(:disabled):active { transform: translateY(1px); }
  :deep(.anticon) { font-size: 15px; }
}
.btn-primary {
  color: #fff; background: var(--accent); border-color: var(--accent);
  box-shadow: var(--shadow-accent);
  &:not(:disabled):hover { background: var(--accent-hover); border-color: var(--accent-hover); }
}
.btn-danger {
  color: #fff; background: var(--danger); border-color: var(--danger);
  &:not(:disabled):hover { filter: brightness(1.08); }
}
.btn-ghost {
  color: var(--text-primary); background: var(--bg-subtle); border-color: var(--border-strong);
  &:not(:disabled):hover { border-color: var(--accent); color: var(--accent); }
}
.btn-link {
  appearance: none; cursor: pointer; background: transparent; border: none;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; font-family: inherit; font-size: var(--text-sm); font-weight: 500;
  color: var(--accent); border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  :deep(.anticon) { font-size: 13px; }
  &:hover { background: var(--accent-soft); }
  &.danger { color: var(--danger); &:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); } }
}
.icon-btn {
  appearance: none; cursor: pointer; background: transparent; border: none;
  display: grid; place-items: center; width: 32px; height: 32px;
  color: var(--text-secondary); border-radius: var(--radius-sm);
  font-size: 16px;
  &:hover { background: var(--bg-subtle); color: var(--text-primary); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

/* ---- 表格 ---- */
.table-card {
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  position: relative;
}
.table-scroll { overflow-x: auto; }
.data-table {
  width: 100%; border-collapse: collapse; font-size: var(--text-base);
  min-width: 720px;
}
.data-table thead th {
  text-align: left; padding: 12px 16px;
  font-weight: 700; font-size: var(--text-sm);
  color: var(--text-secondary);
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}
.data-table tbody td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  vertical-align: middle;
  color: var(--text-primary);
}
.data-table tbody tr:last-child td { border-bottom: none; }
.data-table tbody tr { transition: background var(--dur-fast) var(--ease-out); }
.data-table tbody tr:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); }

.col-name { min-width: 150px; }
.col-url { max-width: 280px; }
.col-cat, .col-tag { min-width: 120px; }
.col-rating, .col-count { width: 110px; }
.col-icon { min-width: 160px; }
.col-action { width: 150px; white-space: nowrap; text-align: right; }

.name-zh { font-weight: 600; color: var(--text-primary); }
.name-en, .cat-en { font-size: var(--text-xs); color: var(--text-muted); margin-top: 1px; }
.cat-zh { font-weight: 600; }
.url-link {
  display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
  color: var(--accent); :deep(.anticon) { font-size: 13px; }
}
.url-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.url-link:hover { color: var(--accent-hover); }

/* 标签 / 计数胶囊 */
.chip {
  display: inline-flex; align-items: center;
  padding: 2px 10px; font-size: var(--text-xs); font-weight: 500;
  border-radius: var(--radius-full); border: 1px solid var(--border-color);
  background: var(--bg-subtle); color: var(--text-secondary);
}
.chip-indigo { color: var(--accent); background: var(--accent-soft); border-color: transparent; }
.chip-blue   { color: #2563eb; background: rgba(37,99,235,0.12); border-color: transparent; }
.chip-cyan   { color: #0891b2; background: rgba(8,145,178,0.12); border-color: transparent; }
.chip-purple { color: #7c3aed; background: rgba(124,58,237,0.12); border-color: transparent; }
.chip-default { color: var(--text-muted); }

/* ---- 空态 / 加载 ---- */
.table-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 36px 0; color: var(--text-muted);
  :deep(.anticon) { font-size: 30px; opacity: 0.45; }
  span { font-size: var(--text-sm); }
}
.table-loading {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
}
.spinner {
  width: 26px; height: 26px; border-radius: 50%;
  border: 3px solid var(--border-strong);
  border-top-color: var(--accent);
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ---- 分页 ---- */
.pagination {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
  padding: 12px 16px; border-top: 1px solid var(--border-color);
}
.page-info { font-size: var(--text-sm); color: var(--text-secondary); }
.page-controls { display: flex; gap: 4px; }
.page-btn {
  appearance: none; cursor: pointer;
  min-width: 30px; height: 30px; padding: 0 8px;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: inherit; font-size: var(--text-sm);
  color: var(--text-secondary);
  background: var(--bg-surface); border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  transition: all var(--dur-fast) var(--ease-out);
  &:not(:disabled):hover { border-color: var(--accent); color: var(--accent); }
  &.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
  &.ellipsis { border: none; background: transparent; cursor: default; }
}

/* ---- 评分 ---- */
.stars { display: inline-flex; align-items: center; gap: 3px; user-select: none; }
.stars .star {
  font-size: 18px; line-height: 1;
  color: var(--text-muted); opacity: 0.5;
  transition: color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}
.stars .star.on { color: #fadb14; opacity: 1; }
.stars.editable .star { cursor: pointer; &:hover { transform: scale(1.18); } }
.rate-num { margin-left: 8px; font-size: var(--text-xs); color: var(--text-muted); }
.rate-clear {
  margin-left: 8px; appearance: none; cursor: pointer; border: none; background: transparent;
  font-family: inherit; font-size: var(--text-xs); color: var(--text-muted);
  &:hover { color: var(--accent); }
}

/* ---- 弹窗 ---- */
.modal-backdrop {
  position: fixed; inset: 0; z-index: 1000;
  display: grid; place-items: center; padding: 24px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(3px);
  animation: fade-in 0.15s var(--ease-out);
}
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
.modal {
  width: 100%; max-width: 720px; max-height: calc(100vh - 48px);
  display: flex; flex-direction: column;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  animation: pop-in 0.18s var(--ease-spring);
}
.modal-sm { max-width: 440px; }
@keyframes pop-in { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: none; } }
.modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px; border-bottom: 1px solid var(--border-color);
  h3 { margin: 0; font-size: var(--text-lg); font-weight: 700; color: var(--text-primary); }
}
.modal-body { padding: 22px; overflow-y: auto; }
.modal-foot {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 22px; border-top: 1px solid var(--border-color);
}

/* ---- 表单 ---- */
.form-row { margin-bottom: 16px; }
.form-label {
  display: block; margin-bottom: 6px;
  font-size: var(--text-sm); font-weight: 600; color: var(--text-secondary);
}
.form-label.req::after { content: ' *'; color: var(--danger); }
.form-input {
  appearance: none; width: 100%;
  padding: 8px 12px; font-family: inherit; font-size: var(--text-base);
  color: var(--text-primary); background: var(--bg-surface);
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  &::placeholder { color: var(--text-muted); }
  &:focus, &:focus-visible {
    outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft);
  }
}
textarea.form-input { resize: vertical; min-height: 60px; }
.form-note {
  display: flex; gap: 8px; align-items: flex-start;
  margin: 4px 0 0; padding: 10px 12px;
  font-size: var(--text-xs); color: var(--text-secondary);
  background: var(--accent-soft); border-radius: var(--radius-sm);
  :deep(.anticon) { color: var(--accent); margin-top: 1px; }
}

/* ---- 图标建议 ---- */
.icon-suggest { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.icon-chip { cursor: pointer; user-select: none; transition: transform var(--dur-fast) var(--ease-out); }
.icon-chip:hover { transform: translateY(-1px); }
.icon-chip-active { outline: 2px solid var(--accent); outline-offset: 1px; }

/* ---- 确认框 ---- */
.confirm-body { display: flex; gap: 14px; padding: 4px 0; }
.confirm-icon { font-size: 24px; color: var(--accent); margin-top: 2px; }
.confirm-icon.danger { color: var(--danger); }
.confirm-title { margin: 0 0 6px; font-size: var(--text-md); font-weight: 700; color: var(--text-primary); }
.confirm-content { margin: 0; font-size: var(--text-sm); color: var(--text-secondary); line-height: var(--leading-snug); }

/* ---- 通知 ---- */
.toast-wrap {
  position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
  z-index: 1100; display: flex; flex-direction: column; gap: 10px; align-items: center;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 16px; font-size: var(--text-sm); font-weight: 500;
  color: #fff; background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-md);
  :deep(.anticon) { font-size: 16px; }
}
.toast-success { background: var(--success); }
.toast-error { background: var(--danger); }
.toast-warning { background: var(--warning); }
.toast-info { background: var(--info); }
.toast-enter-active, .toast-leave-active { transition: all 0.25s var(--ease-out); }
.toast-enter-from { opacity: 0; transform: translateY(-12px); }
.toast-leave-to { opacity: 0; transform: translateY(-12px); }

/* ---- 响应式 ---- */
@media (max-width: 640px) {
  .admin-hero { flex-direction: column; align-items: flex-start; }
  .field.search-field { width: 100%; }
  .modal { max-width: 100%; }
}
</style>
