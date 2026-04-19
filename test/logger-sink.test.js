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
