// scripts/api_full_test.mjs
//
// 全量 API + 实时通讯降级通道端到端测试
// 覆盖 server/api 下全部 HTTP 端点（认证/用户/帖子/评论/收藏/关注/私信/
// 群组/标签/分类/话题/内容/配置/评分/上传/媒体/海报）+ 自有 WebSocket
// 降级通道（认证/心跳/实时推送/离线补投/关注通知）。
//
// 前置：npm run dev（3000）+ WuKongIM（5001/5200，可选，本脚本不依赖）
// 运行：node scripts/api_full_test.mjs
import WebSocket from 'ws'

const BASE = 'http://localhost:3000'
const WS_URL = 'ws://localhost:3000/_ws'
const TS = Date.now()
const PW = 'e2epw12345'

let pass = 0
let fail = 0
const failedList = []

function section(t) { console.log(`\n${'═'.repeat(58)}\n  ${t}\n${'═'.repeat(58)}`) }
function check(n, c, d = '') {
  console.log(`  ${c ? '✅' : '❌'} ${n}${!c && d ? ` → ${d}` : ''}`)
  c ? pass++ : (fail++, failedList.push(`${n} ${d}`))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Cookie jar（仅保留 auth_token=... 名值对）──────────────────────────
function makeJar() {
  let cookie = ''
  return {
    get cookie() { return cookie },
    set(res) {
      const sc = res.headers.get('set-cookie')
      if (!sc) return
      const m = sc.split(';').map((s) => s.trim()).find((s) => s.startsWith('auth_token='))
      if (m) cookie = m
    },
  }
}

// ── HTTP helper ─────────────────────────────────────────────────────────
async function req(path, opts = {}, jar = null) {
  const { body, headers: extra = {}, ...rest } = opts
  const headers = { ...extra }
  let payload = body
  if (body !== undefined && typeof body !== 'string' && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  if (jar?.cookie) headers.cookie = jar.cookie
  const res = await fetch(BASE + path, { ...rest, headers, body: payload })
  jar?.set(res)
  const ct = res.headers.get('content-type') || ''
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text()
  return { status: res.status, data, headers: res.headers }
}

// ── 注册或登录 ─────────────────────────────────────────────────────────
async function registerLogin(username) {
  const jar = makeJar()
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PW }),
  }).catch(() => {}) // 已存在则忽略
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PW }),
  })
  jar.set(res)
  const body = await res.json()
  return { id: body.id, username, jar }
}

// ── WS 连接（cookie 认证）───────────────────────────────────────────────
function wsConnect(jar, label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { cookie: jar.cookie } })
    const received = []
    ws.on('message', (d) => {
      try { received.push(JSON.parse(d.toString())) } catch { /* ignore */ }
    })
    const to = setTimeout(() => { ws.terminate(); reject(new Error(`${label} WS 连接超时`)) }, 8000)
    ws.on('open', () => {
      clearTimeout(to)
      resolve({
        ws,
        received,
        waitFor(type, pred, ms = 4000) {
          return new Promise((r) => {
            const since = received.length
            const iv = setInterval(() => {
              const hit = received.slice(since).find((m) => m.type === type && (!pred || pred(m)))
              if (hit) { clearInterval(iv); r(hit) }
            }, 100)
            setTimeout(() => { clearInterval(iv); r(null) }, ms)
          })
        },
      })
    })
    ws.on('error', (e) => { clearTimeout(to); reject(e) })
  })
}

// ══════════════════════════════════════════════════════════════════════
async function main() {
  // ── AUTH ────────────────────────────────────────────────────────────
  section('1. 认证 auth（register / login / me / logout）')
  const alice = await registerLogin(`e2e_alice_${TS}`)
  const bob = await registerLogin(`e2e_bob_${TS}`)
  check('注册 Alice', !!alice.id, `id=${alice.id}`)
  check('注册 Bob', !!bob.id && bob.id !== alice.id)

  let r = await req('/api/auth/register', { method: 'POST', body: { username: alice.username, password: PW } })
  check('重复注册被拒', r.status === 409, `status=${r.status}`)
  r = await req('/api/auth/register', { method: 'POST', body: { username: 'x', password: PW } })
  check('短用户名被拒', r.status === 400, `status=${r.status}`)

  r = await req('/api/auth/login', { method: 'POST', body: { username: alice.username, password: PW } }, alice.jar)
  check('登录成功返回用户', r.status === 200 && r.data?.username === alice.username, `status=${r.status}`)
  r = await req('/api/auth/login', { method: 'POST', body: { username: bob.username, password: 'wrongpass' } })
  check('错误密码被拒', r.status >= 400, `status=${r.status}`)

  r = await req('/api/auth/me', {}, alice.jar)
  check('me 认证态', r.status === 200 && r.data?.id === alice.id)
  r = await req('/api/auth/me')
  check('me 未认证 → null', r.status === 204 || r.data === null, `status=${r.status}`)

  // 管理员（种子账号 admin/admin23）
  const admin = makeJar()
  r = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin23' } }, admin)
  check('管理员登录', r.status === 200 && r.data?.role === 'admin', `status=${r.status} role=${r.data?.role}`)

  // ── USERS ───────────────────────────────────────────────────────────
  section('2. 用户 users（profile 更新 / 公开主页）')
  r = await req('/api/users/profile', { method: 'PUT', body: { bio: `简介_${TS}` } }, alice.jar)
  check('更新个人简介', r.status === 200 && r.data?.bio === `简介_${TS}`, `status=${r.status}`)
  r = await req('/api/users/profile', { method: 'PUT', body: { avatarUrl: 'https://evil.com/x.png' } }, alice.jar)
  check('非法头像地址被拒', r.status === 400, `status=${r.status}`)
  r = await req(`/api/users/${alice.id}/profile`)
  check('公开主页', r.status === 200 && r.data?.id === alice.id, `status=${r.status}`)

  // ── POSTS ───────────────────────────────────────────────────────────
  section('3. 帖子 posts（CRUD / 筛选 / 点赞）')
  const tag = `e2etag${TS}`
  r = await req('/api/posts', { method: 'POST', body: { title: `E2E帖子_${TS}`, content: '正文内容', tags: [tag] } }, alice.jar)
  check('发帖', r.status === 200 && !!r.data?.id, `status=${r.status}`)
  const postId = r.data?.id

  r = await req(`/api/posts/${postId}`, {}, alice.jar)
  check('帖子详情', r.status === 200 && r.data?.id === postId)
  r = await req('/api/posts')
  check('帖子列表', r.status === 200 && Array.isArray(r.data))
  r = await req(`/api/posts?tag=${tag}`)
  check('按标签筛选', Array.isArray(r.data) && r.data.some((p) => p.id === postId))
  r = await req(`/api/posts?userId=${alice.id}`)
  check('按用户筛选', Array.isArray(r.data) && r.data.some((p) => p.id === postId))
  r = await req(`/api/posts?keyword=E2E帖子_${TS}`)
  check('关键词搜索', Array.isArray(r.data) && r.data.some((p) => p.id === postId))

  r = await req(`/api/posts/${postId}`, { method: 'PUT', body: { title: `改_${TS}`, content: '改后' } }, alice.jar)
  check('修改自己的帖子', r.status === 200 && r.data?.title === `改_${TS}`, `status=${r.status}`)
  r = await req(`/api/posts/${postId}`, { method: 'PUT', body: { title: 'hack' } }, bob.jar)
  check('他人修改被拒', r.status >= 400, `status=${r.status}`)

  r = await req(`/api/posts/${postId}/like`, { method: 'POST' }, alice.jar)
  check('不能给自己的帖子点赞', r.status === 403, `status=${r.status}`)
  r = await req(`/api/posts/${postId}/like`, { method: 'POST' }, bob.jar)
  check('点赞', r.status === 200 && r.data?.liked === true, `status=${r.status}`)
  r = await req(`/api/posts/${postId}/like`, { method: 'POST' }, bob.jar)
  check('取消点赞(toggle)', r.data?.liked === false)
  r = await req(`/api/posts/${postId}/like`, { method: 'POST' }, bob.jar)
  check('再次点赞', r.data?.liked === true)
  r = await req(`/api/posts/${postId}`, {}, alice.jar)
  check('点赞持久化(likedBy)', (r.data?.likedBy || []).includes(bob.id))

  // ── TOPICS ──────────────────────────────────────────────────────────
  section('4. 话题 topics（热门标签聚合）')
  r = await req('/api/topics')
  check('话题列表', r.status === 200 && Array.isArray(r.data))
  check('话题含刚发帖的标签', (r.data || []).some((t) => t.name === tag))

  // ── COMMENTS ────────────────────────────────────────────────────────
  section('5. 评论 comments（评论/回复/点赞/级联删除）')
  r = await req('/api/comments', { method: 'POST', body: { contentId: postId, targetType: 'post', text: `Bob评论_${TS}` } }, bob.jar)
  check('发表评论', r.status === 200 && !!r.data?.id, `status=${r.status}`)
  const commentId = r.data?.id
  r = await req('/api/comments', { method: 'POST', body: { contentId: postId, targetType: 'post', text: '回复来了', parentId: commentId } }, alice.jar)
  check('回复评论', r.status === 200 && r.data?.parentId === commentId, `status=${r.status}`)
  const replyId = r.data?.id
  r = await req(`/api/posts/${postId}`, {}, alice.jar)
  check('帖子评论数同步', r.data?.commentCount === 2, `count=${r.data?.commentCount}`)
  r = await req(`/api/comments?contentId=${postId}&targetType=post`)
  check('评论列表(含回复)', Array.isArray(r.data) && r.data.length === 2, `len=${r.data?.length}`)
  r = await req('/api/comments', { method: 'POST', body: { contentId: postId, targetType: 'post', text: '   ' } }, bob.jar)
  check('空白评论被拒', r.status >= 400, `status=${r.status}`)
  r = await req(`/api/comments/${replyId}/like`, { method: 'POST' }, bob.jar)
  check('评论点赞', r.status === 200 && r.data?.liked === true, `status=${r.status}`)
  r = await req(`/api/comments?contentId=${postId}`)
  check('评论点赞持久化', (r.data?.find((c) => c.id === replyId)?.likedBy || []).includes(bob.id))
  r = await req(`/api/comments/${replyId}/like`, { method: 'POST' }, bob.jar)
  check('评论取消点赞', r.data?.liked === false)
  r = await req(`/api/comments/${commentId}/like`, { method: 'POST' }, bob.jar)
  check('不能给自己的评论点赞', r.status === 403, `status=${r.status}`)
  r = await req(`/api/comments/${commentId}`, { method: 'DELETE' }, bob.jar)
  check('删除自己的评论', r.status === 200, `status=${r.status}`)
  r = await req(`/api/comments?contentId=${postId}`)
  check('回复级联删除', !(r.data || []).some((c) => c.id === replyId))
  r = await req(`/api/posts/${postId}`, {}, alice.jar)
  check('评论数归零', r.data?.commentCount === 0, `count=${r.data?.commentCount}`)

  // ── COLLECTIONS ─────────────────────────────────────────────────────
  section('6. 收藏 collections（收藏夹 CRUD / 添加移除）')
  r = await req('/api/collections', { method: 'POST', body: { name: `收藏夹_${TS}` } }, bob.jar)
  check('创建收藏夹', r.status === 200 && !!r.data?.id, `status=${r.status}`)
  const colId = r.data?.id
  r = await req(`/api/collections/${colId}/items`, { method: 'POST', body: { postId } }, bob.jar)
  check('收藏帖子', r.status === 200 && r.data?.collected === true, `status=${r.status}`)
  r = await req('/api/collections', {}, bob.jar)
  check('收藏夹列表含该夹', (r.data || []).some((c) => c.id === colId && (c.postIds || []).includes(postId)))
  r = await req(`/api/collections/${colId}/items`, { method: 'POST', body: { postId } }, bob.jar)
  check('取消收藏(toggle)', r.status === 200 && r.data?.collected === false)
  r = await req(`/api/collections/${colId}/items`, { method: 'POST', body: { postId } }, alice.jar)
  check('他人收藏夹被拒', r.status === 403, `status=${r.status}`)
  r = await req(`/api/collections/${colId}`, { method: 'DELETE' }, bob.jar)
  check('删除收藏夹', r.status === 200, `status=${r.status}`)

  // ── FOLLOWS ─────────────────────────────────────────────────────────
  section('7. 关注 follows（关注/取关/列表/Feed）')
  r = await req('/api/follows', { method: 'POST', body: { targetUserId: bob.id } }, bob.jar)
  check('不能关注自己', r.status >= 400, `status=${r.status}`)
  r = await req('/api/follows', { method: 'POST', body: { targetUserId: alice.id } }, bob.jar)
  check('Bob 关注 Alice', r.status === 200, `status=${r.status}`)
  r = await req(`/api/follows?userId=${bob.id}&check=${alice.id}`, {}, bob.jar)
  check('关注状态查询', r.data?.following === true)
  r = await req(`/api/follows?userId=${alice.id}&dir=followers`)
  check('粉丝列表', r.data?.count >= 1 && (r.data?.users || []).some((u) => u.id === bob.id))
  r = await req('/api/feed/following', {}, bob.jar)
  check('关注动态 Feed', r.status === 200 && Array.isArray(r.data), `status=${r.status}`)
  r = await req('/api/follows', { method: 'POST', body: { targetUserId: alice.id } }, bob.jar)
  check('取关(toggle)', r.status === 200 && r.data?.following === false)

  // ── MESSAGES ────────────────────────────────────────────────────────
  section('8. 私信 messages（发送/会话/未读/已读/媒体消息）')
  r = await req('/api/messages', { method: 'POST', body: { toUserId: alice.id, text: `私信_${TS}` } }, bob.jar)
  check('发送私信', r.status === 200 && !!r.data?.message?.id, `status=${r.status}`)
  r = await req('/api/messages', { method: 'POST', body: { toUserId: alice.id, msgType: 2, mediaUrl: '/api/uploads/x.png', mediaW: 100, mediaH: 50 } }, bob.jar)
  check('发送图片私信(msgType=2)', r.status === 200 && r.data?.message?.msgType === 2, `status=${r.status}`)
  r = await req('/api/messages', { method: 'POST', body: { toUserId: alice.id, msgType: 2 } }, bob.jar)
  check('媒体消息缺 url 被拒', r.status === 400, `status=${r.status}`)
  r = await req('/api/messages', { method: 'POST', body: { toUserId: bob.id, text: 'self' } }, bob.jar)
  check('不能给自己发私信', r.status === 400, `status=${r.status}`)
  r = await req('/api/messages', { method: 'POST', body: { toUserId: alice.id, text: 'x' } })
  check('未登录发送被拒', r.status >= 400, `status=${r.status}`)
  r = await req('/api/messages?summary=1', {}, alice.jar)
  check('会话列表', r.status === 200 && Array.isArray(r.data?.conversations) && r.data.conversations.length > 0)
  r = await req(`/api/messages?peerId=${bob.id}`, {}, alice.jar)
  check('会话详情(历史)', r.status === 200 && Array.isArray(r.data?.messages) && r.data.messages.length >= 2)
  check('图片消息预览占位', (r.data?.messages || []).some((m) => m.msgType === 2))
  r = await req('/api/messages/unread', {}, alice.jar)
  check('未读计数', r.status === 200 && typeof r.data?.count === 'number' && r.data.count >= 2, `count=${r.data?.count}`)
  r = await req('/api/messages/read', { method: 'POST', body: { peerId: bob.id } }, alice.jar)
  check('标记已读', r.status === 200, `status=${r.status}`)
  r = await req('/api/messages/unread', {}, alice.jar)
  check('已读后未读归零', r.data?.count === 0, `count=${r.data?.count}`)

  // ── GROUPS ──────────────────────────────────────────────────────────
  section('9. 群组 groups（建群/邀请/接受/退群/解散/权限）')
  r = await req('/api/groups', { method: 'POST', body: { name: '' } }, alice.jar)
  check('空群名被拒', r.status === 400, `status=${r.status}`)
  r = await req('/api/groups', { method: 'POST', body: { name: `E2E群_${TS}` } }, alice.jar)
  check('Alice 建群', r.status === 200 && !!r.data?.id, `status=${r.status}`)
  const groupId = r.data?.id
  r = await req('/api/groups', {}, alice.jar)
  check('群列表含新群', (r.data || []).some((g) => g.id === groupId))
  r = await req(`/api/groups/${groupId}`, {}, alice.jar)
  check('群详情(仅群主)', r.status === 200 && (r.data?.members || []).length === 1)
  r = await req(`/api/groups/${groupId}`, {}, bob.jar)
  check('非成员看群详情被拒', r.status === 403, `status=${r.status}`)

  // 邀请需要好友关系：Bob 关注 Alice
  r = await req(`/api/follows?userId=${bob.id}&check=${alice.id}`, {}, bob.jar)
  if (!r.data?.following) await req('/api/follows', { method: 'POST', body: { targetUserId: alice.id } }, bob.jar)
  r = await req('/api/groups/invites', { method: 'POST', body: { groupId, toUserId: bob.id } }, alice.jar)
  check('邀请好友入群', r.status === 200 && !!r.data?.id, `status=${r.status}`)
  const stranger = await registerLogin(`e2e_stranger_${TS}`)
  r = await req('/api/groups/invites', { method: 'POST', body: { groupId, toUserId: stranger.id } }, alice.jar)
  check('邀请非好友被拒', r.status === 403, `status=${r.status}`)
  r = await req('/api/groups/invites', {}, bob.jar)
  check('待处理邀请可见', (r.data || []).some((inv) => inv.groupId === groupId && inv.status === 'pending'))
  const inviteId = (r.data || []).find((inv) => inv.groupId === groupId)?.id
  r = await req(`/api/groups/invites/${inviteId}`, { method: 'POST', body: { action: 'accept' } }, bob.jar)
  check('接受邀请', r.status === 200 && r.data?.accepted === true, `status=${r.status}`)
  r = await req(`/api/groups/${groupId}`, {}, alice.jar)
  check('群成员变 2 人', (r.data?.members || []).length === 2)
  r = await req(`/api/groups/${groupId}`, { method: 'DELETE' }, bob.jar)
  check('Bob 退群', r.status === 200 && r.data?.dissolved === false, `status=${r.status}`)
  r = await req(`/api/groups/${groupId}`, { method: 'DELETE' }, alice.jar)
  check('群主退群=解散', r.status === 200 && r.data?.dissolved === true, `status=${r.status}`)
  r = await req('/api/groups', {}, alice.jar)
  check('解散后群消失', !(r.data || []).some((g) => g.id === groupId))

  // ── TAGS ────────────────────────────────────────────────────────────
  section('10. 标签 tags（管理端 CRUD）')
  r = await req('/api/tags')
  check('标签列表', r.status === 200 && Array.isArray(r.data))
  const tagName = `e2e管理标签${TS}`
  r = await req('/api/tags', { method: 'POST', body: { name: tagName } }, admin)
  check('管理员建标签', r.status === 200 && !!r.data?.id, `status=${r.status}`)
  const tagId = r.data?.id
  r = await req('/api/tags', { method: 'POST', body: { name: 'x' } }, bob.jar)
  check('普通用户建标签被拒', r.status === 403, `status=${r.status}`)
  r = await req(`/api/tags/${tagId}`, { method: 'PUT', body: { name_zh: '中文名' } }, admin)
  check('修改标签', r.status === 200 && r.data?.name_zh === '中文名', `status=${r.status}`)
  r = await req(`/api/tags/${tagId}`, { method: 'DELETE' }, admin)
  check('删除标签', r.status === 200, `status=${r.status}`)
  r = await req('/api/tags', {}, admin)
  check('标签已移除', !(r.data || []).some((t) => t.id === tagId))

  // ── CATEGORIES ──────────────────────────────────────────────────────
  section('11. 分类 categories（管理端 CRUD）')
  r = await req('/api/categories')
  check('分类列表', r.status === 200 && Array.isArray(r.data))
  const catTitle = `E2E分类${TS}`
  r = await req('/api/categories', { method: 'POST', body: { title: catTitle } }, admin)
  check('管理员建分类', r.status === 200 && !!r.data?.id, `status=${r.status}`)
  const catId = r.data?.id
  r = await req('/api/categories', { method: 'POST', body: { title: 'x' } }, bob.jar)
  check('普通用户建分类被拒', r.status === 403, `status=${r.status}`)
  r = await req(`/api/categories/${catId}`, { method: 'PUT', body: { title_zh: '中文分类' } }, admin)
  check('修改分类', r.status === 200 && r.data?.title_zh === '中文分类', `status=${r.status}`)
  r = await req(`/api/categories/${catId}`, { method: 'DELETE' }, admin)
  check('删除分类', r.status === 200, `status=${r.status}`)

  // ── CONTENT ─────────────────────────────────────────────────────────
  section('12. 内容 content（管理端 CRUD）')
  r = await req('/api/content')
  check('内容列表', r.status === 200 && Array.isArray(r.data), `status=${r.status}`)
  r = await req('/api/content?category=Uncategorized')
  check('按分类筛选内容', r.status === 200 && Array.isArray(r.data))
  const contentName = `E2E内容${TS}`
  r = await req('/api/content', { method: 'POST', body: { name: contentName, url: 'https://example.com' } }, admin)
  check('管理员建内容', r.status === 200 && !!r.data?.id, `status=${r.status}`)
  const contentId = r.data?.id
  r = await req('/api/content', { method: 'POST', body: { name: 'x' } }, bob.jar)
  check('普通用户建内容被拒', r.status === 403, `status=${r.status}`)
  r = await req(`/api/content/${contentId}`, { method: 'PUT', body: { name_zh: '中文内容' } }, admin)
  check('修改内容', r.status === 200 && r.data?.name_zh === '中文内容', `status=${r.status}`)
  r = await req(`/api/content/${contentId}`, { method: 'DELETE' }, admin)
  check('删除内容', r.status === 200, `status=${r.status}`)

  // ── CONFIG ──────────────────────────────────────────────────────────
  section('13. 配置 config（公开子集 + 管理员热更新）')
  r = await req('/api/config')
  check('公开配置', r.status === 200 && !!r.data?.limits && !!r.data?.branding, `status=${r.status}`)
  check('配置不含密钥', r.data && !JSON.stringify(r.data).includes('authSecret') && !JSON.stringify(r.data).includes('managerToken'))
  const origTitle = r.data?.branding?.siteTitle
  r = await req('/api/config', { method: 'PUT', body: { branding: { siteTitle: 'E2E测试标题' } } }, bob.jar)
  check('普通用户改配置被拒', r.status === 403, `status=${r.status}`)
  r = await req('/api/config', { method: 'PUT', body: { branding: { siteTitle: 'E2E测试标题' } } }, admin)
  check('管理员改配置(PATCH)', r.status === 200 && r.data?.config?.branding?.siteTitle === 'E2E测试标题', `status=${r.status}`)
  r = await req('/api/config')
  check('配置热生效', r.data?.branding?.siteTitle === 'E2E测试标题')
  r = await req('/api/config', { method: 'PUT', body: { branding: { siteTitle: origTitle } } }, admin)
  check('还原配置', r.status === 200)
  r = await req('/api/config')
  check('配置已还原', r.data?.branding?.siteTitle === origTitle, `title=${r.data?.branding?.siteTitle}`)

  // ── RATINGS ─────────────────────────────────────────────────────────
  section('14. 评分 ratings（评分/改分/校验）')
  // 用自建内容评分，避免污染种子内容；测完删除（残留评分随 contentId 失效，不可见）
  r = await req('/api/content', { method: 'POST', body: { name: `E2E评分内容_${TS}` } }, admin)
  const ratedContentId = r.data?.id
  if (!ratedContentId) {
    check('评分(内容创建失败,跳过)', true)
  } else {
    r = await req('/api/ratings')
    check('缺 contentId 被拒', r.status === 400, `status=${r.status}`)
    r = await req(`/api/ratings?contentId=${ratedContentId}`, {}, bob.jar)
    check('查询评分', r.status === 200 && typeof r.data?.avg === 'number' && typeof r.data?.count === 'number', `status=${r.status}`)
    r = await req('/api/ratings', { method: 'POST', body: { contentId: ratedContentId, value: 5 } }, bob.jar)
    check('评分 5 星', r.status === 200 && r.data?.value === 5, `status=${r.status}`)
    r = await req('/api/ratings', { method: 'POST', body: { contentId: ratedContentId, value: 3 } }, bob.jar)
    check('改分覆盖(3 星)', r.status === 200 && r.data?.value === 3, `status=${r.status}`)
    r = await req('/api/ratings', { method: 'POST', body: { contentId: ratedContentId, value: 9 } }, bob.jar)
    check('非法分值被拒', r.status === 400, `status=${r.status}`)
    r = await req(`/api/ratings?contentId=${ratedContentId}`, {}, bob.jar)
    check('我的评分与均分', r.data?.userRating === 3 && r.data?.avg > 0 && r.data?.count >= 1, `avg=${r.data?.avg} count=${r.data?.count}`)
    r = await req(`/api/content/${ratedContentId}`, { method: 'DELETE' }, admin)
    check('清理评分内容', r.status === 200, `status=${r.status}`)
  }

  // ── UPLOAD / MEDIA ──────────────────────────────────────────────────
  section('15. 媒体上传 upload / uploads / images')
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  )
  const fd = new FormData()
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'test.png')
  r = await req('/api/upload?purpose=post', { method: 'POST', body: fd }, alice.jar)
  check('上传图片', r.status === 200 && !!r.data?.url && r.data?.width > 0 && r.data?.height > 0, `status=${r.status} url=${r.data?.url}`)
  const uploadedUrl = r.data?.url || ''
  const uploadedFile = uploadedUrl.split('/').pop()

  r = await req('/api/upload?purpose=post', { method: 'POST', body: fd })
  check('未登录上传被拒', r.status >= 400, `status=${r.status}`)

  if (uploadedFile) {
    r = await req(`/api/uploads/${uploadedFile}`)
    check('读取上传文件', r.status === 200 && r.headers.get('content-type')?.includes('image/png'), `status=${r.status}`)
  }
  r = await req('/api/uploads/notexist_xyz.png')
  check('不存在文件 404', r.status === 404, `status=${r.status}`)
  r = await req('/api/uploads/..%2F..%2Fconfig.yml')
  check('路径穿越被拒', r.status === 400, `status=${r.status}`)

  r = await req('/api/images', {}, alice.jar)
  check('我的媒体列表', r.status === 200 && (r.data || []).some((img) => img.url === uploadedUrl), `status=${r.status}`)
  r = await req('/api/images?purpose=post', {}, alice.jar)
  check('按用途过滤媒体', (r.data || []).every((img) => img.purpose === 'post'))
  r = await req('/api/images', {}, bob.jar)
  check('媒体隔离(他人不可见)', !(r.data || []).some((img) => img.userId === alice.id))

  // ── POSTER ──────────────────────────────────────────────────────────
  section('16. 海报 poster（封面/帖子/话题 PNG 生成）')
  r = await req('/api/poster/cover')
  check('封面缺 title 被拒', r.status === 400, `status=${r.status}`)
  r = await req(`/api/poster/cover?title=${encodeURIComponent('测试标题')}&content=${encodeURIComponent('摘要')}&tags=${tag}`)
  check('生成封面 PNG', r.status === 200 && r.headers.get('content-type')?.includes('image/png'), `status=${r.status}`)
  r = await req(`/api/poster/post?id=${postId}`)
  check('生成帖子海报 PNG', r.status === 200 && r.headers.get('content-type')?.includes('image/png'), `status=${r.status}`)
  r = await req('/api/poster/post?id=notexist')
  check('海报-帖子不存在 404', r.status === 404, `status=${r.status}`)
  r = await req(`/api/poster/topic?name=${tag}`)
  check('生成话题海报 PNG', r.status === 200 && r.headers.get('content-type')?.includes('image/png'), `status=${r.status}`)

  // ── POSTS CLEANUP ───────────────────────────────────────────────────
  section('17. 帖子删除 posts delete（权限 + 清理）')
  r = await req(`/api/posts/${postId}`, { method: 'DELETE' }, bob.jar)
  check('删除他人帖子被拒', r.status === 403, `status=${r.status}`)
  r = await req(`/api/posts/${postId}`, { method: 'DELETE' }, alice.jar)
  check('删除自己的帖子', r.status === 200, `status=${r.status}`)
  r = await req(`/api/posts/${postId}`, {}, alice.jar)
  check('删除后 404', r.status === 404, `status=${r.status}`)

  // ── REALTIME WS FALLBACK ────────────────────────────────────────────
  section('18. 实时通讯降级通道 WebSocket（认证/心跳/推送/离线补投/关注通知）')
  const A = await wsConnect(alice.jar, 'Alice')
  check('Alice WS 连接 + auth_ok', (await A.waitFor('auth_ok', (m) => m.userId === alice.id)) !== null)
  A.ws.send(JSON.stringify({ type: 'ping' }))
  check('心跳 ping→pong', (await A.waitFor('pong')) !== null)

  const wsJar = makeJar()
  const bad = new WebSocket(WS_URL, { headers: {} })
  const badClosed = await new Promise((resolve) => {
    const to = setTimeout(() => { bad.terminate(); resolve(null) }, 6000)
    bad.on('close', (code) => { clearTimeout(to); resolve(code) })
    bad.on('error', () => {})
  })
  check('未认证 WS 被拒', badClosed === 4001, `code=${badClosed}`)

  r = await req('/api/messages', { method: 'POST', body: { toUserId: alice.id, text: `实时推送_${TS}` } }, bob.jar)
  check('实时私信已存储', !!r.data?.message?.id)
  await sleep(800)
  const pushedMsg = A.received.find((m) => m.type === 'message' && (m.message?.text || '').includes(`实时推送_${TS}`))
  check('在线实时推送(无需刷新)', !!pushedMsg, `events=${JSON.stringify(A.received.map((m) => m.type))}`)

  // 离线队列：Alice 断线期间 Bob 发 2 条 → 重连后补投
  A.ws.close()
  await sleep(500)
  await req('/api/messages', { method: 'POST', body: { toUserId: alice.id, text: `离线补投1_${TS}` } }, bob.jar)
  await req('/api/messages', { method: 'POST', body: { toUserId: alice.id, text: `离线补投2_${TS}` } }, bob.jar)
  await sleep(300)
  const A2 = await wsConnect(alice.jar, 'Alice2')
  check('重连 auth_ok', (await A2.waitFor('auth_ok', (m) => m.userId === alice.id)) !== null)
  const drained = []
  await sleep(1500)
  for (const m of A2.received) {
    if (m.type === 'message' && ((m.message?.text || '').includes(`离线补投1_${TS}`) || (m.message?.text || '').includes(`离线补投2_${TS}`))) {
      if (!drained.some((d) => d.text === m.message.text)) drained.push(m.message)
    }
  }
  check('离线消息上线补投', drained.length === 2, `drained=${drained.length}`)

  // 关注实时通知：确保 Bob 未关注 → 关注 → Alice 实时收到
  r = await req(`/api/follows?userId=${bob.id}&check=${alice.id}`, {}, bob.jar)
  if (r.data?.following) await req('/api/follows', { method: 'POST', body: { targetUserId: alice.id } }, bob.jar)
  await sleep(200)
  await req('/api/follows', { method: 'POST', body: { targetUserId: alice.id } }, bob.jar)
  await sleep(800)
  const followEvt = A2.received.find((m) => m.type === 'follow' && m.fromUserId === bob.id)
  check('关注通知实时推送', !!followEvt, `events=${JSON.stringify(A2.received.map((m) => m.type))}`)

  A2.ws.close()

  // ── LOGOUT ──────────────────────────────────────────────────────────
  section('19. 登出 auth/logout')
  r = await req('/api/auth/logout', { method: 'POST' }, alice.jar)
  check('登出', r.status === 200, `status=${r.status}`)
  r = await req('/api/auth/me', {}, alice.jar)
  check('登出后 me → null', r.status === 204 || r.data === null, `status=${r.status}`)

  // ── SUMMARY ─────────────────────────────────────────────────────────
  section('测试结果汇总')
  console.log(`\n  通过: ${pass}  失败: ${fail}  总计: ${pass + fail}`)
  if (failedList.length) {
    console.log('\n  失败项：')
    for (const f of failedList) console.log(`    ❌ ${f}`)
  }
  console.log(fail === 0 ? '\n  🎉 全部 API + 实时通讯功能正常。' : `\n  ⚠️ ${fail} 项失败，需修复。`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
