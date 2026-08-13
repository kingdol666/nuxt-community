// scripts/_rttest.mjs — 实时 WebSocket 端到端验证
// 用 ws 客户端模拟两个浏览器：Alice 在线、Bob 在线。
// 验证：WS 认证 / Bob 发私信 → Alice 实时收到推送（不依赖轮询）/ 离线队列上线补投
import WebSocket from 'ws'
import { readFileSync } from 'node:fs'

const BASE = 'http://localhost:3000'
const WS_URL = 'ws://localhost:3000/_ws'
const TS = Date.now()

function tok(p) { const c = readFileSync(p, 'utf8'); const m = c.match(/auth_token\t([^\n]+)/); return m ? m[1].trim() : '' }
const tokenA = tok('/tmp/rtA.txt')
const tokenB = tok('/tmp/rtB.txt')

function uidFromToken(t) { return JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString()).uid }
const aliceId = uidFromToken(tokenA)
const bobId = uidFromToken(tokenB)

function api(path, opts = {}, token) {
  const headers = { ...(opts.headers || {}), cookie: 'auth_token=' + token }
  if (opts.body) { headers['content-type'] = 'application/json'; opts.body = JSON.stringify(opts.body) }
  return fetch(BASE + path, { ...opts, headers }).then(r => r.json()).catch(e => ({ error: String(e) }))
}

function wsConnect(token, label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { cookie: 'auth_token=' + token } })
    const received = []
    ws.on('open', () => console.log(`  [${label}] WS open`))
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      received.push(msg)
      console.log(`  [${label}] ← ${msg.type}${msg.message ? ': ' + msg.message.text : ''}`)
    })
    ws.on('error', (e) => reject(new Error(`${label} WS error: ${e.message}`)))
    // resolve once auth_ok arrives
    const iv = setInterval(() => {
      if (received.find(m => m.type === 'auth_ok')) {
        clearInterval(iv)
        resolve({ ws, received, label })
      }
    }, 50)
    setTimeout(() => { clearInterval(iv); reject(new Error(`${label} auth timeout`)) }, 5000)
  })
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const check = (n, c, d = '') => { console.log(`${c ? '✅' : '❌'} ${n}${!c && d ? ' → ' + d : ''}`); c ? pass++ : fail++ }

console.log(`\n═══ REALTIME WEBSOCKET ═════\nAlice=${aliceId}  Bob=${bobId}\n`)

// ── 1. Both connect (auth via cookie) ──
console.log('▸ 1. WS 连接 + cookie 认证')
const A = await wsConnect(tokenA, 'Alice')
const B = await wsConnect(tokenB, 'Bob')
check('Alice WS auth_ok', A.received.some(m => m.type === 'auth_ok' && m.userId === aliceId))
check('Bob WS auth_ok', B.received.some(m => m.type === 'auth_ok' && m.userId === bobId))

// ── 2. Heartbeat (ping/pong) ──
console.log('▸ 2. 心跳 ping/pong')
B.ws.send(JSON.stringify({ type: 'ping' }))
await sleep(300)
check('heartbeat pong', B.received.some(m => m.type === 'pong'))

// ── 3. Realtime push: Bob → Alice (both online) ──
console.log('▸ 3. 实时推送：Bob 在线发私信给 Alice')
const beforeLen = A.received.length
const sent = await api('/api/messages', { method: 'POST', body: { toUserId: aliceId, text: `实时私信_${TS}` } }, tokenB)
check('message stored', !!sent.message?.id)
await sleep(800) // allow WS push
const pushed = A.received.slice(beforeLen).find(m => m.type === 'message' && m.message?.text?.includes(`实时私信_${TS}`))
check('Alice 实时收到推送（无需刷新）', !!pushed, `A received: ${JSON.stringify(A.received.slice(beforeLen).map(m=>m.type))}`)

// ── 4. Offline queue drain: Alice offline → msg stored; reconnect → drained ──
console.log('▸ 4. 离线队列：Alice 离线期间消息 → 重连后补投')
A.ws.close()
await sleep(500)
// send 2 messages while Alice offline
await api('/api/messages', { method: 'POST', body: { toUserId: aliceId, text: `离线私信1_${TS}` } }, tokenB)
await api('/api/messages', { method: 'POST', body: { toUserId: aliceId, text: `离线私信2_${TS}` } }, tokenB)
await sleep(300)
// Alice reconnects
const A2 = await wsConnect(tokenA, 'Alice2')
await sleep(1000)
const drained = A2.received.filter(m => m.type === 'message' && (m.message?.text?.includes(`离线私信1_${TS}`) || m.message?.text?.includes(`离线私信2_${TS}`)))
check('离线消息上线后补投', drained.length === 2, `drained=${drained.length}`)

// ── 5. Follow realtime notification ──
console.log('▸ 5. 关注实时通知：Bob 关注 Alice')
// Alice unfollows Bob first to ensure a fresh follow event (Bob→Alice). Need Alice to not already follow... actually Bob follows Alice.
// clear existing: toggle if exists
const chk = await api(`/api/follows?userId=${bobId}&check=${aliceId}`, {}, tokenB)
if (chk?.following) await api('/api/follows', { method: 'POST', body: { targetUserId: aliceId } }, tokenB) // toggle off
await sleep(200)
const beforeFollow = A2.received.length
await api('/api/follows', { method: 'POST', body: { targetUserId: aliceId } }, tokenB)
await sleep(800)
const followEvt = A2.received.slice(beforeFollow).find(m => m.type === 'follow' && m.fromUserId === bobId)
check('Alice 收到关注通知（实时）', !!followEvt, `events: ${JSON.stringify(A2.received.slice(beforeFollow).map(m=>m.type))}`)

A2.ws.close(); B.ws.close()

console.log(`\n${'═'.repeat(50)}\n  REALTIME: ${pass} passed, ${fail} failed\n${'═'.repeat(50)}`)
process.exit(fail > 0 ? 1 : 0)
