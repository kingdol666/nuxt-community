<script setup lang="ts">
// GroupChatPanel.vue — 群聊浮动面板（WuKongIM 实时通讯）
// 三视图：群组列表 / 群内聊天 / 建群 / 邀请成员
// 消息收发走 WuKongIM（useWuKongIM），群组元数据走应用 API（useGroups）
import { ref, computed, watch, nextTick } from 'vue'
import { message } from 'ant-design-vue'
import {
  CloseOutlined, SendOutlined, ArrowLeftOutlined, PlusOutlined,
  TeamOutlined, UserAddOutlined, DeleteOutlined, CheckOutlined, CloseOutlined as XIcon,
  PictureOutlined, GiftOutlined,
} from '@ant-design/icons-vue'
import { useChatMedia } from '~/composables/useChatMedia'
import { textPayload, mediaPayload } from '~/composables/useWuKongIM'
import { useAuth } from '~/composables/useAuth'
import { useGroups, type GroupMember } from '~/composables/useGroups'
import { useWuKongIM } from '~/composables/useWuKongIM'
import { useRealtime } from '~/composables/useRealtime'
import { apiError } from '~/composables/useApiError'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const { user } = useAuth()
const {
  myGroups, activeGroup, invites, loading,
  avatarStyle, fetchMyGroups, fetchInvites, openGroup,
  createGroup, leaveGroup, inviteMember, respondInvite,
} = useGroups()
const { connected, errorMsg, sendGroupMessage, messagesOf } = useWuKongIM()
const { onEvent } = useRealtime()

// ─── 视图状态 ───
type View = 'list' | 'chat' | 'create' | 'invite'
const view = ref<View>('list')
const showGifPicker = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const { uploading: mediaUploading, upload } = useChatMedia()
const inputText = ref('')
const sending = ref(false)
const chatScroll = ref<HTMLElement | null>(null)

// ─── 建群表单 ───
const newGroupName = ref('')

// ─── 邀请成员：好友候选 ───
interface Friend { id: string; username: string; avatarColor: number; dir: string }
const friends = ref<Friend[]>([])
const inviteSearch = ref('')
const filteredFriends = computed(() => {
  const q = inviteSearch.value.trim().toLowerCase()
  const inGroup = new Set(activeGroup.value?.members.map((m) => m.id) || [])
  return friends.value
    .filter((f) => !inGroup.has(f.id))
    .filter((f) => !q || f.username.toLowerCase().includes(q))
})

// ─── 当前聊天群的消息流（响应式）───
const currentMessages = computed(() =>
  activeGroup.value ? messagesOf(activeGroup.value.id) : [],
)

// ─── 生命周期 ───
watch(() => props.open, async (v) => {
  if (!v) return
  view.value = 'list'
  await Promise.all([fetchMyGroups(), fetchInvites()])
})

// 监听 groupInvite / groupInviteResult WS 事件，刷新列表
let unsub: (() => void) | null = null
unsub = onEvent((e) => {
  if (e.type === 'groupInvite' || e.type === 'groupInviteResult') {
    if (props.open) {
      fetchInvites()
      fetchMyGroups()
    }
  }
})

// 新消息进入 → 自动滚到底
watch(() => currentMessages.value.length, async () => {
  if (view.value !== 'chat') return
  await nextTick()
  scrollToBottom()
})

// 群消息出现未知成员（如刚通过邀请入群）→ 静默刷新群详情补齐成员表
const triedUnknownMembers = new Set<string>()
watch(currentMessages, (msgs) => {
  if (!activeGroup.value || !msgs.length) return
  const known = new Set(activeGroup.value.members.map((m) => m.id))
  const me = user.value?.id
  for (const m of msgs) {
    if (m.fromUid === me || known.has(m.fromUid)) continue
    const key = `${activeGroup.value.id}:${m.fromUid}`
    if (triedUnknownMembers.has(key)) continue
    triedUnknownMembers.add(key)
    openGroup(activeGroup.value.id).catch(() => {})
    return
  }
})

// ─── 动作 ───
function close() { emit('update:open', false) }

async function enterChat(groupId: string) {
  try {
    await openGroup(groupId)
    view.value = 'chat'
    await nextTick()
    scrollToBottom()
  } catch (e: unknown) {
    message.error(apiError(e, '打开群聊失败'))
  }
}

function backToList() {
  view.value = 'list'
  activeGroup.value = null
  fetchMyGroups().catch(() => {})
}

async function doCreateGroup() {
  const name = newGroupName.value.trim()
  if (!name) { message.warning('请输入群名称'); return }
  try {
    const g = await createGroup(name)
    newGroupName.value = ''
    message.success('群组已创建')
    await enterChat(g.id)
  } catch (e: unknown) {
    message.error(apiError(e, '创建失败'))
  }
}

async function doLeave() {
  if (!activeGroup.value) return
  const isOwner = activeGroup.value.isOwner
  const hint = isOwner ? '你是群主，退出将解散该群。确定？' : '确定退出该群？'
  // 用浏览器原生 confirm（轻量，避免引入额外组件）
  if (!window.confirm(hint)) return
  try {
    await leaveGroup(activeGroup.value.id)
    message.success(isOwner ? '群组已解散' : '已退出群组')
    backToList()
  } catch (e: unknown) {
    message.error(apiError(e, '操作失败'))
  }
}

async function openInvitePicker() {
  if (!activeGroup.value) return
  view.value = 'invite'
  inviteSearch.value = ''
  // 拉取好友（关注者 + 粉丝），服务端已校验好友关系，这里仅展示候选
  try {
    const uid = user.value?.id
    if (!uid) return
    const [following, followers] = await Promise.all([
      $fetch<{ users: Array<{ id: string; username: string; avatarColor: number }> }>(
        '/api/follows', { params: { userId: uid, dir: 'following' } },
      ),
      $fetch<{ users: Array<{ id: string; username: string; avatarColor: number }> }>(
        '/api/follows', { params: { userId: uid, dir: 'followers' } },
      ),
    ])
    // 合并去重
    const map = new Map<string, Friend>()
    for (const u of following.users || []) map.set(u.id, { ...u, dir: '我关注的人' })
    for (const u of followers.users || []) {
      if (!map.has(u.id)) map.set(u.id, { ...u, dir: '我的粉丝' })
    }
    friends.value = [...map.values()]
  } catch {
    friends.value = []
  }
}

async function doInvite(f: Friend) {
  if (!activeGroup.value) return
  try {
    await inviteMember(activeGroup.value.id, f.id)
    message.success(`已向 ${f.username} 发送邀请`)
  } catch (e: unknown) {
    message.error(apiError(e, '邀请失败'))
  }
}

async function doRespond(inviteId: string, action: 'accept' | 'decline') {
  try {
    await respondInvite(inviteId, action)
    message.success(action === 'accept' ? '已加入群组' : '已拒绝')
  } catch (e: unknown) {
    message.error(apiError(e, '操作失败'))
  }
}

async function send() {
  if (!activeGroup.value || !inputText.value.trim() || sending.value) return
  if (!connected.value) {
    message.error(errorMsg.value || 'IM 未连接，无法发送')
    return
  }
  const text = inputText.value
  inputText.value = ''
  sending.value = true
  try {
    const ok = await sendGroupMessage(activeGroup.value.id, textPayload(text))
    if (!ok) message.error(errorMsg.value || '发送失败')
    await nextTick()
    scrollToBottom()
  } finally {
    sending.value = false
  }
}

function triggerImageUpload() {
  fileInput.value?.click()
}

async function onFileSelected(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file || !activeGroup.value || !connected.value) return
  sending.value = true
  try {
    const media = await upload(file)
    if (!media) { message.error('上传失败'); return }
    const ok = await sendGroupMessage(
      activeGroup.value.id, mediaPayload(media.msgType, media.url, media.width, media.height),
    )
    if (!ok) message.error(errorMsg.value || '发送失败')
    await nextTick()
    scrollToBottom()
  } finally {
    sending.value = false
  }
}

async function onGifSelected(gif: { url: string }) {
  showGifPicker.value = false
  if (!activeGroup.value || !connected.value) return
  sending.value = true
  try {
    const ok = await sendGroupMessage(activeGroup.value.id, mediaPayload(3, gif.url))
    if (!ok) message.error(errorMsg.value || '发送失败')
    await nextTick()
    scrollToBottom()
  } finally {
    sending.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
}

function scrollToBottom() {
  const el = chatScroll.value
  if (el) el.scrollTop = el.scrollHeight
}

// ─── 渲染辅助 ───
function memberName(uid: string): string {
  const m = activeGroup.value?.members.find((mm) => mm.id === uid)
  return m?.username || '未知'
}
function memberColor(uid: string): number {
  return activeGroup.value?.members.find((mm) => mm.id === uid)?.avatarColor ?? 0
}
function isMine(uid: string): boolean {
  return uid === user.value?.id
}
function timeFmt(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
</script>

<template>
  <Teleport to="body">
    <Transition name="chat-slide">
      <div v-if="open" class="group-panel glass-strong">
        <header class="gp-header">
          <button v-if="view !== 'list'" class="gp-back" @click="view === 'chat' || view === 'invite' ? (view === 'invite' ? (view = 'chat') : backToList()) : backToList()" aria-label="返回">
            <ArrowLeftOutlined />
          </button>
          <h3 class="gp-title">
            <TeamOutlined v-if="view === 'list'" />
            <span v-if="view === 'list'">群聊</span>
            <span v-else-if="view === 'chat' && activeGroup">{{ activeGroup.name }}</span>
            <span v-else-if="view === 'create'">创建群组</span>
            <span v-else-if="view === 'invite'">邀请成员</span>
            <span v-if="view === 'list' && invites.length" class="gp-badge">{{ invites.length }}</span>
          </h3>
          <button class="gp-close" @click="close" aria-label="关闭"><CloseOutlined /></button>
        </header>

        <div class="gp-body">
          <!-- ══════ 群组列表 ══════ -->
          <template v-if="view === 'list'">
            <!-- 待处理邀请 -->
            <div v-if="invites.length" class="invite-list">
              <div v-for="inv in invites" :key="inv.id" class="invite-card">
                <div class="invite-info">
                  <span class="invite-text"><b>{{ inv.fromUsername }}</b> 邀请你加入「{{ inv.groupName }}」</span>
                </div>
                <div class="invite-actions">
                  <button class="inv-btn accept" @click="doRespond(inv.id, 'accept')"><CheckOutlined /> 同意</button>
                  <button class="inv-btn decline" @click="doRespond(inv.id, 'decline')"><XIcon /> 拒绝</button>
                </div>
              </div>
            </div>

            <button class="gp-create-btn" @click="view = 'create'; newGroupName = ''">
              <PlusOutlined /> 创建新群组
            </button>

            <div v-if="loading" class="gp-hint">加载中…</div>
            <div v-else-if="!myGroups.length" class="gp-empty">
              <TeamOutlined class="empty-icon" />
              <p>还没有群组</p>
              <span>创建一个群，邀请你的好友一起聊天</span>
            </div>
            <div v-else class="group-list">
              <button v-for="g in myGroups" :key="g.id" class="group-item" @click="enterChat(g.id)">
                <span class="group-avatar" :style="avatarStyle(g.avatarColor)">
                  {{ g.name.charAt(0).toUpperCase() }}
                </span>
                <div class="group-meta">
                  <span class="group-name">{{ g.name }}</span>
                  <span class="group-sub">{{ g.memberCount }} 人{{ g.isOwner ? ' · 群主' : '' }}</span>
                </div>
              </button>
            </div>
          </template>

          <!-- ══════ 建群 ══════ -->
          <template v-else-if="view === 'create'">
            <div class="form-area">
              <label class="form-label">群组名称</label>
              <a-input v-model:value="newGroupName" placeholder="给你的群起个名字" :maxlength="40" @pressEnter="doCreateGroup" />
              <button class="gp-action-btn" :disabled="!newGroupName.trim()" @click="doCreateGroup">
                <PlusOutlined /> 创建群组
              </button>
            </div>
          </template>

          <!-- ══════ 群内聊天 ══════ -->
          <template v-else-if="view === 'chat' && activeGroup">
            <div class="chat-members-bar">
              <span v-for="m in activeGroup.members.slice(0, 8)" :key="m.id" class="mini-avatar" :style="avatarStyle(m.avatarColor)" :title="m.username">
                {{ m.username.charAt(0).toUpperCase() }}
              </span>
              <span v-if="activeGroup.members.length > 8" class="more-count">+{{ activeGroup.members.length - 8 }}</span>
              <div class="chat-actions">
                <button class="chat-act" @click="openInvitePicker"><UserAddOutlined /> 邀请</button>
                <button class="chat-act danger" @click="doLeave"><DeleteOutlined /> {{ activeGroup.isOwner ? '解散' : '退出' }}</button>
              </div>
            </div>

            <div ref="chatScroll" class="chat-thread">
              <div v-if="!currentMessages.length" class="gp-hint center">
                还没有消息，发一句打个招呼吧 👋
              </div>
              <div v-for="msg in currentMessages" :key="msg.messageId" class="gmsg" :class="{ mine: isMine(msg.fromUid) }">
                <span v-if="!isMine(msg.fromUid)" class="gmsg-avatar" :style="avatarStyle(memberColor(msg.fromUid))">
                  {{ memberName(msg.fromUid).charAt(0).toUpperCase() }}
                </span>
                <div class="gmsg-content">
                  <div class="gmsg-meta">
                    <span class="gmsg-name">{{ isMine(msg.fromUid) ? '我' : memberName(msg.fromUid) }}</span>
                    <span class="gmsg-time">{{ timeFmt(msg.timestamp) }}</span>
                  </div>
                  <div class="gmsg-bubble">
                    <MessageContent
                      :type="msg.payload.type"
                      :text="msg.payload.type === 1 ? msg.payload.text : ''"
                      :url="msg.payload.type !== 1 ? msg.payload.url : ''"
                      :w="msg.payload.type !== 1 ? msg.payload.w : undefined"
                      :h="msg.payload.type !== 1 ? msg.payload.h : undefined"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div class="chat-input-area">
              <div class="im-status" :class="{ on: connected }">
                {{ connected ? 'IM 已连接' : (errorMsg || 'IM 未连接') }}
              </div>
              <div class="gp-input-row">
                <div class="input-toolbar">
                  <button class="tool-btn" :disabled="!connected || mediaUploading" @click="triggerImageUpload" title="发送图片" aria-label="发送图片">
                    <PictureOutlined />
                  </button>
                  <button class="tool-btn" :disabled="!connected || mediaUploading" @click="showGifPicker = !showGifPicker" title="GIF 表情" aria-label="GIF">
                    <GiftOutlined />
                  </button>
                  <input
                    ref="fileInput"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                    style="display:none"
                    @change="onFileSelected"
                  />
                </div>
                <a-textarea
                  v-model:value="inputText"
                  :placeholder="mediaUploading ? '上传中…' : (connected ? '发送消息…（Enter 发送，Shift+Enter 换行）' : '正在连接 IM…')"
                  :rows="2"
                  :maxlength="1000"
                  :disabled="!connected"
                  @keydown="onKeydown"
                />
                <button class="send-btn" :disabled="!inputText.trim() || !connected || sending" @click="send">
                  <SendOutlined /> {{ sending ? '发送中…' : '发送' }}
                </button>
              </div>
              <GifPicker :open="showGifPicker" @select="onGifSelected" @close="showGifPicker = false" />
            </div>
          </template>

          <!-- ══════ 邀请成员 ══════ -->
          <template v-else-if="view === 'invite'">
            <a-input v-model:value="inviteSearch" placeholder="搜索好友…" allow-clear class="invite-search" />
            <div v-if="!filteredFriends.length" class="gp-hint center">
              没有可邀请的好友（只能邀请你的关注者或粉丝）
            </div>
            <div v-else class="friend-list">
              <div v-for="f in filteredFriends" :key="f.id" class="friend-item">
                <span class="friend-avatar" :style="avatarStyle(f.avatarColor)">{{ f.username.charAt(0).toUpperCase() }}</span>
                <div class="friend-meta">
                  <span class="friend-name">{{ f.username }}</span>
                  <span class="friend-tag">{{ f.dir }}</span>
                </div>
                <button class="inv-btn accept" @click="doInvite(f)"><UserAddOutlined /> 邀请</button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="less">
.group-panel {
  position: fixed; top: 50%; right: 24px; transform: translateY(-50%);
  width: 400px; height: 600px; max-height: 80vh;
  display: flex; flex-direction: column; z-index: 2000;
  border-radius: 18px; overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,.28);
}
.gp-header {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 16px; border-bottom: 1px solid var(--border);
  background: var(--glass-bg, rgba(255,255,255,.08));
}
.gp-back, .gp-close {
  background: none; border: none; cursor: pointer; font-size: 16px;
  color: var(--text-secondary); padding: 6px; border-radius: 8px;
  display: flex; align-items: center;
}
.gp-back:hover, .gp-close:hover { background: var(--hover-bg, rgba(0,0,0,.06)); color: var(--text-primary); }
.gp-title { flex: 1; margin: 0; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 6px; color: var(--text-primary); }
.gp-badge {
  background: var(--danger, #ef4444); color: #fff; font-size: 11px;
  min-width: 18px; height: 18px; border-radius: 9px; padding: 0 5px;
  display: inline-flex; align-items: center; justify-content: center;
}
.gp-body { flex: 1; overflow-y: auto; padding: 12px; }

/* 邀请卡片 */
.invite-list { margin-bottom: 12px; }
.invite-card {
  background: var(--glass-bg, rgba(255,255,255,.06)); border: 1px solid var(--border);
  border-radius: 12px; padding: 10px 12px; margin-bottom: 8px;
}
.invite-text { font-size: 13px; color: var(--text-primary); }
.invite-actions { display: flex; gap: 8px; margin-top: 8px; }
.inv-btn {
  border: none; cursor: pointer; font-size: 12px; padding: 5px 12px;
  border-radius: 8px; display: inline-flex; align-items: center; gap: 4px; transition: all .15s;
}
.inv-btn.accept { background: var(--accent, #e8502a); color: #fff; }
.inv-btn.accept:hover { opacity: .85; }
.inv-btn.decline { background: var(--glass-bg, rgba(0,0,0,.08)); color: var(--text-secondary); }
.inv-btn.decline:hover { background: var(--hover-bg); }

.gp-create-btn {
  width: 100%; border: 1px dashed var(--accent, #e8502a); background: none;
  color: var(--accent, #e8502a); cursor: pointer; padding: 10px;
  border-radius: 12px; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 6px;
  margin-bottom: 12px; transition: all .15s;
}
.gp-create-btn:hover { background: rgba(99,102,241,.08); }
.gp-empty, .gp-hint { text-align: center; color: var(--text-muted); padding: 30px 0; font-size: 13px; }
.gp-hint.center { padding: 60px 0; }
.empty-icon { font-size: 40px; display: block; margin-bottom: 10px; opacity: .4; }

/* 群组列表 */
.group-list { display: flex; flex-direction: column; gap: 4px; }
.group-item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  background: none; border: none; cursor: pointer; padding: 10px;
  border-radius: 12px; transition: background .15s; text-align: left;
}
.group-item:hover { background: var(--hover-bg, rgba(0,0,0,.06)); }
.group-avatar {
  width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 18px; font-weight: 600;
}
.group-meta { flex: 1; min-width: 0; }
.group-name { display: block; font-size: 14px; font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-sub { font-size: 12px; color: var(--text-muted); }

/* 建群表单 */
.form-area { display: flex; flex-direction: column; gap: 12px; padding-top: 20px; }
.form-label { font-size: 13px; color: var(--text-secondary); }
.gp-action-btn {
  background: var(--accent, #e8502a); color: #fff; border: none; cursor: pointer;
  padding: 10px; border-radius: 10px; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 6px;
}
.gp-action-btn:disabled { opacity: .5; cursor: not-allowed; }

/* 聊天视图 */
.chat-members-bar {
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  padding: 8px 4px; border-bottom: 1px solid var(--border); margin-bottom: 8px;
}
.mini-avatar {
  width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 12px; font-weight: 600;
}
.more-count { font-size: 12px; color: var(--text-muted); margin-left: 4px; }
.chat-actions { margin-left: auto; display: flex; gap: 6px; }
.chat-act {
  background: none; border: 1px solid var(--border); cursor: pointer; font-size: 12px;
  padding: 4px 10px; border-radius: 8px; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 4px;
}
.chat-act:hover { background: var(--hover-bg); color: var(--text-primary); }
.chat-act.danger:hover { color: var(--danger, #ef4444); border-color: var(--danger, #ef4444); }

.chat-thread { flex: 1; overflow-y: auto; padding: 4px 0; display: flex; flex-direction: column; gap: 10px; }
.gmsg { display: flex; gap: 8px; }
.gmsg.mine { flex-direction: row-reverse; }
.gmsg-avatar {
  width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 13px; font-weight: 600;
}
.gmsg-content { max-width: 72%; }
.gmsg.mine .gmsg-content { display: flex; flex-direction: column; align-items: flex-end; }
.gmsg-meta { display: flex; gap: 6px; align-items: baseline; margin-bottom: 3px; }
.gmsg.mine .gmsg-meta { flex-direction: row-reverse; }
.gmsg-name { font-size: 12px; color: var(--text-muted); }
.gmsg-time { font-size: 10px; color: var(--text-muted); opacity: .7; }
.gmsg-bubble {
  background: var(--glass-bg, rgba(255,255,255,.1)); padding: 8px 12px; border-radius: 14px;
  font-size: 14px; color: var(--text-primary); word-break: break-word; line-height: 1.5;
}
.gmsg.mine .gmsg-bubble { background: var(--accent, #e8502a); color: #fff; }

.chat-input-area { padding-top: 8px; border-top: 1px solid var(--border); }
.im-status { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.im-status.on::before { content: '● '; color: #10b981; }
.gp-input-row { display: flex; align-items: flex-end; gap: 6px; }
.input-toolbar { display: flex; align-items: center; gap: 2px; flex-shrink: 0; padding-bottom: 4px; }
.tool-btn {
  background: transparent; border: none; color: var(--text-muted);
  width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; transition: all .15s;
}
.tool-btn:hover:not(:disabled) { background: var(--hover-bg); color: var(--accent, #e8502a); }
.tool-btn:disabled { opacity: .4; cursor: not-allowed; }
.send-btn {
  flex-shrink: 0; padding: 9px 16px; background: var(--accent, #e8502a); color: #fff;
  border: none; cursor: pointer; border-radius: 10px;
  font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 6px;
}
.send-btn:disabled { opacity: .5; cursor: not-allowed; }

/* 邀请好友 */
.invite-search { margin-bottom: 12px; }
.friend-list { display: flex; flex-direction: column; gap: 4px; }
.friend-item {
  display: flex; align-items: center; gap: 10px; padding: 8px;
  border-radius: 10px; transition: background .15s;
}
.friend-item:hover { background: var(--hover-bg, rgba(0,0,0,.06)); }
.friend-avatar {
  width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 14px; font-weight: 600;
}
.friend-meta { flex: 1; min-width: 0; }
.friend-name { font-size: 14px; color: var(--text-primary); }
.friend-tag { font-size: 11px; color: var(--text-muted); margin-left: 6px; }
</style>
