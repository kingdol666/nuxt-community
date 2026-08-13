<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useSiteConfig } from '~/composables/useSiteConfig'
import {
  BulbOutlined,
  BulbFilled,
  UserOutlined,
  LogoutOutlined,
  HomeOutlined,
  AppstoreOutlined,
  DashboardOutlined,
  DownOutlined,
  MessageOutlined,
  StarOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons-vue'
import NotificationBell from '~/components/NotificationBell.vue'
const emit = defineEmits<{ (e: 'open-chat', peerId?: string): void }>()

function openChat(peerId?: string) { emit('open-chat', peerId) }

const { open: groupOpen } = useGroupPanel()

const { themeMode, toggleTheme } = useTheme()
const route = useRoute()
const { user, isLoggedIn, isAdmin, logout, openAuthModal } = useAuth()
const username = computed(() => user.value?.username || '')
const { config: appConfig } = useSiteConfig()
const brandName = computed(() => appConfig.value.branding.brandName)
const brandLogo = computed(() => appConfig.value.branding.brandLogo)

interface NavItem { key: string; label: string; to: string; icon: any }
// 后台管理仅对 admin 角色可见
const navItems = computed<NavItem[]>(() => {
  const items: NavItem[] = [
    { key: 'home', label: '首页', to: '/', icon: HomeOutlined },
    { key: 'application', label: '应用推荐', to: '/application', icon: AppstoreOutlined },
    { key: 'community', label: '社区', to: '/community', icon: MessageOutlined },
    { key: 'collections', label: '收藏', to: '/collections', icon: StarOutlined },
  ]
  if (isAdmin.value) items.push({ key: 'admin', label: '后台管理', to: '/admin', icon: DashboardOutlined })
  return items
})

const activeKey = computed(() => {
  const p = route.path
  if (p.startsWith('/application')) return 'application'
  if (p.startsWith('/community')) return 'community'
  if (p.startsWith('/collections')) return 'collections'
  if (p.startsWith('/admin')) return 'admin'
  return 'home'
})

// 用户下拉菜单（自绘，避免 a-dropdown 的 SSR 状态问题）
const userMenuOpen = ref(false)
function toggleUserMenu() { userMenuOpen.value = !userMenuOpen.value }
function closeUserMenu() { userMenuOpen.value = false }
async function handleLogout() {
  closeUserMenu()
  await logout()
}
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#f2633c,#e8437a)',
  'linear-gradient(135deg,#06b6d4,#3b82f6)',
  'linear-gradient(135deg,#10b981,#06b6d4)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#e8437a,#c2410c)',
  'linear-gradient(135deg,#38bdf8,#0ea5e9)',
]
const avatarStyle = computed(() => {
  if (user.value?.avatarUrl) {
    return { backgroundImage: `url(${user.value.avatarUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  }
  return { background: AVATAR_GRADIENTS[user.value?.avatarColor ?? 0] }
})

// 点击外部关闭下拉
function onDocClick(e: MouseEvent) {
  const root = document.getElementById('user-menu-root')
  if (root && !root.contains(e.target as Node)) closeUserMenu()
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <header class="app-header glass-strong">
    <div class="header-inner">
      <!-- 左：品牌 + 导航 -->
      <div class="header-left">
        <nuxt-link to="/" class="brand">
          <img :src="brandLogo" alt="logo" class="brand-logo" />
          <span class="brand-text">{{ brandName }}</span>
        </nuxt-link>

        <nav class="nav-pills">
          <nuxt-link
            v-for="item in navItems"
            :key="item.key"
            :to="item.to"
            class="nav-pill"
            :class="{ active: activeKey === item.key }"
          >
            <component :is="item.icon" class="nav-pill-icon" />
            <span class="nav-pill-label">{{ item.label }}</span>
          </nuxt-link>
        </nav>
      </div>

      <!-- 右：主题切换 + 用户 -->
      <div class="header-right">
        <button
          class="icon-action"
          :title="themeMode === 'dark' ? '切换到亮色' : '切换到暗色'"
          aria-label="切换主题"
          @click="toggleTheme"
        >
          <BulbFilled v-if="themeMode === 'dark'" />
          <BulbOutlined v-else />
        </button>

        <NotificationBell v-if="isLoggedIn" :on-open-chat="openChat" />
        <button
          v-if="isLoggedIn"
          class="icon-action"
          title="私信"
          aria-label="私信"
          @click="openChat()"
        >
          <MessageOutlined />
        </button>
        <button
          v-if="isLoggedIn"
          class="icon-action"
          title="群聊"
          aria-label="群聊"
          @click="groupOpen = true"
        >
          <TeamOutlined />
        </button>

        <!-- 登录/用户区 -->
        <button v-if="!isLoggedIn" class="btn-login" @click="openAuthModal">
          <UserOutlined /> 登录
        </button>
        <div v-else id="user-menu-root" class="user-menu-wrap">
          <button class="user-chip" :class="{ open: userMenuOpen }" @click="toggleUserMenu">
            <span class="user-avatar" :style="avatarStyle"><UserOutlined v-if="!user?.avatarUrl" /></span>
            <span class="user-name">{{ username }}</span>
            <DownOutlined class="user-caret" />
          </button>
          <Transition name="popdown">
            <div v-if="userMenuOpen" class="user-dropdown glass-strong">
              <div class="dropdown-head">
                <span class="user-avatar lg" :style="avatarStyle"><UserOutlined v-if="!user?.avatarUrl" /></span>
                <div class="dropdown-head-text">
                  <div class="dropdown-name">{{ username }}</div>
                  <div class="dropdown-sub">已登录</div>
                </div>
              </div>
            <div class="dropdown-divider" />
            <nuxt-link v-if="user" :to="`/user/${user.id}`" class="dropdown-item" @click="closeUserMenu">
              <UserOutlined /><span>我的主页</span>
            </nuxt-link>
            <nuxt-link to="/settings" class="dropdown-item" @click="closeUserMenu">
              <SettingOutlined /><span>设置</span>
            </nuxt-link>
            <button class="dropdown-item danger" @click="handleLogout">
                <LogoutOutlined /><span>退出登录</span>
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped lang="less">
.app-header {
  position: sticky;
  top: 0;
  z-index: 20;
  width: 100%;
  height: 64px;
  padding: 0 24px;
  box-sizing: border-box;
  border-top: none;
  border-left: none;
  border-right: none;
  border-bottom: 1px solid var(--glass-border);
}
.header-inner {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

/* ---- 左侧 ---- */
.header-left { display: flex; align-items: center; gap: 28px; }
.brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; }
.brand-logo {
  width: 32px; height: 32px;
  border-radius: 9px;
  box-shadow: 0 2px 10px var(--accent-glow), inset 0 0 0 1px var(--glass-border-inset);
}
.brand-text {
  font-family: var(--font-display);
  font-size: 21px; font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text-primary);
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease-out);
}
.brand:hover .brand-text { color: var(--accent); }

/* ---- 导航胶囊 ---- */
.nav-pills {
  display: flex; align-items: center; gap: 4px;
  padding: 4px;
  border-radius: var(--radius-full);
  background: var(--glass-bg-soft);
  border: 1px solid var(--glass-border-inset);
}
.nav-pill {
  position: relative;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 16px;
  border: none; background: transparent;
  text-decoration: none;
  font-family: inherit; font-size: var(--text-sm); font-weight: 600;
  color: var(--text-secondary);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}
.nav-pill-icon { font-size: 15px; }
.nav-pill:hover { color: var(--text-primary); }
.nav-pill.active {
  color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
}

/* ---- 右侧 ---- */
.header-right { display: flex; align-items: center; gap: 10px; }
.btn-login {
  appearance: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 7px;
  height: 38px; padding: 0 18px;
  border: none; border-radius: var(--radius-full);
  font-family: inherit; font-size: var(--text-sm); font-weight: 600;
  color: #fff;
  background: var(--grad-brand);
  box-shadow: var(--shadow-accent);
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  :deep(.anticon) { font-size: 15px; }
  &:hover { transform: translateY(-2px); box-shadow: 0 10px 24px var(--accent-glow); }
}
.icon-action {
  appearance: none; cursor: pointer;
  display: grid; place-items: center;
  width: 38px; height: 38px;
  border-radius: var(--radius-full);
  border: 1px solid var(--glass-border-inset);
  background: var(--glass-bg-soft);
  color: var(--text-secondary);
  font-size: 17px;
  &:hover { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); transform: translateY(-1px); }
}

/* ---- 用户菜单 ---- */
.user-menu-wrap { position: relative; }
.user-chip {
  appearance: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 9px;
  height: 38px; padding: 0 10px 0 6px;
  border-radius: var(--radius-full);
  border: 1px solid var(--glass-border-inset);
  background: var(--glass-bg-soft);
  font-family: inherit; font-size: var(--text-sm); font-weight: 600;
  color: var(--text-primary);
  transition: all var(--dur-fast) var(--ease-out);
  &:hover, &.open { border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
}
.user-avatar {
  display: grid; place-items: center;
  width: 28px; height: 28px;
  border-radius: 50%;
  background: var(--grad-brand);
  overflow: hidden; flex-shrink: 0;
  &.lg { width: 36px; height: 36px; font-size: 17px; }
}
.user-name { white-space: nowrap; }
.user-caret { font-size: 11px; opacity: 0.7; transition: transform var(--dur-fast) var(--ease-out); }
.user-chip.open .user-caret { transform: rotate(180deg); }

.user-dropdown {
  position: absolute;
  top: calc(100% + 10px); right: 0;
  min-width: 220px;
  padding: 8px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 30;
}
.dropdown-head { display: flex; align-items: center; gap: 11px; padding: 8px 10px; }
.dropdown-name { font-weight: 700; color: var(--text-primary); font-size: var(--text-base); }
.dropdown-sub { font-size: var(--text-xs); color: var(--text-muted); margin-top: 1px; }
.dropdown-divider { height: 1px; background: var(--glass-border-inset); margin: 6px 4px; }
.dropdown-item {
  appearance: none; cursor: pointer;
  width: 100%;
  display: flex; align-items: center; gap: 9px;
  padding: 9px 10px; border: none; background: transparent;
  border-radius: var(--radius-sm);
  font-family: inherit; font-size: var(--text-sm); font-weight: 500;
  color: var(--text-primary);
  transition: background var(--dur-fast) var(--ease-out);
  :deep(.anticon) { font-size: 15px; opacity: 0.8; }
  &:hover { background: var(--accent-soft); }
  &.danger { color: var(--danger); &:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); } }
}

/* 下拉动画 */
.popdown-enter-active, .popdown-leave-active { transition: all 0.18s var(--ease-out); }
.popdown-enter-from, .popdown-leave-to { opacity: 0; transform: translateY(-8px) scale(0.97); }

/* ---- 响应式 ---- */
@media (max-width: 860px) {
  .nav-pills { display: none; }
}
@media (max-width: 560px) {
  .app-header { padding: 0 14px; }
  .brand-text { display: none; }
  .user-name { display: none; }
}
</style>
