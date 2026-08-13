// nuxt.config.ts
//
// 配置优先：构建期从 config.yml 读取 server.host/devPort/prodPort 与
// data.dataDir/authSecret，注入 devServer / nitro / runtimeConfig。
// 运行期热重载由 server/utils/appConfig.ts 负责（端口/主机等启动键除外）。
// config.yml 缺失或格式错误时回退内置默认，绝不阻断构建。
import Components from 'unplugin-vue-components/vite';
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers';
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

function readUserConfig(): Record<string, any> {
  try {
    const raw = readFileSync(join(process.cwd(), 'config.yml'), 'utf8')
    return raw.trim() ? parseYaml(raw) : {}
  } catch {
    return {}
  }
}
const _cfg = readUserConfig()
const _srv = _cfg?.server ?? {}
const _data = _cfg?.data ?? {}
const cfgHost = typeof _srv.host === 'string' && _srv.host ? _srv.host : '0.0.0.0'
const cfgDevPort = Number(_srv.devPort) || 3000
const cfgProdPort = Number(_srv.prodPort) || 3000
const cfgDataDir = typeof _data.dataDir === 'string' ? _data.dataDir : ''
const cfgAuthSecret = typeof _data.authSecret === 'string' && _data.authSecret ? _data.authSecret : 'nuxt-app-dev-secret-change-in-prod'
export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: true },
  // 开发服务器端口/主机：config.yml → 环境变量覆盖
  devServer: {
    host: process.env.NUXT_DEV_HOST || cfgHost,
    port: Number(process.env.NUXT_DEV_PORT) || cfgDevPort,
  },
  // 「首页 /」现在是一个独立的落地页（pages/index.vue），不再重定向。
  runtimeConfig: {
    dataDir: process.env.NUXT_DATA_DIR || cfgDataDir,
    authSecret: process.env.NUXT_AUTH_SECRET || cfgAuthSecret,
    prodPort: cfgProdPort,
  },
  // WebSocket 实时通信（关注/私信/通知）—— Nitro crossws 适配器
  nitro: {
    experimental: {
      websocket: true,
    },
  },

  // 全局设计系统 CSS(字体 / 配色 token)
  css: ['~/assets/css/main.css'],

  // 引入 Web 字体(Inter + Noto Sans SC),含系统字体回退
  app: {
    // 页面切换过渡（配合 main.css 的 .page-* 类）
    pageTransition: { name: 'page', mode: 'out-in' },
    head: {
      link: [
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@600;700;900&family=JetBrains+Mono:wght@400;500&display=swap',
        },
      ],
    },
  },
  // 你已有的模块
  modules: [
    '@pinia/nuxt',
    'nuxt-particles'
  ],

  vite: {
    server: {
      watch: {
        // data/*.json 在运行时由后台管理 API 原子写入；忽略其变更，避免
        // 触发对「静态 import 了这些种子 JSON 的 Pinia store」的客户端 HMR，
        // 否则每次增删改都会热重载 admin.vue / application.vue（Dev 专属问题，
        // 生产构建无文件监听，不受影响）。
        ignored: ['**/data/**', '**/config.yml', '**/config.yml.tmp'],
      },
    },
    ssr: {
      // ant-design-vue 必须由 Vite 处理（而非 externalize），否则 SSR 与
      // 客户端组件实例不一致，导致 Tabs 等有状态组件切换失效 / 水合错乱。
      noExternal: ['ant-design-vue', '@ant-design/icons-vue', '@ant-design/cssinjs'],
    },
    plugins: [
      Components({
        resolvers: [
          AntDesignVueResolver({
            // 'true' 表示自动引入 antd 的 less 样式文件
            importStyle: 'less', 
            // Antd v4+ 的图标需要单独引入，这里设置为 true 会自动处理
            resolveIcons: true,
   
          }),
        ],
      }),
    ],
    // 配置 less 变量，用于自定义 antd 主题
    css: {
      preprocessorOptions: {
        less: {
          // 在这里添加你的 less 变量来自定义 antd 主题
          modifyVars: {
            // 'primary-color': '#1DA57A',
            // 'link-color': '#1DA57A',
            // 'border-radius-base': '2px',
          },
          javascriptEnabled: true,
        },
      },
    },
  },
  
  // 不再需要从 app.head 中引入 antd 的 CSS
  // 也不再需要使用 app:created hook
})
