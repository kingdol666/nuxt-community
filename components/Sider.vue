<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useTheme } from '~/composables/useTheme'
import {
  HomeOutlined,
  AppstoreOutlined,
  DashboardOutlined,
  MessageOutlined,
  StarOutlined,
} from '@ant-design/icons-vue'

const { themeMode } = useTheme()
const { isAdmin } = useAuth()
const route = useRoute()
const collapsed = ref(false)

interface NavItem { key: string; label: string; to: string; desc: string; icon: any }
// 后台管理仅对 admin 角色可见
const navItems = computed<NavItem[]>(() => {
  const items: NavItem[] = [
    { key: 'home', label: '首页', to: '/', desc: '欢迎页', icon: HomeOutlined },
    { key: 'application', label: '应用推荐', to: '/application', desc: '浏览全部应用', icon: AppstoreOutlined },
    { key: 'community', label: '社区', to: '/community', desc: '笔记瀑布流', icon: MessageOutlined },
    { key: 'collections', label: '收藏', to: '/collections', desc: '我的收藏夹', icon: StarOutlined },
  ]
  if (isAdmin.value) items.push({ key: 'admin', label: '后台管理', to: '/admin', desc: '内容 / 分组 / 标签', icon: DashboardOutlined })
  return items
})

const activeKey = computed(() => {
  const p = route.path
  if (p.startsWith('/community')) return 'community'
  if (p.startsWith('/application')) return 'application'
  if (p.startsWith('/collections')) return 'collections'
  if (p.startsWith('/admin')) return 'admin'
  return 'home'
})

</script>
<template>
  <a-layout-sider
    v-model:collapsed="collapsed"
    collapsible
    :width="232"
    :collapsed-width="76"
    breakpoint="lg"
    class="app-sider glass-strong"
    :class="themeMode"
  >
    <div class="sider-inner">
      <div class="sider-section-label">
        <span class="label-dot" />
        <span class="label-text">导航</span>
      </div>

      <nav class="sider-nav">
        <nuxt-link
          v-for="item in navItems"
          :key="item.key"
          :to="item.to"
          class="sider-item"
          :class="{ active: activeKey === item.key, collapsed }"
        >
          <span class="sider-item-indicator" />
          <span class="sider-item-icon"><component :is="item.icon" /></span>
          <span class="sider-item-body">
            <span class="sider-item-label">{{ item.label }}</span>
            <span class="sider-item-desc">{{ item.desc }}</span>
          </span>
        </nuxt-link>
      </nav>

      <div v-if="!collapsed" class="sider-footer">
        <div class="sider-card">
          <div class="sider-card-title">应用推荐</div>
          <div class="sider-card-sub">精挑细选 · 持续更新</div>
        </div>
      </div>
    </div>
  </a-layout-sider>
</template>

<style scoped lang="less">
.app-sider {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: calc(100vh - 64px);
  position: sticky;
  top: 64px;
  left: 0;
  z-index: 10;
  /* 显式覆盖 antd .ant-layout-sider 的背景（同等特异性下 antd 注入样式会胜出，
     故在 scoped 规则里强制玻璃材质，保证毛玻璃可见） */
  background: var(--glass-bg-strong) !important;
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: inset 1px 0 0 var(--glass-border), inset 0 1px 0 var(--glass-highlight);
  border-top: none;
  border-left: none;
  border-bottom: none;
  border-right: 1px solid var(--glass-border);
}

.sider-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 18px 14px 0;
}

/* ---- 分区标签 ---- */
.sider-section-label {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 10px 12px;
}
.label-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.label-text {
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--text-muted);
}

/* ---- 导航项 ---- */
.sider-nav { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.sider-item {
  position: relative;
  display: flex; align-items: center; gap: 12px;
  padding: 11px 12px;
  border-radius: var(--radius-md);
  text-decoration: none;
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  overflow: hidden;
}
.sider-item-indicator {
  position: absolute;
  left: 0; top: 50%;
  width: 3px; height: 0;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
  transform: translateY(-50%);
  transition: height var(--dur-fast) var(--ease-out);
}
.sider-item-icon {
  display: grid; place-items: center;
  width: 36px; height: 36px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  font-size: 17px;
  background: var(--glass-bg-soft);
  border: 1px solid var(--glass-border-inset);
  color: var(--text-secondary);
  transition: all var(--dur-fast) var(--ease-out);
}
.sider-item-body { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.sider-item-label { font-weight: 600; font-size: var(--text-base); color: inherit; white-space: nowrap; }
.sider-item-desc { font-size: 11px; color: var(--text-muted); white-space: nowrap; }

.sider-item:hover {
  color: var(--text-primary);
  background: var(--glass-bg-soft);
  .sider-item-icon { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
}
.sider-item.active {
  color: var(--accent);
  background: var(--accent-soft);
  .sider-item-indicator { height: 22px; }
  .sider-item-icon {
    color: #fff;
    background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #e8437a));
    border-color: transparent;
    box-shadow: var(--shadow-accent);
  }
  .sider-item-desc { color: color-mix(in srgb, var(--accent) 75%, var(--text-muted)); }
}

/* 折叠态：仅显示图标，居中 */
.sider-item.collapsed { justify-content: center; padding: 9px; gap: 0; }
.sider-item.collapsed .sider-item-body { display: none; }

/* ---- 底部卡片 ---- */
.sider-footer { margin-top: auto; padding: 14px 4px 18px; }
.sider-card {
  padding: 14px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--accent-soft), color-mix(in srgb, var(--accent) 8%, transparent));
  border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
}
.sider-card-title { font-weight: 700; color: var(--text-primary); font-size: var(--text-sm); }
.sider-card-sub { font-size: 11px; color: var(--text-muted); margin-top: 3px; }

/* ---- 折叠触发器（antd 渲染于 sider 外层） ---- */
:deep(.ant-layout-sider-trigger) {
  height: 48px; line-height: 48px;
  background: transparent !important;
  border-top: 1px solid var(--glass-border-inset);
  color: var(--text-secondary);
  transition: all var(--dur-fast) var(--ease-out);
}
:deep(.ant-layout-sider-trigger:hover) {
  color: var(--accent);
  background: var(--accent-soft) !important;
}

/* 折叠时隐藏分区标签与底部卡片，避免错位 */
.app-sider:has(.ant-layout-sider-collapsed) .sider-section-label,
.app-sider.ant-layout-sider-collapsed .sider-section-label { display: none; }

@media (max-width: 768px) {
  .app-sider { display: none; }
}
</style>
