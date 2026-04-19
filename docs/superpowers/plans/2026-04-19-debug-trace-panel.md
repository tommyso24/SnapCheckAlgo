# Debug Trace 面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 admin-only 的 Debug Trace 面板，抓取每条 `/api/analyze`、`/api/v1/analyze`、`/api/v1/profile` 请求的完整节点时间线（输入 + 输出 + 耗时 + 状态），供运营团队在浏览器里自助调试。

**Architecture:** 新增 `lib/debug.js` 做 Redis 写入 + 查询；在 `lib/logger.js` 里接一个 sink，每次 `log.xxx()` 调用附带把事件写 Redis。route / intel 文件里纯追加若干新 log 调用以捕获原文。admin-only Next.js 路由 `/admin/traces` + `/admin/traces/[requestId]` 独立 chrome，复用 Tailwind stripe-\* 设计 token。环境变量 `DEBUG_TRACE_ENABLED` 一键全站关闭。

**Tech Stack:** Next.js 14 App Router，Upstash Redis（`@upstash/redis`），React 18，Tailwind（stripe 设计 token），Vitest。

**Spec:** `docs/superpowers/specs/2026-04-19-debug-trace-panel-design.md`

---

## 关键约束（读完再动手）

1. **零业务逻辑改动**：现有任何业务语句、分支、返回值一律不改。只允许在函数体空隙处追加新的 `log.xxx()` 调用。
2. **所有 Redis 写入 fire-and-forget**：包进 `Promise.resolve().then(...)` + `.catch(e => console.warn(...))`，永不抛错。
3. **ENV 关掉即空操作**：`DEBUG_TRACE_ENABLED === 'false'` 时整个 `debug.js` 的导出函数全部直接 return，零开销。
4. **所有 admin 端点和页面都卡 `requireAdmin()`**（`lib/auth.js` 已有，直接复用）。
5. **频繁提交**：每个任务 1-2 个 commit，最小粒度。

---

## File Structure

### 新增文件

| 路径 | 职责 |
|---|---|
| `lib/debug.js` | Redis 写入器 + trace 组装 + ENV 开关判断 + payload 截断 |
| `src/app/api/admin/trace/route.js` | `GET /api/admin/trace` 列表 API |
| `src/app/api/admin/trace/[requestId]/route.js` | `GET /api/admin/trace/:requestId` 详情 API |
| `src/app/admin/layout.js` | admin 鉴权拦截 + debug 风格顶栏 |
| `src/app/admin/traces/page.js` | 列表页（密集表格） |
| `src/app/admin/traces/[requestId]/page.js` | 详情页（三栏：输入 / 时间线 / 报告） |
| `test/debug.test.js` | debug.js 单元测试 |
| `test/logger-sink.test.js` | logger sink 集成测试 |
| `test/admin-trace-api.test.js` | admin API + 鉴权测试 |

### 修改文件（仅追加，字节级不删不改现有行）

| 路径 | 修改性质 |
|---|---|
| `lib/logger.js` | `createLogger` 内部追加 sink 调用 |
| `src/app/page.js` | 追加 1 个 Debug NavItem + `useRouter` import |
| `src/app/api/v1/analyze/route.js` | 追加 3 条 `log.info` 调用（raw_inputs / llm_request / llm_response） |
| `src/app/api/analyze/route.js` | 同上 3 条 |
| `src/app/api/v1/profile/route.js` | 同上模式 3 条 |
| `lib/intel/extract.js` | 追加 4 条 `log.info`（ocr_full / extract_llm_request / extract_llm_response / fallback_input） |
| `lib/intel/fetchWebsite.js` | 追加 1 条 `log.info`（fetch_full） |
| `lib/intel/wayback.js` | 追加 1 条 `log.info`（snapshot_full） |
| `lib/intel/searches/*.js` | 每个文件追加 1 条 `log.info`（results_full） |

---

### Task 1: 初始化 `lib/debug.js` 骨架 + ENV 判断

**Files:**
- Create: `lib/debug.js`
- Create: `test/debug.test.js`

- [ ] **Step 1: 写 `isTraceEnabled` 和 TTL 读取的 failing 测试**

创建 `test/debug.test.js`：

```js
import { describe, it, expect, beforeEach } from 'vitest'

describe('debug.js env helpers', () => {
  beforeEach(() => {
    delete process.env.DEBUG_TRACE_ENABLED
    delete process.env.DEBUG_TRACE_TTL_DAYS
    delete process.env.DEBUG_TRACE_MAX_PAYLOAD_KB
    delete process.env.DEBUG_TRACE_MAX_IMAGE_KB
  })

  it('isTraceEnabled defaults to true when unset', async () => {
    const { isTraceEnabled } = await import('@/lib/debug')
    expect(isTraceEnabled()).toBe(true)
  })

  it('isTraceEnabled returns false when DEBUG_TRACE_ENABLED=false', async () => {
    process.env.DEBUG_TRACE_ENABLED = 'false'
    const mod = await import('@/lib/debug?bust=1')
    expect(mod.isTraceEnabled()).toBe(false)
  })

  it('getConfig reads TTL and payload limits with defaults', async () => {
    const { getConfig } = await import('@/lib/debug?bust=2')
    const c = getConfig()
    expect(c.ttlDays).toBe(14)
    expect(c.maxPayloadKB).toBe(8)
    expect(c.maxImageKB).toBe(256)
  })

  it('getConfig reads TTL override from env', async () => {
    process.env.DEBUG_TRACE_TTL_DAYS = '7'
    process.env.DEBUG_TRACE_MAX_PAYLOAD_KB = '16'
    const { getConfig } = await import('@/lib/debug?bust=3')
    const c = getConfig()
    expect(c.ttlDays).toBe(7)
    expect(c.maxPayloadKB).toBe(16)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run test/debug.test.js
```
期望：`FAIL` — module not found 或 function not exported。

- [ ] **Step 3: 写最小实现**

创建 `lib/debug.js`：

```js
// Debug trace sink — admin-only, fire-and-forget per-request node tracing.
// Separate channel from obs.js: allowed to store raw inquiry text, images,
// and full LLM I/O for operational debugging. Gated behind DEBUG_TRACE_ENABLED.
//
// Storage layout (Upstash Redis, debug: prefix, TTL per config):
//   debug:meta:<YYYYMMDD>:<requestId>   hash, per-request summary
//   debug:trace:<YYYYMMDD>:<requestId>  list, append-only node events
//   debug:index:<YYYYMMDD>              zset score=startMs member=requestId

export function isTraceEnabled() {
  const v = (process.env.DEBUG_TRACE_ENABLED ?? 'true').toLowerCase()
  return v !== 'false' && v !== '0' && v !== 'off'
}

export function getConfig() {
  return {
    ttlDays: parseInt(process.env.DEBUG_TRACE_TTL_DAYS ?? '14', 10),
    maxPayloadKB: parseInt(process.env.DEBUG_TRACE_MAX_PAYLOAD_KB ?? '8', 10),
    maxImageKB: parseInt(process.env.DEBUG_TRACE_MAX_IMAGE_KB ?? '256', 10),
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run test/debug.test.js
```
期望：所有 4 条测试 `PASS`。

- [ ] **Step 5: 提交**

```bash
git add lib/debug.js test/debug.test.js
git commit -m "feat(debug): scaffold debug.js with ENV config helpers"
```

---

### Task 2: payload 截断辅助函数

**Files:**
- Modify: `lib/debug.js`
- Modify: `test/debug.test.js`

- [ ] **Step 1: 追加截断测试**

在 `test/debug.test.js` 末尾追加：

```js
describe('truncatePayload', () => {
  it('returns payload unchanged when under limit', async () => {
    const { truncatePayload } = await import('@/lib/debug?bust=trunc1')
    const obj = { a: 'hello', b: 123 }
    const out = truncatePayload(obj, 8)
    expect(out.truncated).toBe(false)
    expect(out.payload).toEqual(obj)
    expect(out.size).toBeGreaterThan(0)
  })

  it('truncates payload when over limit (string field)', async () => {
    const { truncatePayload } = await import('@/lib/debug?bust=trunc2')
    const big = { text: 'x'.repeat(20000) }
    const out = truncatePayload(big, 8) // 8 KB = 8192 bytes
    expect(out.truncated).toBe(true)
    expect(out.size).toBeGreaterThan(8192)
    expect(JSON.stringify(out.payload).length).toBeLessThanOrEqual(9000)
    expect(out.payload.__truncated).toBe(true)
  })

  it('records original size even after truncation', async () => {
    const { truncatePayload } = await import('@/lib/debug?bust=trunc3')
    const big = { text: 'a'.repeat(100000) }
    const out = truncatePayload(big, 8)
    expect(out.size).toBeGreaterThan(100000)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run test/debug.test.js -t truncatePayload
```
期望：`truncatePayload is not a function`。

- [ ] **Step 3: 实现 `truncatePayload`**

在 `lib/debug.js` 末尾追加：

```js
// Truncate a JSON-serializable payload to stay under maxKB. If over, replace
// the payload with a short marker object holding the original size and a
// head/tail sample — enough context to eyeball without blowing Redis.
export function truncatePayload(payload, maxKB) {
  let json
  try { json = JSON.stringify(payload) }
  catch { json = '[unserializable]' }
  const size = Buffer.byteLength(json, 'utf8')
  const limit = maxKB * 1024
  if (size <= limit) {
    return { payload, truncated: false, size }
  }
  const headLen = Math.min(4096, Math.floor(limit * 0.6))
  const head = json.slice(0, headLen)
  return {
    payload: {
      __truncated: true,
      __originalSize: size,
      __preview: head + `…[+${size - headLen} bytes]`,
    },
    truncated: true,
    size,
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run test/debug.test.js
```
期望：所有测试 `PASS`。

- [ ] **Step 5: 提交**

```bash
git add lib/debug.js test/debug.test.js
git commit -m "feat(debug): add truncatePayload helper with byte-level size cap"
```

---

### Task 3: 图片序列化

**Files:**
- Modify: `lib/debug.js`
- Modify: `test/debug.test.js`

- [ ] **Step 1: 追加图片序列化测试**

在 `test/debug.test.js` 末尾追加：

```js
describe('serializeImages', () => {
  it('serializes small base64 image inline', async () => {
    const { serializeImages } = await import('@/lib/debug?bust=img1')
    const images = [
      { base64: 'aGVsbG8=', type: 'image/png' },  // 'hello'
    ]
    const out = serializeImages(images, 256)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('image/png')
    expect(out[0].size).toBe(5)
    expect(out[0].sha256).toBeTruthy()
    expect(out[0].base64).toBe('aGVsbG8=')
    expect(out[0].truncated).toBe(false)
  })

  it('truncates base64 larger than maxImageKB', async () => {
    const { serializeImages } = await import('@/lib/debug?bust=img2')
    // 300 KB of 'A' characters → base64 = ~400 KB (exceeds 256 KB)
    const big = Buffer.alloc(300 * 1024, 'A').toString('base64')
    const out = serializeImages([{ base64: big, type: 'image/jpeg' }], 256)
    expect(out[0].truncated).toBe(true)
    expect(out[0].sha256).toBeTruthy()
    expect(out[0].base64.length).toBeLessThanOrEqual(128 * 1024)
  })

  it('preserves url field when present', async () => {
    const { serializeImages } = await import('@/lib/debug?bust=img3')
    const images = [{ url: 'https://example.com/x.jpg', type: 'image/jpeg' }]
    const out = serializeImages(images, 256)
    expect(out[0].url).toBe('https://example.com/x.jpg')
    expect(out[0].base64).toBeUndefined()
  })

  it('returns empty array for null/undefined input', async () => {
    const { serializeImages } = await import('@/lib/debug?bust=img4')
    expect(serializeImages(null, 256)).toEqual([])
    expect(serializeImages(undefined, 256)).toEqual([])
    expect(serializeImages([], 256)).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run test/debug.test.js -t serializeImages
```
期望：`serializeImages is not a function`。

- [ ] **Step 3: 实现 `serializeImages`**

在 `lib/debug.js` 顶部追加 crypto import，末尾追加函数：

```js
import crypto from 'crypto'
```

（如果已有 import 集中区则追加在那；此文件目前无其他 import，直接放在文件顶部）

```js
// Serialize user-supplied inquiry_images into a trace-safe shape:
//   - Always compute SHA-256 + size + type
//   - If `url` present, keep it (so we can re-fetch or link)
//   - If `base64` present, keep it inline up to maxImageKB; above that,
//     keep the first 128 KB as a preview and mark truncated
export function serializeImages(images, maxImageKB) {
  if (!Array.isArray(images) || images.length === 0) return []
  const maxBytes = maxImageKB * 1024
  const previewBytes = 128 * 1024

  return images.map(img => {
    const out = { type: img.type || 'image/jpeg' }
    if (img.url) out.url = img.url
    if (img.base64) {
      let buf
      try { buf = Buffer.from(img.base64, 'base64') }
      catch { buf = Buffer.alloc(0) }
      out.size = buf.length
      out.sha256 = crypto.createHash('sha256').update(buf).digest('hex')
      if (img.base64.length <= maxBytes) {
        out.base64 = img.base64
        out.truncated = false
      } else {
        out.base64 = img.base64.slice(0, previewBytes)
        out.truncated = true
      }
    } else {
      out.size = 0
      out.sha256 = crypto.createHash('sha256').update('').digest('hex')
    }
    return out
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run test/debug.test.js
```
期望：全部 `PASS`。

- [ ] **Step 5: 提交**

```bash
git add lib/debug.js test/debug.test.js
git commit -m "feat(debug): add serializeImages with base64 size cap"
```

---

### Task 4: Redis 键名和日期辅助函数

**Files:**
- Modify: `lib/debug.js`
- Modify: `test/debug.test.js`

- [ ] **Step 1: 追加键名辅助函数测试**

```js
describe('key helpers', () => {
  it('utcDateKey formats YYYYMMDD in UTC', async () => {
    const { utcDateKey } = await import('@/lib/debug?bust=key1')
    const d = new Date('2026-04-19T23:59:00Z')
    expect(utcDateKey(d)).toBe('20260419')
  })

  it('metaKey produces debug:meta:YYYYMMDD:requestId', async () => {
    const { metaKey } = await import('@/lib/debug?bust=key2')
    expect(metaKey('20260419', 'abc')).toBe('debug:meta:20260419:abc')
  })

  it('traceKey produces debug:trace:YYYYMMDD:requestId', async () => {
    const { traceKey } = await import('@/lib/debug?bust=key3')
    expect(traceKey('20260419', 'abc')).toBe('debug:trace:20260419:abc')
  })

  it('indexKey produces debug:index:YYYYMMDD', async () => {
    const { indexKey } = await import('@/lib/debug?bust=key4')
    expect(indexKey('20260419')).toBe('debug:index:20260419')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run test/debug.test.js -t "key helpers"
```

- [ ] **Step 3: 实现**

在 `lib/debug.js` 追加：

```js
export function utcDateKey(d = new Date()) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

export const metaKey  = (date, rid) => `debug:meta:${date}:${rid}`
export const traceKey = (date, rid) => `debug:trace:${date}:${rid}`
export const indexKey = (date)      => `debug:index:${date}`
```

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add lib/debug.js test/debug.test.js
git commit -m "feat(debug): add Redis key builders and UTC date helper"
```

---

### Task 5: `startTrace` + `endTrace`

**Files:**
- Modify: `lib/debug.js`
- Modify: `test/debug.test.js`

- [ ] **Step 1: 追加测试（mock Redis）**

在 `test/debug.test.js` 顶部追加 mock：

```js
import { vi } from 'vitest'

vi.mock('@upstash/redis', () => {
  const store = new Map()
  const calls = []
  return {
    Redis: class {
      constructor() {}
      hset = vi.fn(async (key, data) => { calls.push(['hset', key, data]); store.set(key, { ...(store.get(key) || {}), ...data }); return 1 })
      hget = vi.fn(async (key, field) => (store.get(key) || {})[field])
      hgetall = vi.fn(async (key) => store.get(key) || null)
      zadd = vi.fn(async (key, ...args) => { calls.push(['zadd', key, args]); return 1 })
      zrange = vi.fn(async () => [])
      rpush = vi.fn(async (key, val) => { calls.push(['rpush', key, val]); const arr = store.get(key) || []; arr.push(val); store.set(key, arr); return arr.length })
      lrange = vi.fn(async (key) => store.get(key) || [])
      expire = vi.fn(async () => 1)
      del = vi.fn(async (key) => { store.delete(key); return 1 })
    },
    __store: store,
    __calls: calls,
    __reset: () => { store.clear(); calls.length = 0 },
  }
})
```

然后追加测试：

```js
describe('startTrace / endTrace', () => {
  beforeEach(async () => {
    process.env.DEBUG_TRACE_ENABLED = 'true'
    const mod = await import('@upstash/redis')
    mod.__reset?.()
  })

  it('startTrace writes meta hash and index zset', async () => {
    const { startTrace } = await import('@/lib/debug?bust=start1')
    const redisMod = await import('@upstash/redis')
    await startTrace({
      requestId: 'req-123',
      route: 'v1/analyze',
      startMs: 1745000000000,
      meta: { scanMode: 'online', enableIntel: true, caller: 'sn' },
    })
    const calls = redisMod.__calls
    expect(calls.some(c => c[0] === 'hset' && c[1].startsWith('debug:meta:'))).toBe(true)
    expect(calls.some(c => c[0] === 'zadd' && c[1].startsWith('debug:index:'))).toBe(true)
  })

  it('startTrace is noop when DEBUG_TRACE_ENABLED=false', async () => {
    process.env.DEBUG_TRACE_ENABLED = 'false'
    const { startTrace } = await import('@/lib/debug?bust=start2')
    const redisMod = await import('@upstash/redis')
    redisMod.__reset()
    await startTrace({ requestId: 'x', route: 'v1/analyze', startMs: 0, meta: {} })
    expect(redisMod.__calls).toHaveLength(0)
  })

  it('endTrace updates meta with status/endMs/duration', async () => {
    const { startTrace, endTrace } = await import('@/lib/debug?bust=end1')
    const redisMod = await import('@upstash/redis')
    redisMod.__reset()
    await startTrace({ requestId: 'r2', route: 'analyze', startMs: 1000, meta: {} })
    await endTrace({ requestId: 'r2', startMs: 1000, endMs: 3000, status: 'success', outcome: { riskLevel: 'high' } })
    const hsets = redisMod.__calls.filter(c => c[0] === 'hset')
    expect(hsets.length).toBeGreaterThanOrEqual(2)
    const last = hsets[hsets.length - 1][2]
    expect(last.status).toBe('success')
    expect(last.endMs).toBe(3000)
    expect(last.durationMs).toBe(2000)
  })

  it('endTrace never throws when Redis fails', async () => {
    const { endTrace } = await import('@/lib/debug?bust=end2')
    // No start — endTrace should still not throw
    await expect(endTrace({ requestId: 'missing', startMs: 0, endMs: 1, status: 'error' })).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 Redis 客户端 + `startTrace` / `endTrace`**

在 `lib/debug.js` 追加：

```js
import { Redis } from '@upstash/redis'

let _redis = null
function getRedis() {
  if (_redis) return _redis
  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
  return _redis
}

function safeAsync(fn) {
  return Promise.resolve()
    .then(fn)
    .catch(e => { try { console.warn('[debug]', e?.message || String(e)) } catch {} })
}

// Start a trace. Writes the meta hash and adds to the daily index.
// Signature: startTrace({ requestId, route, startMs, meta })
//   meta = additional key/value pairs (scanMode, enableIntel, caller, inputHash,
//          inquiryText, companyProfile, inquiryImages stringified, etc.)
export async function startTrace({ requestId, route, startMs, meta = {} }) {
  if (!isTraceEnabled() || !requestId) return
  return safeAsync(async () => {
    const { ttlDays } = getConfig()
    const ttlSec = ttlDays * 24 * 60 * 60
    const date = utcDateKey(new Date(startMs))
    const redis = getRedis()
    const fields = {
      requestId,
      route: String(route || ''),
      startMs,
      endMs: null,
      durationMs: null,
      status: 'running',
      ...Object.fromEntries(
        Object.entries(meta).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? '')])
      ),
    }
    await redis.hset(metaKey(date, requestId), fields)
    await redis.expire(metaKey(date, requestId), ttlSec)
    await redis.zadd(indexKey(date), { score: startMs, member: requestId })
    await redis.expire(indexKey(date), ttlSec)
  })
}

// Close a trace. Updates meta with endMs / durationMs / status / outcome fields.
// Signature: endTrace({ requestId, startMs, endMs, status, errorCode?, outcome? })
export async function endTrace({ requestId, startMs, endMs, status, errorCode = null, outcome = {} }) {
  if (!isTraceEnabled() || !requestId) return
  return safeAsync(async () => {
    const date = utcDateKey(new Date(startMs))
    const redis = getRedis()
    const fields = {
      endMs,
      durationMs: endMs - startMs,
      status,
      errorCode: errorCode ?? '',
      ...Object.fromEntries(
        Object.entries(outcome).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? '')])
      ),
    }
    await redis.hset(metaKey(date, requestId), fields)
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add lib/debug.js test/debug.test.js
git commit -m "feat(debug): startTrace and endTrace write meta + daily index"
```

---

### Task 6: `recordEvent`

**Files:**
- Modify: `lib/debug.js`
- Modify: `test/debug.test.js`

- [ ] **Step 1: 追加测试**

```js
describe('recordEvent', () => {
  beforeEach(async () => {
    process.env.DEBUG_TRACE_ENABLED = 'true'
    const mod = await import('@upstash/redis')
    mod.__reset?.()
  })

  it('appends event to trace list with seq and ts', async () => {
    const { recordEvent, startTrace } = await import('@/lib/debug?bust=rec1')
    const redisMod = await import('@upstash/redis')
    await startTrace({ requestId: 'rx', route: 'v1/analyze', startMs: 1000, meta: {} })
    await recordEvent({
      requestId: 'rx',
      startMs: 1000,
      tag: 'intel/extract',
      event: 'ok',
      level: 'info',
      info: { companyUrl: 'https://foo.com' },
    })
    const pushes = redisMod.__calls.filter(c => c[0] === 'rpush')
    expect(pushes.length).toBeGreaterThan(0)
    const payload = JSON.parse(pushes[pushes.length - 1][2])
    expect(payload.tag).toBe('intel/extract')
    expect(payload.event).toBe('ok')
    expect(payload.ts).toBeGreaterThan(0)
    expect(payload.seq).toBe(1)
    expect(payload.payload.companyUrl).toBe('https://foo.com')
  })

  it('is noop when disabled', async () => {
    process.env.DEBUG_TRACE_ENABLED = 'false'
    const { recordEvent } = await import('@/lib/debug?bust=rec2')
    const redisMod = await import('@upstash/redis')
    redisMod.__reset()
    await recordEvent({ requestId: 'rx', startMs: 0, tag: 't', event: 'e', level: 'info', info: {} })
    expect(redisMod.__calls).toHaveLength(0)
  })

  it('truncates oversized payload', async () => {
    const { recordEvent, startTrace } = await import('@/lib/debug?bust=rec3')
    const redisMod = await import('@upstash/redis')
    await startTrace({ requestId: 'rx2', route: 'v1/analyze', startMs: 1000, meta: {} })
    redisMod.__reset()
    const big = { text: 'x'.repeat(50000) }
    await recordEvent({ requestId: 'rx2', startMs: 1000, tag: 't', event: 'big', level: 'info', info: big })
    const pushes = redisMod.__calls.filter(c => c[0] === 'rpush')
    const payload = JSON.parse(pushes[pushes.length - 1][2])
    expect(payload.truncated).toBe(true)
    expect(payload.payload.__truncated).toBe(true)
    expect(payload.payloadSize).toBeGreaterThan(50000)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

在 `lib/debug.js` 追加：

```js
// recordEvent: append one node event to the trace list.
// seq is not tracked atomically; we use ts as a proxy for ordering and count
// the list length via llen on read if strict seq numbers are needed.
// For now we use a module-level in-memory counter keyed by requestId for
// best-effort monotonic ordering within a process. Restarts reset to 1.
const _seqByReq = new Map()

export async function recordEvent({ requestId, startMs, tag, event, level = 'info', info = {} }) {
  if (!isTraceEnabled() || !requestId) return
  return safeAsync(async () => {
    const { maxPayloadKB, ttlDays } = getConfig()
    const ttlSec = ttlDays * 24 * 60 * 60
    const date = utcDateKey(new Date(startMs))
    const redis = getRedis()

    const seq = (_seqByReq.get(requestId) || 0) + 1
    _seqByReq.set(requestId, seq)

    const { payload, truncated, size } = truncatePayload(info ?? {}, maxPayloadKB)
    const entry = {
      seq,
      ts: Date.now(),
      tag: String(tag || ''),
      event: String(event || ''),
      level,
      payload,
      truncated,
      payloadSize: size,
    }
    await redis.rpush(traceKey(date, requestId), JSON.stringify(entry))
    await redis.expire(traceKey(date, requestId), ttlSec)
  })
}

// Exported for tests — lets tests reset the seq counter between cases.
export function _resetSeqForTest() { _seqByReq.clear() }
```

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add lib/debug.js test/debug.test.js
git commit -m "feat(debug): recordEvent appends node events with payload truncation"
```

---

### Task 7: `fetchTraceDetail` + `fetchTraceList`

**Files:**
- Modify: `lib/debug.js`
- Modify: `test/debug.test.js`

- [ ] **Step 1: 追加读取测试**

```js
describe('fetchTraceDetail', () => {
  beforeEach(async () => {
    process.env.DEBUG_TRACE_ENABLED = 'true'
    const mod = await import('@upstash/redis')
    mod.__reset?.()
  })

  it('returns null for unknown requestId', async () => {
    const { fetchTraceDetail } = await import('@/lib/debug?bust=det1')
    const out = await fetchTraceDetail('nope', '20260419')
    expect(out).toBeNull()
  })

  it('returns meta + events for known requestId', async () => {
    const { startTrace, recordEvent, fetchTraceDetail } = await import('@/lib/debug?bust=det2')
    const startMs = new Date('2026-04-19T12:00:00Z').getTime()
    await startTrace({ requestId: 'detail-1', route: 'v1/analyze', startMs, meta: { caller: 'sn' } })
    await recordEvent({ requestId: 'detail-1', startMs, tag: 'intel/extract', event: 'ok', info: { x: 1 } })
    const out = await fetchTraceDetail('detail-1', '20260419')
    expect(out.meta.requestId).toBe('detail-1')
    expect(out.meta.caller).toBe('sn')
    expect(out.events).toHaveLength(1)
    expect(out.events[0].tag).toBe('intel/extract')
  })
})

describe('fetchTraceList', () => {
  beforeEach(async () => {
    process.env.DEBUG_TRACE_ENABLED = 'true'
    const mod = await import('@upstash/redis')
    mod.__reset?.()
  })

  it('returns empty on date with no traces', async () => {
    const { fetchTraceList } = await import('@/lib/debug?bust=lst1')
    const out = await fetchTraceList({ date: '20260419' })
    expect(out.items).toEqual([])
    expect(out.nextCursor).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现读取函数**

在 `lib/debug.js` 追加：

```js
export async function fetchTraceDetail(requestId, dateKey) {
  if (!requestId) return null
  try {
    const redis = getRedis()
    const date = dateKey || utcDateKey()
    const meta = await redis.hgetall(metaKey(date, requestId))
    if (!meta || Object.keys(meta).length === 0) {
      // Try yesterday as a convenience
      const y = new Date()
      y.setUTCDate(y.getUTCDate() - 1)
      const yesterday = utcDateKey(y)
      if (yesterday !== date) {
        const meta2 = await redis.hgetall(metaKey(yesterday, requestId))
        if (meta2 && Object.keys(meta2).length > 0) {
          return _buildDetail(meta2, await redis.lrange(traceKey(yesterday, requestId), 0, -1))
        }
      }
      return null
    }
    const rawEvents = await redis.lrange(traceKey(date, requestId), 0, -1)
    return _buildDetail(meta, rawEvents)
  } catch (e) {
    console.warn('[debug] fetchTraceDetail failed', e?.message || String(e))
    return null
  }
}

function _buildDetail(meta, rawEvents) {
  const events = (rawEvents || []).map(s => {
    try { return typeof s === 'string' ? JSON.parse(s) : s }
    catch { return { raw: String(s) } }
  })
  // Parse JSON-stringified meta fields back to objects for UI convenience
  const parsed = { ...meta }
  for (const k of ['scores', 'tokens', 'inquiryImages']) {
    if (parsed[k] && typeof parsed[k] === 'string') {
      try { parsed[k] = JSON.parse(parsed[k]) } catch {}
    }
  }
  return { meta: parsed, events }
}

export async function fetchTraceList({ date, status, route, limit = 50, cursor = 0 }) {
  try {
    const redis = getRedis()
    const d = date || utcDateKey()
    // zrange with REV to get newest first; Upstash Redis supports rev option
    const ids = await redis.zrange(indexKey(d), 0, -1, { rev: true })
    if (!ids || ids.length === 0) return { items: [], nextCursor: null }

    const start = parseInt(cursor || 0, 10)
    const slice = ids.slice(start, start + limit + 1)  // +1 to detect more
    const hasMore = slice.length > limit
    const ridsToFetch = hasMore ? slice.slice(0, limit) : slice

    const metas = await Promise.all(ridsToFetch.map(rid => redis.hgetall(metaKey(d, rid))))
    const items = metas
      .map((m, i) => m ? { ..._summarizeMeta(m, ridsToFetch[i]) } : null)
      .filter(Boolean)
      .filter(it => !status || status === 'all' || it.status === status)
      .filter(it => !route || route === 'all' || it.route === route)

    return {
      items,
      nextCursor: hasMore ? String(start + limit) : null,
    }
  } catch (e) {
    console.warn('[debug] fetchTraceList failed', e?.message || String(e))
    return { items: [], nextCursor: null }
  }
}

function _summarizeMeta(m, requestId) {
  return {
    requestId,
    route: m.route || '',
    status: m.status || '',
    startMs: Number(m.startMs) || 0,
    endMs: m.endMs ? Number(m.endMs) : null,
    durationMs: m.durationMs ? Number(m.durationMs) : null,
    riskLevel: m.riskLevel || null,
    caller: m.caller || null,
    inquiryPreview: (m.inquiryText || '').slice(0, 80),
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add lib/debug.js test/debug.test.js
git commit -m "feat(debug): fetchTraceDetail and fetchTraceList with filters"
```

---

### Task 8: logger.js sink 钩子

**Files:**
- Modify: `lib/logger.js`
- Create: `test/logger-sink.test.js`

- [ ] **Step 1: 写 logger sink 测试**

创建 `test/logger-sink.test.js`：

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@upstash/redis', () => {
  const calls = []
  return {
    Redis: class {
      hset = vi.fn(async (...a) => { calls.push(['hset', ...a]); return 1 })
      hget = vi.fn(async () => null)
      hgetall = vi.fn(async () => ({}))
      zadd = vi.fn(async (...a) => { calls.push(['zadd', ...a]); return 1 })
      zrange = vi.fn(async () => [])
      rpush = vi.fn(async (...a) => { calls.push(['rpush', ...a]); return 1 })
      lrange = vi.fn(async () => [])
      expire = vi.fn(async () => 1)
    },
    __calls: calls,
    __reset: () => { calls.length = 0 },
  }
})

describe('logger sink', () => {
  beforeEach(async () => {
    process.env.DEBUG_TRACE_ENABLED = 'true'
    const mod = await import('@upstash/redis')
    mod.__reset()
    const dbg = await import('@/lib/debug')
    dbg._resetSeqForTest?.()
  })

  it('route/* start event triggers startTrace (hset + zadd)', async () => {
    const { createLogger, runWithRequestContext } = await import('@/lib/logger?bust=sink1')
    const log = createLogger('route/v1-analyze')
    await runWithRequestContext({ requestId: 'rsink1', route: 'v1/analyze' }, async () => {
      log.start({ scanMode: 'online', inquiryLen: 10 })
    })
    // fire-and-forget — give it a tick
    await new Promise(r => setTimeout(r, 50))
    const redisMod = await import('@upstash/redis')
    expect(redisMod.__calls.some(c => c[0] === 'hset')).toBe(true)
    expect(redisMod.__calls.some(c => c[0] === 'zadd')).toBe(true)
  })

  it('non-route tags call rpush only, not zadd', async () => {
    const { createLogger, runWithRequestContext } = await import('@/lib/logger?bust=sink2')
    // First open the trace
    const routeLog = createLogger('route/v1-analyze')
    await runWithRequestContext({ requestId: 'rsink2', route: 'v1/analyze' }, async () => {
      routeLog.start({})
      const nodeLog = createLogger('intel/extract')
      nodeLog.info('ok', { x: 1 })
    })
    await new Promise(r => setTimeout(r, 50))
    const redisMod = await import('@upstash/redis')
    expect(redisMod.__calls.some(c => c[0] === 'rpush')).toBe(true)
  })

  it('sink is noop when DEBUG_TRACE_ENABLED=false', async () => {
    process.env.DEBUG_TRACE_ENABLED = 'false'
    const { createLogger, runWithRequestContext } = await import('@/lib/logger?bust=sink3')
    const log = createLogger('route/v1-analyze')
    await runWithRequestContext({ requestId: 'rsink3', route: 'v1/analyze' }, async () => {
      log.start({})
      log.ok({})
    })
    await new Promise(r => setTimeout(r, 50))
    const redisMod = await import('@upstash/redis')
    expect(redisMod.__calls).toHaveLength(0)
  })

  it('stdout output is unchanged (back-compat)', async () => {
    const { createLogger } = await import('@/lib/logger?bust=sink4')
    const log = createLogger('test-tag')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    log.info('hello', { foo: 'bar' })
    expect(spy).toHaveBeenCalled()
    const line = spy.mock.calls[0][0]
    expect(line).toContain('[test-tag]')
    expect(line).toContain('hello')
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run test/logger-sink.test.js
```
期望：sink 没生效，所有 Redis 相关断言失败。

- [ ] **Step 3: 扩展 `lib/logger.js`**

在 `lib/logger.js` 末尾追加（保持现有所有 export 不变）：

```js
// ── Debug trace sink ───────────────────────────────────────────────────────
// Every log call additionally fires a debug.recordEvent so the full event
// stream lands in Redis (admin-only trace panel). Fire-and-forget: failures
// only console.warn, never break the caller.
//
// Route lifecycle is detected via tag prefix:
//   tag.startsWith('route/')  + event 'start'       → open trace (hset meta + zadd index)
//   tag.startsWith('route/')  + event 'ok' | 'fail' → close trace (hset final status)
//   everything else                                 → append a node event
//
// Routes are responsible for calling log.start / log.ok / log.fail at their
// lifecycle boundaries (they already do). No route file changes needed for
// the sink itself to work.

import { isTraceEnabled, startTrace, endTrace, recordEvent } from './debug.js'

function levelForEvent(event) {
  if (event === 'fail') return 'error'
  if (event === 'warn' || event === 'skip' || event === 'fallback') return 'warn'
  return 'info'
}

function emitToSink(tag, event, info) {
  if (!isTraceEnabled()) return
  const ctx = getRequestContext()
  if (!ctx.requestId) return

  const level = levelForEvent(event)
  const isRoute = tag.startsWith('route/')
  const redacted = redact(info ?? {})

  // Capture start time in the ALS context so endTrace can compute duration.
  // Writing to the ALS store is safe — it's a per-request object.
  if (isRoute && event === 'start') {
    ctx._traceStartMs = Date.now()
    startTrace({
      requestId: ctx.requestId,
      route: ctx.route || tag.replace(/^route\//, ''),
      startMs: ctx._traceStartMs,
      meta: redacted,
    }).catch(() => {})
  } else if (isRoute && (event === 'ok' || event === 'fail')) {
    const startMs = ctx._traceStartMs || Date.now()
    endTrace({
      requestId: ctx.requestId,
      startMs,
      endMs: Date.now(),
      status: event === 'ok' ? 'success' : 'error',
      errorCode: redacted?.code || redacted?.phase || null,
      outcome: redacted,
    }).catch(() => {})
    // Also append as a regular event so the timeline shows the ok/fail card
    recordEvent({
      requestId: ctx.requestId,
      startMs,
      tag, event, level,
      info: redacted,
    }).catch(() => {})
  } else {
    const startMs = ctx._traceStartMs || Date.now()
    recordEvent({
      requestId: ctx.requestId,
      startMs,
      tag, event, level,
      info: redacted,
    }).catch(() => {})
  }
}
```

然后修改 `createLogger`，在每个 build/console 调用之后追加 sink 调用。**不改现有行**，只在每个方法体 return 前加一行：

```js
export function createLogger(tag) {
  const build = (event, info) => {
    const ctx = getRequestContext()
    const req = `req=${shortId(ctx.requestId)}`
    const route = ctx.route ? ` r=${ctx.route}` : ''
    const prefix = `[SCA ${req}${route}] [${tag}]`
    return info === undefined ? `${prefix} ${event}` : `${prefix} ${event} ${safeJson(info)}`
  }
  return {
    start:    (info) => { console.log(build('start', info));    emitToSink(tag, 'start', info) },
    ok:       (info) => { console.log(build('ok', info));       emitToSink(tag, 'ok', info) },
    skip:     (info) => { console.log(build('skip', info));     emitToSink(tag, 'skip', info) },
    fallback: (info) => { console.log(build('fallback', info)); emitToSink(tag, 'fallback', info) },
    warn:     (event, info) => { console.warn(build(event, info));  emitToSink(tag, event, info) },
    fail:     (info) => { console.error(build('fail', info));       emitToSink(tag, 'fail', info) },
    info:     (event, info) => { console.log(build(event, info));   emitToSink(tag, event, info) },
  }
}
```

（替换现有的 `return { start: ..., ok: ..., ... }` 对象，保持键数量和签名不变，只在每个箭头函数体里多加一个 `; emitToSink(...)` 调用）

- [ ] **Step 4: 跑测试确认全部通过**

```bash
npx vitest run test/logger-sink.test.js test/debug.test.js
```

- [ ] **Step 5: 跑完整测试套件确认不破坏现有测试**

```bash
npx vitest run
```

- [ ] **Step 6: 提交**

```bash
git add lib/logger.js test/logger-sink.test.js
git commit -m "feat(logger): add debug trace sink on every log event"
```

---

### Task 9: 在三条 API 路由里追加 raw-capture log 调用

**Files:**
- Modify: `src/app/api/v1/analyze/route.js`
- Modify: `src/app/api/analyze/route.js`
- Modify: `src/app/api/v1/profile/route.js`

**约束**：**纯追加**。不删不改任何现有行。只插入新的 `log.info(...)` 调用。

- [ ] **Step 1: `/api/v1/analyze/route.js` 追加 3 条 log**

在 `src/app/api/v1/analyze/route.js` 以下位置追加（用 Edit 工具精确定位）：

**位置 1**：`log.start({...})` 调用结束后（约 77 行之后），追加：

```js
log.info('raw_inputs', {
  inquiry_text,
  company_profile,
  inquiry_images: inquiry_images.map(img => ({
    type: img.type || null,
    hasBase64: !!img.base64,
    base64Len: img.base64 ? img.base64.length : 0,
    url: img.url || null,
  })),
})
```

**位置 2**：`llmRes = await fetch(endpoint, {...})` 之前（约 277 行之前），追加：

```js
log.info('llm_request', {
  endpoint,
  model: modelName,
  useBriefing,
  hasImages: preparedImages.length > 0,
  messages: [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    { role: 'user', content: typeof userContent === 'string' ? userContent : '[multimodal content]' },
  ],
})
```

**位置 3**：`log.info('llm_ok', {...})` 调用之前（约 311 行之前），追加：

```js
log.info('llm_response', {
  content: fullText,
  finishReason: llmJson.choices?.[0]?.finish_reason || null,
  usage: llmJson.usage || null,
})
```

- [ ] **Step 2: `/api/analyze/route.js` 追加同款 3 条**

对 `src/app/api/analyze/route.js` 做完全相同模式的追加。先 Read 确认位置，再 Edit。

位置 1：`log.start(...)` 调用后
位置 2：LLM fetch 调用前
位置 3：`log.info('llm_ok', ...)` 之前

- [ ] **Step 3: `/api/v1/profile/route.js` 追加 3 条**

对 `src/app/api/v1/profile/route.js`：

- 位置 1：request normalization 完成后追加：
  ```js
  log.info('raw_inputs', { website_url, supplementary_info })
  ```
- 位置 2：网站抓取前追加：
  ```js
  log.info('fetch_target', { url: website_url })
  ```
- 位置 3：LLM 响应后追加：
  ```js
  log.info('llm_response', { content: report, tokens })
  ```

（具体字段名以 profile route 现有代码为准，先 Read 定位）

- [ ] **Step 4: 本地 smoke**

```bash
npm run build
```
期望：build 成功，无语法错误。

- [ ] **Step 5: 跑测试**

```bash
npx vitest run
```
期望：全绿。

- [ ] **Step 6: 提交**

```bash
git add src/app/api/v1/analyze/route.js src/app/api/analyze/route.js src/app/api/v1/profile/route.js
git commit -m "feat(debug): add raw input/LLM request/response trace logs in routes"
```

---

### Task 10: 在 intel/* 里追加 full-capture log 调用

**Files:**
- Modify: `lib/intel/extract.js`
- Modify: `lib/intel/fetchWebsite.js`
- Modify: `lib/intel/wayback.js`
- Modify: `lib/intel/searches/linkedin.js`
- Modify: `lib/intel/searches/facebook.js`
- Modify: `lib/intel/searches/panjiva.js`
- Modify: `lib/intel/searches/negative.js`
- Modify: `lib/intel/searches/general.js`
- Modify: `lib/intel/searches/phone.js`

- [ ] **Step 1: `lib/intel/extract.js` 追加 4 条**

**位置 1**：`transcribeImages` 成功后（现有 `log.info('ocr_ok', ...)` 之后），追加：
```js
log.info('ocr_full', { text })
```

**位置 2**：`extractEntities` 内，`res = await fetch(endpoint, {...})` 之前追加：
```js
log.info('extract_llm_request', {
  endpoint, model,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: typeof userContent === 'string' ? userContent : '[multimodal]' },
  ],
})
```

**位置 3**：`extracted = parseExtractionJson(content)` 之前追加：
```js
log.info('extract_llm_response', { content })
```

**位置 4**：regex fallback 进入时（`if (!extracted.companyUrl) { const combinedText = ...` 之后），追加：
```js
log.info('fallback_input', { combinedText, userUrl })
```

- [ ] **Step 2: `lib/intel/fetchWebsite.js` 追加 1 条**

在现有 `log.ok` / 成功返回前追加：
```js
log.info('fetch_full', { excerpt, title, siteName: siteName || null })
```

（字段名参考现有代码实际返回的变量）

- [ ] **Step 3: `lib/intel/wayback.js` 追加 1 条**

```js
log.info('snapshot_full', { firstSnapshot, ageYears, snapshotUrl: snapshotUrl || null })
```

- [ ] **Step 4: `lib/intel/searches/*.js` 每个追加 1 条**

每个 search 文件在返回 `{ status: 'ok', ..., results }` 之前追加：
```js
log.info('results_full', { query, results })
```

逐个文件编辑，不要忘。

- [ ] **Step 5: 跑测试 + build**

```bash
npx vitest run && npm run build
```

- [ ] **Step 6: 提交**

```bash
git add lib/intel/
git commit -m "feat(debug): add full-capture trace logs in intel pipeline nodes"
```

---

### Task 11: `GET /api/admin/trace` 列表端点

**Files:**
- Create: `src/app/api/admin/trace/route.js`
- Create: `test/admin-trace-api.test.js`

- [ ] **Step 1: 写 API 测试**

创建 `test/admin-trace-api.test.js`：

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
}))
vi.mock('@/lib/debug', () => ({
  fetchTraceList: vi.fn(),
  fetchTraceDetail: vi.fn(),
}))

describe('GET /api/admin/trace', () => {
  it('401 when not authenticated', async () => {
    const { requireAdmin } = await import('@/lib/auth')
    requireAdmin.mockResolvedValue({ error: 'Unauthorized', status: 401 })
    const { GET } = await import('@/app/api/admin/trace/route?bust=l1')
    const req = new Request('http://x/api/admin/trace?date=20260419')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('403 when authenticated but not admin', async () => {
    const { requireAdmin } = await import('@/lib/auth')
    requireAdmin.mockResolvedValue({ error: 'Forbidden', status: 403 })
    const { GET } = await import('@/app/api/admin/trace/route?bust=l2')
    const res = await GET(new Request('http://x/api/admin/trace'))
    expect(res.status).toBe(403)
  })

  it('200 returns list for admin', async () => {
    const { requireAdmin } = await import('@/lib/auth')
    const { fetchTraceList } = await import('@/lib/debug')
    requireAdmin.mockResolvedValue({ session: { email: 'admin@x', role: 'admin' } })
    fetchTraceList.mockResolvedValue({ items: [{ requestId: 'r1', route: 'v1/analyze', status: 'success' }], nextCursor: null })
    const { GET } = await import('@/app/api/admin/trace/route?bust=l3')
    const res = await GET(new Request('http://x/api/admin/trace?date=20260419'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.items).toHaveLength(1)
  })
})
```

注意：Next.js app router 路由文件的测试 import 路径需要 `@/src/app/api/admin/trace/route` 或调整 vitest alias。若实测 alias 不兼容，把路径改成相对 import：`'../../src/app/api/admin/trace/route.js'`。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现路由**

创建 `src/app/api/admin/trace/route.js`：

```js
export const dynamic = 'force-dynamic'

import { requireAdmin } from '@/lib/auth'
import { fetchTraceList } from '@/lib/debug'

export async function GET(req) {
  const gate = await requireAdmin()
  if (gate.error) {
    return Response.json({ ok: false, error: gate.error }, { status: gate.status })
  }

  const url = new URL(req.url)
  const date = url.searchParams.get('date') || undefined
  const status = url.searchParams.get('status') || undefined
  const route = url.searchParams.get('route') || undefined
  const limit = parseInt(url.searchParams.get('limit') || '50', 10)
  const cursor = url.searchParams.get('cursor') || '0'

  const data = await fetchTraceList({ date, status, route, limit, cursor })
  return Response.json({ ok: true, data })
}
```

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add src/app/api/admin/trace/route.js test/admin-trace-api.test.js
git commit -m "feat(api): GET /api/admin/trace list endpoint, admin-only"
```

---

### Task 12: `GET /api/admin/trace/[requestId]` 详情端点

**Files:**
- Create: `src/app/api/admin/trace/[requestId]/route.js`
- Modify: `test/admin-trace-api.test.js`

- [ ] **Step 1: 追加详情 API 测试**

```js
describe('GET /api/admin/trace/[requestId]', () => {
  it('404 when trace not found', async () => {
    const { requireAdmin } = await import('@/lib/auth')
    const { fetchTraceDetail } = await import('@/lib/debug')
    requireAdmin.mockResolvedValue({ session: { role: 'admin' } })
    fetchTraceDetail.mockResolvedValue(null)
    const { GET } = await import('@/app/api/admin/trace/[requestId]/route?bust=d1')
    const res = await GET(new Request('http://x/api/admin/trace/nope'), { params: { requestId: 'nope' } })
    expect(res.status).toBe(404)
  })

  it('200 returns detail for known requestId', async () => {
    const { requireAdmin } = await import('@/lib/auth')
    const { fetchTraceDetail } = await import('@/lib/debug')
    requireAdmin.mockResolvedValue({ session: { role: 'admin' } })
    fetchTraceDetail.mockResolvedValue({ meta: { requestId: 'r1' }, events: [{ seq: 1, tag: 'x' }] })
    const { GET } = await import('@/app/api/admin/trace/[requestId]/route?bust=d2')
    const res = await GET(new Request('http://x/api/admin/trace/r1'), { params: { requestId: 'r1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.meta.requestId).toBe('r1')
    expect(body.data.events).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现路由**

创建 `src/app/api/admin/trace/[requestId]/route.js`：

```js
export const dynamic = 'force-dynamic'

import { requireAdmin } from '@/lib/auth'
import { fetchTraceDetail } from '@/lib/debug'

export async function GET(req, { params }) {
  const gate = await requireAdmin()
  if (gate.error) {
    return Response.json({ ok: false, error: gate.error }, { status: gate.status })
  }

  const { requestId } = params
  if (!requestId) {
    return Response.json({ ok: false, error: 'requestId required' }, { status: 400 })
  }

  const url = new URL(req.url)
  const date = url.searchParams.get('date') || undefined

  const data = await fetchTraceDetail(requestId, date)
  if (!data) {
    return Response.json({ ok: false, error: 'trace not found' }, { status: 404 })
  }
  return Response.json({ ok: true, data })
}
```

- [ ] **Step 4: 跑测试**

- [ ] **Step 5: 提交**

```bash
git add src/app/api/admin/trace/[requestId]/route.js test/admin-trace-api.test.js
git commit -m "feat(api): GET /api/admin/trace/:requestId detail endpoint"
```

---

### Task 13: admin layout（鉴权 + debug 顶栏）

**Files:**
- Create: `src/app/admin/layout.js`

- [ ] **Step 1: 实现 layout**

创建 `src/app/admin/layout.js`：

```js
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }) {
  const session = await getSession()
  if (!session) redirect('/')
  if (session.role !== 'admin') redirect('/')

  return (
    <div className="min-h-screen bg-white text-stripe-navy flex flex-col">
      <header className="h-14 border-b border-stripe-border flex items-center px-4 sm:px-6 gap-4 sticky top-0 bg-white z-10">
        <Link href="/" className="flex items-center gap-2 text-stripe-navy hover:text-stripe-purple">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
            <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="font-normal text-body">SnapCheck Debug</span>
        </Link>
        <div className="flex-1" />
        <Link
          href="/"
          className="text-link text-stripe-purple hover:text-stripe-purpleHover"
        >
          ← 返回主页
        </Link>
        <span className="text-caption text-stripe-body">{session.email}</span>
        <form action="/api/auth" method="POST">
          <input type="hidden" name="_method" value="DELETE" />
          <Link
            href="/api/auth/logout"
            className="text-link text-stripe-body hover:text-stripe-purple"
          >
            登出
          </Link>
        </form>
      </header>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
```

注意：现有登出是 `fetch('/api/auth', { method: 'DELETE' })`。这里为了保持 SSR 简单，登出按钮实际可以做一个客户端小组件；先用链接 + 一条 client component 的 LogoutButton，见下一步。

- [ ] **Step 2: 创建 client 登出按钮**

创建 `src/app/admin/_LogoutButton.js`：

```js
'use client'
import { useRouter } from 'next/navigation'

export default function LogoutButton() {
  const router = useRouter()
  async function onClick() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/')
    router.refresh()
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-link text-stripe-body hover:text-stripe-purple"
    >
      登出
    </button>
  )
}
```

修改 `src/app/admin/layout.js` 用这个组件替换 form：

```js
import LogoutButton from './_LogoutButton'
// ...
<LogoutButton />
```

删除 form 和多余的 Link。

- [ ] **Step 3: 本地 smoke**

```bash
npm run dev
```
访问 `http://localhost:3000/admin/traces`：
- 未登录 → 跳 `/`
- 非 admin → 跳 `/`
- admin → 看到顶栏 + 空白主区

- [ ] **Step 4: 提交**

```bash
git add src/app/admin/layout.js src/app/admin/_LogoutButton.js
git commit -m "feat(admin): layout with auth gate and debug-style topbar"
```

---

### Task 14: `/admin/traces` 列表页

**Files:**
- Create: `src/app/admin/traces/page.js`

- [ ] **Step 1: 实现列表页**

创建 `src/app/admin/traces/page.js`：

```js
'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

function todayUtc() {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function statusColor(status) {
  if (status === 'success') return 'bg-stripe-success/15 text-stripe-successText border-stripe-success/40'
  if (status === 'error')   return 'bg-stripe-ruby/15 text-stripe-ruby border-stripe-ruby/40'
  if (status === 'running') return 'bg-stripe-lemon/15 text-stripe-lemon border-stripe-lemon/40'
  return 'bg-stripe-border text-stripe-body border-stripe-border'
}

function riskColor(risk) {
  if (risk === 'high')   return 'text-stripe-ruby'
  if (risk === 'medium') return 'text-stripe-lemon'
  if (risk === 'low')    return 'text-stripe-successText'
  return 'text-stripe-body'
}

function formatTime(ms) {
  if (!ms) return '-'
  const d = new Date(Number(ms))
  return d.toISOString().replace('T', ' ').slice(11, 19) + ' UTC'
}

export default function TracesListPage() {
  const [date, setDate] = useState(todayUtc())
  const [status, setStatus] = useState('all')
  const [route, setRoute] = useState('all')
  const [search, setSearch] = useState('')
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState('0')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchPage = useCallback(async (reset) => {
    setLoading(true)
    setError('')
    try {
      const yyyymmdd = date.replace(/-/g, '')
      const params = new URLSearchParams({ date: yyyymmdd, limit: '50' })
      if (status !== 'all') params.set('status', status)
      if (route !== 'all')  params.set('route', route)
      if (!reset && cursor) params.set('cursor', cursor)
      const r = await fetch(`/api/admin/trace?${params}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const body = await r.json()
      if (!body.ok) throw new Error(body.error || 'unknown error')
      setItems(reset ? body.data.items : [...items, ...body.data.items])
      setCursor(body.data.nextCursor || '')
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [date, status, route, cursor, items])

  useEffect(() => {
    setCursor('0')
    fetchPage(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, status, route])

  const filtered = search
    ? items.filter(i => i.requestId.toLowerCase().includes(search.toLowerCase()))
    : items

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
      <h1 className="text-heading font-light text-stripe-navy mb-6">Trace List</h1>

      <div className="sticky top-0 bg-white z-10 flex flex-wrap items-center gap-3 py-3 border-b border-stripe-border mb-4">
        <label className="flex items-center gap-2">
          <span className="text-caption text-stripe-body">日期</span>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="h-9 px-2 border border-stripe-border rounded-stripe-sm text-caption"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-caption text-stripe-body">状态</span>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="h-9 px-2 border border-stripe-border rounded-stripe-sm text-caption bg-white"
          >
            <option value="all">全部</option>
            <option value="success">成功</option>
            <option value="error">失败</option>
            <option value="running">进行中</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-caption text-stripe-body">Route</span>
          <select
            value={route}
            onChange={e => setRoute(e.target.value)}
            className="h-9 px-2 border border-stripe-border rounded-stripe-sm text-caption bg-white"
          >
            <option value="all">全部</option>
            <option value="v1/analyze">v1/analyze</option>
            <option value="analyze">analyze</option>
            <option value="v1/profile">v1/profile</option>
          </select>
        </label>
        <input
          type="text"
          placeholder="requestId 前缀搜索"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-9 px-3 border border-stripe-border rounded-stripe-sm text-caption w-64"
        />
        <button
          type="button"
          onClick={() => { setCursor('0'); fetchPage(true) }}
          className="h-9 px-3 bg-stripe-purple text-white rounded-stripe-sm text-caption hover:bg-stripe-purpleHover"
        >
          刷新
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 bg-stripe-ruby/10 text-stripe-ruby border border-stripe-ruby/30 rounded-stripe text-caption">
          {error}
        </div>
      )}

      <div className="overflow-x-auto border border-stripe-border rounded-stripe">
        <table className="w-full text-caption">
          <thead className="bg-stripe-border/30 border-b border-stripe-border">
            <tr className="text-left">
              <th className="px-3 py-2 font-normal">开始时间</th>
              <th className="px-3 py-2 font-normal">requestId</th>
              <th className="px-3 py-2 font-normal">route</th>
              <th className="px-3 py-2 font-normal">status</th>
              <th className="px-3 py-2 font-normal">时长 ms</th>
              <th className="px-3 py-2 font-normal">riskLevel</th>
              <th className="px-3 py-2 font-normal">caller</th>
              <th className="px-3 py-2 font-normal">询盘预览</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-stripe-body">该日期无 trace</td></tr>
            )}
            {filtered.map(it => (
              <tr key={it.requestId} className="border-b border-stripe-border hover:bg-stripe-purpleLight/10 cursor-pointer">
                <td className="px-3 py-2 font-mono">{formatTime(it.startMs)}</td>
                <td className="px-3 py-2 font-mono">
                  <Link href={`/admin/traces/${it.requestId}?date=${date.replace(/-/g, '')}`} className="text-stripe-purple hover:underline">
                    {String(it.requestId).slice(0, 8)}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono">{it.route}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded-stripe-sm border text-caption-sm ${statusColor(it.status)}`}>
                    {it.status}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono">{it.durationMs ?? '-'}</td>
                <td className={`px-3 py-2 font-normal ${riskColor(it.riskLevel)}`}>{it.riskLevel || '-'}</td>
                <td className="px-3 py-2 text-stripe-body truncate max-w-[160px]">{it.caller || '-'}</td>
                <td className="px-3 py-2 text-stripe-body truncate max-w-[280px]">{it.inquiryPreview || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-center">
        {cursor && (
          <button
            type="button"
            disabled={loading}
            onClick={() => fetchPage(false)}
            className="h-9 px-4 border border-stripe-border rounded-stripe-sm text-caption hover:bg-stripe-purpleLight/10"
          >
            {loading ? '加载中…' : '加载更多'}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 本地 smoke**

```bash
npm run dev
```
用 admin 登录后访问 `/admin/traces`，观察列表是否渲染（目前应该为空，因为还没产生 trace）。

- [ ] **Step 3: 提交**

```bash
git add src/app/admin/traces/page.js
git commit -m "feat(admin): traces list page with filters and pagination"
```

---

### Task 15: `/admin/traces/[requestId]` 详情页

**Files:**
- Create: `src/app/admin/traces/[requestId]/page.js`

- [ ] **Step 1: 实现详情页**

创建 `src/app/admin/traces/[requestId]/page.js`：

```js
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'

function statusColor(status) {
  if (status === 'success') return 'bg-stripe-success/15 text-stripe-successText border-stripe-success/40'
  if (status === 'error')   return 'bg-stripe-ruby/15 text-stripe-ruby border-stripe-ruby/40'
  if (status === 'running') return 'bg-stripe-lemon/15 text-stripe-lemon border-stripe-lemon/40'
  return 'bg-stripe-border text-stripe-body border-stripe-border'
}

function eventColor(level) {
  if (level === 'error') return 'border-l-stripe-ruby'
  if (level === 'warn')  return 'border-l-stripe-lemon'
  return 'border-l-stripe-purple'
}

function groupEvents(events) {
  const groups = []
  let cur = null
  for (const e of events) {
    if (!cur || cur.tag !== e.tag) {
      cur = { tag: e.tag, events: [e] }
      groups.push(cur)
    } else {
      cur.events.push(e)
    }
  }
  return groups.map(g => ({
    tag: g.tag,
    events: g.events,
    durationMs: g.events.length > 1 ? g.events[g.events.length - 1].ts - g.events[0].ts : 0,
    level: g.events.some(e => e.level === 'error') ? 'error'
         : g.events.some(e => e.level === 'warn')  ? 'warn'
         : 'info',
  }))
}

export default function TraceDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const requestId = params.requestId
  const date = searchParams.get('date') || undefined

  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [openTags, setOpenTags] = useState({})

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      try {
        const params = date ? `?date=${date}` : ''
        const r = await fetch(`/api/admin/trace/${requestId}${params}`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const body = await r.json()
        if (!body.ok) throw new Error(body.error || 'unknown error')
        if (!cancelled) setData(body.data)
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [requestId, date])

  const groups = useMemo(() => groupEvents(data?.events || []), [data])
  const llmResponseEvent = useMemo(() => (data?.events || []).find(e => e.event === 'llm_response'), [data])

  if (loading) return <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-12 text-center text-stripe-body">加载中…</div>
  if (error) return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
      <Link href="/admin/traces" className="text-link text-stripe-purple">← 返回列表</Link>
      <div className="mt-4 px-4 py-2 bg-stripe-ruby/10 text-stripe-ruby border border-stripe-ruby/30 rounded-stripe text-caption">{error}</div>
    </div>
  )
  if (!data) return null

  const { meta } = data
  const images = meta.inquiryImages || []

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
      <div className="mb-4 flex items-center gap-3 text-caption">
        <Link href="/admin/traces" className="text-stripe-purple hover:underline">← 返回列表</Link>
        <span className="text-stripe-body">/</span>
        <span className="font-mono">{requestId}</span>
      </div>

      <div className="mb-6 p-4 border border-stripe-border rounded-stripe bg-white">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-caption">
          <Field label="status">
            <span className={`inline-block px-2 py-0.5 rounded-stripe-sm border text-caption-sm ${statusColor(meta.status)}`}>{meta.status}</span>
          </Field>
          <Field label="route">{meta.route || '-'}</Field>
          <Field label="时长 ms">{meta.durationMs || '-'}</Field>
          <Field label="riskLevel">{meta.riskLevel || '-'}</Field>
          <Field label="model">{meta.model || '-'}</Field>
          <Field label="tokens">{meta.tokens ? `${meta.tokens.prompt}/${meta.tokens.completion}` : '-'}</Field>
          <Field label="caller">{meta.caller || '-'}</Field>
          <Field label="errorCode">{meta.errorCode || '-'}</Field>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_360px] gap-4">
        {/* Left: inputs */}
        <div className="space-y-4">
          <Card title="询盘原文">
            <pre className="whitespace-pre-wrap break-words text-caption-sm font-mono text-stripe-navy">{meta.inquiryText || '(空)'}</pre>
          </Card>
          <Card title="Company Profile">
            <pre className="whitespace-pre-wrap break-words text-caption-sm font-mono text-stripe-navy max-h-64 overflow-auto">{meta.companyProfile || '(空)'}</pre>
          </Card>
          <Card title={`图片 (${images.length})`}>
            {images.length === 0 && <div className="text-stripe-body text-caption">(无)</div>}
            {images.map((img, i) => (
              <div key={i} className="mb-3 pb-3 border-b border-stripe-border last:border-0">
                <div className="text-caption-sm text-stripe-body mb-1">
                  {img.type} · {img.size} B · {img.truncated ? '截断' : '完整'}
                </div>
                {img.base64 && !img.truncated && (
                  <img src={`data:${img.type};base64,${img.base64}`} alt="" className="max-w-full rounded-stripe-sm border border-stripe-border" />
                )}
                {img.url && (
                  <a href={img.url} target="_blank" rel="noopener noreferrer" className="text-link text-stripe-purple break-all">{img.url}</a>
                )}
                {img.truncated && (
                  <div className="text-caption-sm font-mono text-stripe-body">sha256: {img.sha256?.slice(0, 16)}…</div>
                )}
              </div>
            ))}
          </Card>
        </div>

        {/* Middle: timeline */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <button type="button" onClick={() => setOpenTags(Object.fromEntries(groups.map(g => [g.tag, true])))} className="h-8 px-3 text-caption-sm border border-stripe-border rounded-stripe-sm hover:bg-stripe-purpleLight/10">全部展开</button>
            <button type="button" onClick={() => setOpenTags({})} className="h-8 px-3 text-caption-sm border border-stripe-border rounded-stripe-sm hover:bg-stripe-purpleLight/10">全部折叠</button>
          </div>
          <div className="space-y-2">
            {groups.map((g, gi) => {
              const isOpen = !!openTags[`${g.tag}_${gi}`]
              return (
                <div key={gi} className={`border border-stripe-border border-l-4 ${eventColor(g.level)} rounded-stripe bg-white`}>
                  <button
                    type="button"
                    onClick={() => setOpenTags({ ...openTags, [`${g.tag}_${gi}`]: !isOpen })}
                    className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-stripe-purpleLight/10"
                  >
                    <span className="font-mono text-caption text-stripe-navy">{g.tag}</span>
                    <span className="flex items-center gap-3 text-caption-sm text-stripe-body">
                      <span>{g.events.length} events</span>
                      {g.durationMs > 0 && <span className="font-mono">{g.durationMs} ms</span>}
                      <span>{isOpen ? '▾' : '▸'}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-stripe-border">
                      {g.events.map((e, ei) => (
                        <div key={ei} className="px-3 py-2 border-b border-stripe-border last:border-0">
                          <div className="flex items-center gap-3 text-caption-sm mb-1">
                            <span className="font-mono text-stripe-navy">{e.event}</span>
                            <span className="text-stripe-body">seq {e.seq}</span>
                            <span className="text-stripe-body ml-auto">{e.payloadSize} B{e.truncated ? ' (截断)' : ''}</span>
                          </div>
                          <pre className="whitespace-pre-wrap break-words text-caption-sm font-mono bg-stripe-border/20 p-2 rounded-stripe-sm max-h-80 overflow-auto">
                            {JSON.stringify(e.payload, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {groups.length === 0 && <div className="text-stripe-body text-caption py-8 text-center">(没有节点事件)</div>}
          </div>
        </div>

        {/* Right: final LLM report */}
        <div>
          <Card title="LLM 最终输出">
            {llmResponseEvent ? (
              <>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(llmResponseEvent.payload?.content || '')}
                  className="mb-2 h-7 px-2 text-caption-sm border border-stripe-border rounded-stripe-sm hover:bg-stripe-purpleLight/10"
                >
                  复制
                </button>
                <pre className="whitespace-pre-wrap break-words text-caption-sm font-mono text-stripe-navy max-h-[600px] overflow-auto">
                  {llmResponseEvent.payload?.content || '(空)'}
                </pre>
              </>
            ) : (
              <div className="text-stripe-body text-caption">(未找到 llm_response 事件)</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div className="border border-stripe-border rounded-stripe bg-white">
      <div className="px-3 py-2 border-b border-stripe-border text-caption font-normal text-stripe-navy">{title}</div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-caption-sm text-stripe-body mb-0.5">{label}</div>
      <div className="font-mono text-caption text-stripe-navy">{children}</div>
    </div>
  )
}
```

- [ ] **Step 2: 本地 smoke**

```bash
npm run dev
```
用 admin 登录，先跑一条 `/api/v1/analyze` 请求（可以用 curl 或触发任意 analyze），然后访问 `/admin/traces`，点进详情查看时间线。

- [ ] **Step 3: 提交**

```bash
git add src/app/admin/traces/[requestId]/page.js
git commit -m "feat(admin): trace detail page with timeline and full I/O view"
```

---

### Task 16: 在主应用侧边栏加 Debug NavItem

**Files:**
- Modify: `src/app/page.js`

- [ ] **Step 1: 定位**

在 `src/app/page.js` 找到：
- `import` 区顶部
- `NavItem`s 渲染区（约 1680-1708 行）
- `isAdmin` 计算位置（在 `Layout` 内，约 1640 行）

- [ ] **Step 2: 在 page.js 最顶部 `'use client'` 下添加 router import**

```js
import { useRouter } from 'next/navigation'
```

（该行追加在现有 import 集合里，别打乱其他 import）

- [ ] **Step 3: 在 `Layout` 组件内部追加 `useRouter`**

在 `function Layout({...})` 内 `const [mobileOpen, setMobileOpen] = useState(false)` 后追加：

```js
const router = useRouter()
```

- [ ] **Step 4: 定义 `DebugIcon`**

找到 `SearchIcon` / `ClockIcon` / `GearIcon` 定义处（靠 `grep -n "function SearchIcon" src/app/page.js` 定位），在它们旁边追加：

```js
function DebugIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8l3 3M5 19l3-3m8-8l3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}
```

- [ ] **Step 5: 追加 Debug NavItem**

在 `nav` 的 `设置` NavItem 之后、`</nav>` 之前追加：

```jsx
{isAdmin && (
  <NavItem
    icon={<DebugIcon />}
    label="Debug"
    active={false}
    onClick={() => {
      router.push('/admin/traces')
      setMobileOpen(false)
    }}
    adminBadge
  />
)}
```

- [ ] **Step 6: 本地 smoke**

```bash
npm run dev
```
- admin 登录 → 侧边栏能看到 Debug 菜单项
- 点击跳转 `/admin/traces`
- 非 admin 登录 → 看不到 Debug 菜单

- [ ] **Step 7: 跑测试**

```bash
npx vitest run && npm run build
```

- [ ] **Step 8: 提交**

```bash
git add src/app/page.js
git commit -m "feat(nav): add admin-only Debug NavItem linking to /admin/traces"
```

---

### Task 17: 端到端 smoke test 和 PR 提交

**Files:**
- 无代码改动，只跑测试 + 手工验证 + 发 PR

- [ ] **Step 1: 完整测试**

```bash
npx vitest run
```
期望：全部 PASS。

- [ ] **Step 2: 构建检查**

```bash
npm run build
```
期望：build success，无 TS 或 eslint 错误。

- [ ] **Step 3: 本地 smoke（关键）**

需要一个 Upstash Redis 实例（用 dev 环境变量）。

1. `npm run dev`
2. 登录为 admin 用户
3. 触发一条 `/api/v1/analyze` 请求（用前端分析页或 curl）
4. 打开 `/admin/traces`，确认：
   - 列表能看到刚跑的那条
   - 点进详情能看到所有节点（route/v1-analyze, intel/orchestrator, intel/extract, intel/fetchWebsite, intel/linkedin, ...）
   - 询盘原文、company_profile 原文、图片（若有）在左栏渲染
   - 时间线按 tag 分组显示
   - 右栏 LLM 输出全文可见
5. 验证 `DEBUG_TRACE_ENABLED=false`：
   - 在 `.env.local` 设置 `DEBUG_TRACE_ENABLED=false`
   - 重启 dev server
   - 再跑一条请求
   - 刷新 `/admin/traces` 不应出现新条目
   - 请求本身照常完成

- [ ] **Step 4: 复核"零业务改动"**

```bash
git diff main -- src/app/api/v1/analyze/route.js src/app/api/analyze/route.js src/app/api/v1/profile/route.js lib/intel/
```
确认 diff 里：
- 只有**新增**的 `log.info(...)` 调用
- 没有删除任何行
- 没有改动任何现有函数的返回值、分支、异步流程

- [ ] **Step 5: 推送并发 PR**

```bash
git push -u origin feat/debug-trace-panel
gh pr create --title "feat: admin debug trace panel" --body "$(cat <<'EOF'
## Summary

- 新增 admin-only Debug Trace 面板：列表 `/admin/traces`、详情 `/admin/traces/[requestId]`
- 每条 `/api/analyze`、`/api/v1/analyze`、`/api/v1/profile` 请求的**全部节点输入 / 输出 / 耗时 / 状态**写入 Upstash Redis（`debug:` 前缀隔离），保留 14 天
- 环境变量 `DEBUG_TRACE_ENABLED=false` 一键关闭全站
- 主应用 `src/app/page.js` 侧边栏追加一条 admin-only 的 Debug 菜单项

## 零业务改动承诺

- route / intel pipeline 业务逻辑一行未改，只在函数体空隙追加 `log.info(...)` 调用
- 对 `lib/obs.js` / `lib/kv.js` / `lib/auth.js` 零改动
- `src/app/page.js` 仅追加 1 个 NavItem + 1 个 `useRouter` 调用，现有 3 个 NavItem 和页面分发逻辑一字未动
- API 契约零改动

## Spec
`docs/superpowers/specs/2026-04-19-debug-trace-panel-design.md`

## Test plan
- [x] `npx vitest run` 全绿
- [x] `npm run build` 成功
- [ ] admin 登录 → 触发一条 analyze → 列表能看到
- [ ] 点进详情 → 时间线 / 原文 / LLM 输出都在
- [ ] `DEBUG_TRACE_ENABLED=false` 后请求照常，面板停写
- [ ] 非 admin 访问 `/admin/traces` → 跳 `/`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: 清理 task 状态**

全部任务标记完成。

---

## Self-Review Notes

**Spec coverage:** ✓ 每个 spec 章节在 Task 1-17 里都有对应任务。

**Placeholder scan:** 无 TBD / TODO / "implement later"。每个 step 都有可执行内容。

**Type consistency check:**
- `startTrace({ requestId, route, startMs, meta })` —— Task 5 定义，Task 8 调用，参数一致 ✓
- `endTrace({ requestId, startMs, endMs, status, errorCode?, outcome? })` —— Task 5 定义，Task 8 调用 ✓
- `recordEvent({ requestId, startMs, tag, event, level, info })` —— Task 6 定义，Task 8 调用 ✓
- `fetchTraceDetail(requestId, dateKey)` —— Task 7 定义，Task 12 调用 ✓
- `fetchTraceList({ date, status, route, limit, cursor })` —— Task 7 定义，Task 11 调用 ✓

**Ambiguity fixed:**
- ENV 读取用 `?bust=N` query trick 绕过 vitest 的模块 cache（避免测试间环境变量污染）
- Upstash Redis 的 `zrange(..., { rev: true })` 语法假设按最新 SDK；若版本不支持，Task 7 的实现要退回 `zrevrange` 或手动反转
- UTC 日期跨日 trace 的归属：按 startMs 的 UTC 日期入索引。即使请求在 23:59:59 UTC 开始、00:00:01 结束，整条 trace 都在开始日期。

**Out of scope 明确记在 spec 里（后续 PR）：**
- 背调 bug 修复
- Blob 图片外挂
- DAG 可视化 / run diff / re-run

---

## 备注：失败兜底

若 Upstash Redis 的 `zrange` 语法和 SDK 版本不匹配（`rev: true` 不支持），Task 7 的实现里用：

```js
const ids = await redis.zrange(indexKey(d), 0, -1)
ids.reverse()
```

手动反转即可。其他所有 Redis 调用都是基础 get/set/hset/rpush/lrange，兼容性无忧。
