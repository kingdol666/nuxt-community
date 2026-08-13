// composables/useWuKongIM.ts
//
// WuKongIM 客户端单例（基于 easyjssdk）。
// 职责：
//   1. 登录后用业务 user.id 连接 WuKongIM（ws:5200）
//   2. 收发群组消息（频道 grp_<groupId>，channelType=Group）
//   3. 收发私信（频道=对方 uid，channelType=Person）→ 桥接给 useMessages
//   4. 连接状态 / 错误对 UI 可见
//
// 设计：模块级单例（一个 WS 连接跨所有 useWuKongIM 调用共享），
// 与 useRealtime 的自有 WS 互不干扰 —— WuKongIM 为主传输，自有 WS 为降级回退。
import { useState } from '#imports'
import { useSiteConfig } from './useSiteConfig'
// easyjssdk 同时支持 Browser 和 Node.js（经 ws 包），静态导入 SSR 安全。
import { WKIM, WKIMChannelType, WKIMEvent } from 'easyjssdk'
import type { RecvMessage } from 'easyjssdk'
import { apiError } from './useApiError'

// easyjssdk 的 SendResult 未导出，这里定义我们用到的最小子集
interface SendResultLike {
  messageId: string
  messageSeq: number
  reasonCode: number
}
// ── 消息载荷（应用层协议，与发送端对齐）──────────────────────────────
// type: 1=文本  2=图片  3=GIF/表情图
export const MSG_TEXT = 1 as const
export const MSG_IMAGE = 2 as const
export const MSG_GIF = 3 as const
export type MsgType = typeof MSG_TEXT | typeof MSG_IMAGE | typeof MSG_GIF

export interface TextPayload { type: typeof MSG_TEXT; text: string }
export interface MediaPayload {
  type: typeof MSG_IMAGE | typeof MSG_GIF
  url: string; w?: number; h?: number; name?: string
}
export type MsgPayload = TextPayload | MediaPayload

/** 构造文本载荷 */
export function textPayload(text: string): TextPayload { return { type: MSG_TEXT, text } }
/** 构造图片/GIF 载荷 */
export function mediaPayload(
  type: typeof MSG_IMAGE | typeof MSG_GIF,
  url: string, w?: number, h?: number, name?: string,
): MediaPayload { return { type, url, w, h, name } }

export interface GroupMessage {
  messageId: string
  channelId: string // grp_<groupId>
  fromUid: string
  payload: MsgPayload
  timestamp: number
}

/** 收到的私信（WuKongIM Person 频道）—— 供 useMessages 桥接 */
export interface PrivateMessage {
  fromUid: string
  payload: MsgPayload
  timestamp: number
}

// 模块级私信订阅者集合（跨 useWuKongIM 调用共享）
type PrivateMsgHandler = (msg: PrivateMessage) => void
const privateMsgSubscribers = new Set<PrivateMsgHandler>()

// 模块级单例：一个 im 实例 + 当前连接 uid
let imInstance: WKIM | null = null
let connectedUid: string | null = null

export const useWuKongIM = () => {
  const connected = useState<boolean>('wk-connected', () => false)
  const errorMsg = useState<string>('wk-error', () => '')
  // 按 channelId 分组的实时消息流
  const channelMessages = useState<Record<string, GroupMessage[]>>('wk-channel-msgs', () => ({}))

  /** 把 WuKongIM RecvMessage.payload 归一化为 MsgPayload（文本/图片/GIF）。
   *  payload 可能是对象、JSON 字符串、或 base64。 */
  function normalizePayload(p: unknown): MsgPayload | null {
    let obj: unknown = p
    if (typeof p === 'string') {
      try { obj = JSON.parse(p) } catch { return null }
    }
    if (!obj || typeof obj !== 'object' || !('type' in obj)) return null
    const o = obj as Record<string, unknown>
    const t = Number(o.type)
    if (t === MSG_TEXT && typeof o.text === 'string') {
      return { type: MSG_TEXT, text: o.text }
    }
    if ((t === MSG_IMAGE || t === MSG_GIF) && typeof o.url === 'string') {
      return { type: t, url: o.url, w: Number(o.w) || undefined, h: Number(o.h) || undefined, name: typeof o.name === 'string' ? o.name : undefined }
    }
    return null
  }

  /** 把收到的 WuKongIM RecvMessage 归一化，按频道类型分发：
   *  channelType=2 (群组) → channelMessages 流；channelType=1 (私信) → privateMsgSubscribers */
  function ingest(raw: RecvMessage): void {
    const channelId: string = raw.channelId || ''
    const payload = normalizePayload(raw.payload)
    if (!payload) return

    // ── 私信 (Person, channelType=1)：fromUid=发送者 → 通知订阅者 ──
    if (raw.channelType === 1 && raw.fromUid) {
      for (const handler of privateMsgSubscribers) {
        try {
          handler({ fromUid: raw.fromUid, payload, timestamp: raw.timestamp ? raw.timestamp * 1000 : Date.now() })
        } catch {
          /* 单个订阅者异常不影响其他 */
        }
      }
      return
    }

    // ── 群组 (Group, channelType=2)：写入频道消息流 ──
    if (!channelId) return
    const gm: GroupMessage = {
      messageId: raw.messageId,
      channelId,
      fromUid: raw.fromUid,
      payload,
      timestamp: raw.timestamp ? raw.timestamp * 1000 : Date.now(),
    }
    const bucket = { ...channelMessages.value }
    ;(bucket[channelId] ||= []).push(gm)
    channelMessages.value = bucket
  }

  /** 连接 WuKongIM（已连接同一 uid 时跳过） */
  async function connect(uid: string): Promise<boolean> {
    const { config } = useSiteConfig()
    if (!config.value.wukongim.enabled) {
      errorMsg.value = 'WuKongIM 未启用'
      return false
    }
    if (!import.meta.client) return false
    if (imInstance && connectedUid === uid && connected.value) return true

    disconnect()
    const wsURL = config.value.wukongim.wsURL
    // 开发态关闭 token-auth：token 用确定性占位值
    imInstance = WKIM.init(wsURL, { uid, token: 'wk-dev-token' })

    imInstance.on(WKIMEvent.Connect, () => {
      connected.value = true
      errorMsg.value = ''
    })
    imInstance.on(WKIMEvent.Disconnect, (info: { code?: number; reason?: string }) => {
      connected.value = false
      if (info?.reason) errorMsg.value = String(info.reason)
    })
    imInstance.on(WKIMEvent.Error, (err: { message?: string } | string) => {
      errorMsg.value = typeof err === 'string' ? err : (err?.message || 'IM 错误')
    })
    imInstance.on(WKIMEvent.Message, (message: RecvMessage) => ingest(message))

    connectedUid = uid
    try {
      await imInstance.connect()
      return true
    } catch (e: unknown) {
      errorMsg.value = apiError(e, '连接 WuKongIM 失败')
      return false
    }
  }

  /** 断开连接 */
  function disconnect(): void {
    if (imInstance) {
      try {
        imInstance.disconnect()
      } catch {
        /* 忽略 */
      }
      imInstance = null
    }
    connectedUid = null
    connected.value = false
  }

  /**
   * 发送群聊消息。
   * @param groupId 群组 id（映射到频道 grp_<groupId>）
   * @param payload 消息载荷（文本/图片/GIF）
   */
  async function sendGroupMessage(groupId: string, payload: MsgPayload): Promise<boolean> {
    if (!imInstance || !connected.value) {
      errorMsg.value = '未连接到 IM 服务'
      return false
    }
    const channelId = 'grp_' + groupId
    let res: SendResultLike
    try {
      res = await imInstance.send(channelId, WKIMChannelType.Group, payload)
    } catch (e: unknown) {
      errorMsg.value = apiError(e, '发送失败')
      return false
    }
    // 乐观追加到本地流（WuKongIM 不会把自发消息回推给发送者）
    const bucket = { ...channelMessages.value }
    ;(bucket[channelId] ||= []).push({
      messageId: res.messageId,
      channelId,
      fromUid: connectedUid || '',
      payload,
      timestamp: Date.now(),
    })
    channelMessages.value = bucket
    return res.reasonCode === 1
  }

  /**
   * 发送私信（Person 频道）。
   * @param toUserId 接收者 user.id（= WuKongIM uid，作为 channel_id）
   * @param payload  消息载荷（文本/图片/GIF）
   * @return true 表示 WuKongIM 已接收（对方在线则即时收到，离线则 WuKongIM 离线补投）
   */
  async function sendPrivateMessage(toUserId: string, payload: MsgPayload): Promise<boolean> {
    if (!imInstance || !connected.value) return false
    try {
      const res: SendResultLike = await imInstance.send(toUserId, WKIMChannelType.Person, payload)
      return res.reasonCode === 1
    } catch (e: unknown) {
      errorMsg.value = apiError(e, '私信发送失败')
      return false
    }
  }

  /** 取某群的实时消息流（oldest→newest） */
  function messagesOf(groupId: string): GroupMessage[] {
    return channelMessages.value['grp_' + groupId] || []
  }

  /** 清空某群的消息流 */
  function clearChannel(groupId: string): void {
    const bucket = { ...channelMessages.value }
    delete bucket['grp_' + groupId]
    channelMessages.value = bucket
  }

  /** 订阅 WuKongIM 私信（Person 频道消息）。返回取消订阅函数。 */
  function onPrivateMessage(handler: PrivateMsgHandler): () => void {
    privateMsgSubscribers.add(handler)
    return () => { privateMsgSubscribers.delete(handler) }
  }

  return {
    connected,
    errorMsg,
    connect,
    disconnect,
    sendGroupMessage,
    sendPrivateMessage,
    messagesOf,
    clearChannel,
    onPrivateMessage,
  }
}
