// app.vue

<script setup>
import { computed, reactive, onMounted, watch, ref } from 'vue';
import { useRoute } from 'vue-router';
import Header from '~/components/Header.vue';
import ChatPanel from '~/components/ChatPanel.vue';
import GroupChatPanel from '~/components/GroupChatPanel.vue';
import AuthModal from '~/components/AuthModal.vue';
import { theme } from 'ant-design-vue';
// 1. 导入我们创建的 Composable
import { useTheme } from '~/composables/useTheme';
import { useAuth } from '~/composables/useAuth';
import { useRealtime } from '~/composables/useRealtime';
import { useWuKongIM } from '~/composables/useWuKongIM';
const { themeMode } = useTheme();
const route = useRoute();
const showParticles = computed(() => route.path === '/application');

// 客户端启动时恢复登录态
const { fetchMe, user, isLoggedIn } = useAuth()
const { connect: wsConnect, disconnect: wsDisconnect } = useRealtime()
const { connect: wkConnect, disconnect: wkDisconnect } = useWuKongIM()
// 私信面板全局开关（单例状态）—— Header / 任意页面均通过 useChatPanel 打开
// 同一个全局 <ChatPanel>，避免重复挂载导致 WS 事件重复订阅。
const { open: chatOpen, initialPeerId: chatInitialPeerId, openChat } = useChatPanel()
// 群聊面板全局开关（单例）
const { open: groupOpen } = useGroupPanel()
onMounted(async () => {
  await fetchMe()
  if (isLoggedIn.value) {
    wsConnect()
    if (user.value) wkConnect(user.value.id)
  }
})
watch(isLoggedIn, (v) => {
  if (v) {
    wsConnect()
    if (user.value) wkConnect(user.value.id)
  } else {
    wsDisconnect()
    wkDisconnect()
  }
}, { immediate: false })
const particlesOptions = reactive({
  background: {
    color: {
      value: 'transparent'
    }
  },
  fpsLimit: 60,
  interactivity: {
    events: {
      onClick: {
        enable: true,
        mode: 'push'
      },
      onHover: {
        enable: true,
        mode: 'repulse'
      },
      resize: true
    },
    modes: {
      bubble: {
        distance: 400,
        duration: 2,
        opacity: 0.8,
        size: 40
      },
      push: {
        quantity: 4
      },
      repulse: {
        distance: 200,
        duration: 0.4
      }
    }
  },
  particles: {
    color: {
      value: '#ffffff'
    },
    links: {
      color: '#ffffff',
      distance: 150,
      enable: true,
      opacity: 0.5,
      width: 1
    },
    collisions: {
      enable: true
    },
    move: {
      direction: 'none',
      enable: true,
      outMode: 'bounce',
      random: false,
      speed: 2,
      straight: false
    },
    number: {
      density: {
        enable: true,
        area: 800
      },
      value: 80
    },
    opacity: {
      value: 0.5
    },
    shape: {
      type: 'circle'
    },
    size: {
      random: true,
      value: 5
    }
  },
  detectRetina: true
});

// 3. 创建一个计算属性，根据 themeMode 动态返回 Antd 的主题配置
// 3. Antd 主题配置 —— 绑定全局设计系统 token(字体 / 主色 / 圆角)
//    CSS 变量在 assets/css/main.css 定义;这里同步给 antd 组件。
const FONT_SANS = "'DM Sans', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
const FONT_MONO = "'JetBrains Mono', 'Fira Code', Consolas, monospace";

const antdTheme = computed(() => {
  const dark = themeMode.value === 'dark';
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      fontFamily: FONT_SANS,
      fontSize: 14,
      colorPrimary: dark ? '#ff8a5c' : '#e8502a',
      colorLink: dark ? '#ff8a5c' : '#e8502a',
      borderRadius: 10,
      wireframe: false,
    },
    components: {
      Layout: {
        colorBgHeader: 'transparent',
        colorBgBody: 'transparent',
      },
      Menu: {
        itemSelectedBg: dark ? 'rgba(255,138,92,0.16)' : 'rgba(232,80,42,0.1)',
        itemSelectedColor: dark ? '#ffb89a' : '#c2331a',
        itemHoverBg: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      },
      Table: {
        headerBg: dark ? '#232330' : '#fafafa',
        rowHoverBg: dark ? 'rgba(255,138,92,0.07)' : 'rgba(232,80,42,0.05)',
      },
      Modal: {
        contentBg: dark ? '#1a1a22' : '#ffffff',
      },
      Button: {
        controlHeight: 36,
        fontWeight: 500,
      },
      Card: {
        borderRadiusLG: 16,
      },
    },
  };
});
</script>

<template>
  <a-config-provider :theme="antdTheme">
    <NuxtParticles v-if="showParticles" id="tsparticles" :options="particlesOptions" />
    <a-layout style="min-height: 100vh;">
      <Header @open-chat="openChat" />
      <a-layout>
        <Sider />
        <a-layout-content class="main-content-area">
          <div style="padding: 30px; position: relative; z-index: 3;">
            <NuxtPage />
          </div>
        </a-layout-content>
      </a-layout>
    </a-layout>
    <ChatPanel v-model:open="chatOpen" :initial-peer-id="chatInitialPeerId" />
    <GroupChatPanel v-model:open="groupOpen" />
    <AuthModal />
  </a-config-provider>
</template>

<style>
/* 全局背景已在 assets/css/main.css 通过 body::before / ::after 固定铺满整个视口；
   此处只保留布局透明与基础排版，让玻璃面板悬浮于背景之上。 */
body {
  margin: 0;
  color: var(--text-primary);
  transition: color var(--dur) var(--ease-out);
}

/* 内容区透明：露出全局背景 */
.main-content-area {
  position: relative;
  background: transparent;
}

/* 内容区顶部细微高光，增强玻璃悬浮感（不遮挡背景） */
.main-content-area::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255,255,255,0.04), transparent 30%);
  z-index: 1;
  pointer-events: none;
}

/* --- Custom Glassmorphism Scrollbar Styles --- */
::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}

/* Use a subtle, transparent background for the track */
::-webkit-scrollbar-track {
  background: transparent;
}

/* Style the thumb with a more defined glassy effect */
::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.25); /* Darker thumb for light mode visibility */
  border-radius: 10px;
  border: 2px solid rgba(255, 255, 255, 0.1); /* Keep a light border for the glassy effect */
  background-clip: padding-box;
  /* Important for border to be visible */
}

::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.45); /* Darker hover for light mode */
}

/* Dark mode scrollbar adjustments */
html.dark ::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.15);
}

html.dark ::-webkit-scrollbar-thumb:hover {
  background-color: rgba(255, 255, 255, 0.4);
}

/* Style for the particles container */
#tsparticles {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  /* Position between overlay (1) and content (3) */
}
</style>
