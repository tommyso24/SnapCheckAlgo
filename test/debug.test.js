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
