<script setup lang="ts">
// 登录/注册弹窗：玻璃拟态 + Tab 切换 + 表单校验 + 错误反馈。
import { ref, computed, watch } from 'vue'
import { useAuth } from '~/composables/useAuth'
import { apiError } from '~/composables/useApiError'
import {
  CloseOutlined,
  UserOutlined,
  LockOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
} from '@ant-design/icons-vue'

const { authModalOpen, login, register, closeAuthModal } = useAuth()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')

const valid = computed(() => {
  if (username.value.trim().length < 2) return false
  if (password.value.length < 6) return false
  return true
})

function switchMode(m: 'login' | 'register') {
  mode.value = m
  errorMsg.value = ''
}

watch(authModalOpen, (v) => {
  if (!v) {
    errorMsg.value = ''
    username.value = ''
    password.value = ''
  }
})

async function submit() {
  if (!valid.value || loading.value) return
  loading.value = true
  errorMsg.value = ''
  try {
    if (mode.value === 'login') {
      await login(username.value.trim(), password.value)
    } else {
      await register(username.value.trim(), password.value)
    }
    closeAuthModal()
  } catch (e: unknown) {
    errorMsg.value = apiError(e, mode.value === 'login' ? '登录失败' : '注册失败')
  } finally {
    loading.value = false
  }
}

// Esc to close
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && authModalOpen.value) closeAuthModal()
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKeydown)
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
</script>

<template>
  <Teleport to="body">
    <Transition name="auth-fade">
      <div v-if="authModalOpen" class="auth-overlay" @click.self="closeAuthModal">
        <Transition name="auth-pop" appear>
          <div v-if="authModalOpen" class="auth-card" role="dialog" aria-modal="true">
            <button class="auth-close" aria-label="关闭" @click="closeAuthModal">
              <CloseOutlined />
            </button>

            <div class="auth-brand">
              <span class="brand-ic"><UserOutlined /></span>
              <h2 class="brand-title">{{ mode === 'login' ? '欢迎回来' : '加入社区' }}</h2>
              <p class="brand-sub">{{ mode === 'login' ? '登录后参与评论、点赞与评分' : '注册即可评论、回复、点赞与评分' }}</p>
            </div>

            <!-- mode switch -->
            <div class="auth-tabs">
              <button class="auth-tab" :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button>
              <button class="auth-tab" :class="{ active: mode === 'register' }" @click="switchMode('register')">注册</button>
            </div>

            <form class="auth-form" @submit.prevent="submit">
              <div class="input-field">
                <UserOutlined class="input-ic" />
                <input
                  v-model="username"
                  type="text"
                  placeholder="用户名（至少 2 个字符）"
                  autocomplete="username"
                />
              </div>
              <div class="input-field">
                <LockOutlined class="input-ic" />
                <input
                  v-model="password"
                  type="password"
                  placeholder="密码（至少 6 个字符）"
                  :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
                />
              </div>

              <Transition name="error">
                <div v-if="errorMsg" class="auth-error">
                  <CloseCircleFilled /> <span>{{ errorMsg }}</span>
                </div>
              </Transition>

              <div class="auth-hint" v-if="mode === 'register'">
                <CheckCircleFilled class="ok" /><span>注册即代表同意社区规范，请文明交流。</span>
              </div>

              <button type="submit" class="auth-submit" :disabled="!valid || loading">
                <span v-if="loading" class="spinner-sm" />
                {{ mode === 'login' ? '登 录' : '注 册' }}
              </button>
            </form>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="less">
.auth-overlay {
  position: fixed; inset: 0; z-index: 1300;
  display: grid; place-items: center; padding: 24px;
  background: rgba(10, 10, 18, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.auth-card {
  position: relative;
  width: 100%; max-width: 400px;
  padding: 36px 34px 32px;
  border-radius: var(--radius-xl);
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-lg), inset 0 1px 0 var(--glass-highlight);
}
.auth-close {
  position: absolute; top: 12px; right: 12px;
  display: grid; place-items: center;
  width: 34px; height: 34px;
  border: none; border-radius: 50%;
  background: transparent; color: var(--text-muted);
  font-size: 16px; cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);
  &:hover { background: var(--glass-bg-soft); color: var(--text-primary); transform: rotate(90deg); }
}

.auth-brand { text-align: center; margin-bottom: 26px; }
.brand-ic {
  display: inline-grid; place-items: center;
  width: 56px; height: 56px; border-radius: 18px;
  font-size: 26px; color: #fff;
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 50%, #e8437a));
  box-shadow: var(--shadow-accent);
  margin-bottom: 14px;
}
.brand-title { margin: 0; font-size: 24px; font-weight: 800; color: var(--text-primary); }
.brand-sub { margin: 6px 0 0; font-size: var(--text-sm); color: var(--text-secondary); }

.auth-tabs {
  display: flex; gap: 4px; padding: 4px;
  margin-bottom: 22px;
  border-radius: var(--radius-full);
  background: var(--glass-bg-soft);
  border: 1px solid var(--glass-border-inset);
}
.auth-tab {
  flex: 1; cursor: pointer;
  appearance: none; border: none;
  padding: 9px; border-radius: var(--radius-full);
  font-family: inherit; font-size: var(--text-sm); font-weight: 600;
  color: var(--text-secondary);
  background: transparent;
  transition: all var(--dur-fast) var(--ease-out);
  &.active {
    color: #fff;
    background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #e8437a));
    box-shadow: var(--shadow-sm);
  }
}

.auth-form { display: flex; flex-direction: column; gap: 14px; }
.input-field {
  position: relative;
  display: flex; align-items: center;
  border-radius: var(--radius-md);
  background: var(--glass-bg-soft);
  border: 1px solid var(--glass-border-inset);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  &:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
}
.input-ic {
  padding-left: 14px; font-size: 16px; color: var(--text-muted);
  flex-shrink: 0;
}
.input-field input {
  flex: 1; border: none; background: transparent; outline: none;
  padding: 12px 14px 12px 10px;
  font-family: inherit; font-size: var(--text-base);
  color: var(--text-primary);
  &::placeholder { color: var(--text-muted); }
}

.auth-error {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; border-radius: var(--radius-sm);
  font-size: var(--text-sm); color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  :deep(.anticon) { font-size: 15px; }
}
.error-enter-active, .error-leave-active { transition: all 0.2s var(--ease-out); }
.error-enter-from, .error-leave-to { opacity: 0; transform: translateY(-4px); }

.auth-hint {
  display: flex; align-items: center; gap: 7px;
  font-size: var(--text-xs); color: var(--text-muted);
  .ok { color: var(--success); }
}

.auth-submit {
  margin-top: 4px;
  appearance: none; cursor: pointer;
  height: 46px; border: none;
  border-radius: var(--radius-md);
  font-family: inherit; font-size: var(--text-md); font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 50%, #e8437a));
  box-shadow: var(--shadow-accent);
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  letter-spacing: 0.05em;
  transition: all var(--dur-fast) var(--ease-out);
  &:not(:disabled):hover { transform: translateY(-2px); box-shadow: 0 12px 30px var(--accent-glow); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
.spinner-sm {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* transitions */
.auth-fade-enter-active, .auth-fade-leave-active { transition: opacity 0.25s var(--ease-out); }
.auth-fade-enter-from, .auth-fade-leave-to { opacity: 0; }
.auth-pop-enter-active { transition: opacity 0.3s var(--ease-out), transform 0.3s var(--ease-spring); }
.auth-pop-leave-active { transition: opacity 0.2s var(--ease-out), transform 0.2s var(--ease-out); }
.auth-pop-enter-from { opacity: 0; transform: scale(0.94) translateY(12px); }
.auth-pop-leave-to { opacity: 0; transform: scale(0.96); }
</style>
