import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prepareImages } from '@/lib/analyze/prepareImages'

// P6: image URL fetch must use a browser UA AND every failure must leave
// a log line (silent drops hid degraded inquiries from observability).

function mkFakeLog() {
  const calls = []
  return {
    log: {
      warn: (evt, data) => calls.push(['warn', evt, data]),
      info: (evt, data) => calls.push(['info', evt, data]),
    },
    calls,
  }
}

function okImageResponse(bytes = new Uint8Array([1, 2, 3, 4]), contentType = 'image/jpeg') {
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => bytes.buffer,
  }
}

describe('prepareImages', () => {
  beforeEach(() => {
    // Each test stubs fetch on its own.
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes base64-supplied images through untouched', async () => {
    const { log } = mkFakeLog()
    const out = await prepareImages(
      [{ base64: 'abc', type: 'image/png' }],
      log
    )
    expect(out).toEqual([{ base64: 'abc', type: 'image/png' }])
  })

  it('defaults type to image/jpeg when not specified on base64 entry', async () => {
    const { log } = mkFakeLog()
    const out = await prepareImages([{ base64: 'abc' }], log)
    expect(out[0].type).toBe('image/jpeg')
  })

  it('caps at 4 images', async () => {
    const { log } = mkFakeLog()
    const inputs = Array.from({ length: 7 }, (_, i) => ({ base64: `b${i}` }))
    const out = await prepareImages(inputs, log)
    expect(out).toHaveLength(4)
  })

  it('uses a browser User-Agent (not empty / not SnapCheckBot) when fetching URL-supplied images', async () => {
    const capturedInit = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      capturedInit.push(init)
      return okImageResponse()
    }))
    const { log } = mkFakeLog()
    await prepareImages([{ url: 'https://cdn.example.com/a.jpg' }], log)
    expect(capturedInit).toHaveLength(1)
    const ua = capturedInit[0].headers['User-Agent']
    expect(ua).toMatch(/Mozilla\/5\.0.*Chrome/i)
    expect(ua).not.toMatch(/SnapCheckBot/i)
  })

  it('converts URL fetch response to base64 entry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okImageResponse(new Uint8Array([1, 2, 3]), 'image/png')))
    const { log } = mkFakeLog()
    const out = await prepareImages([{ url: 'https://cdn.example.com/a.png' }], log)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('image/png')
    expect(out[0].base64).toBe(Buffer.from([1, 2, 3]).toString('base64'))
  })

  it('logs image_fetch_fail with host+status+reason when response is non-2xx (NOT silent)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    })))
    const { log, calls } = mkFakeLog()
    const out = await prepareImages([{ url: 'https://cdn.example.com/a.jpg' }], log)
    expect(out).toHaveLength(0)
    const warnCall = calls.find(c => c[0] === 'warn' && c[1] === 'image_fetch_fail')
    expect(warnCall).toBeDefined()
    expect(warnCall[2].host).toBe('cdn.example.com')
    expect(warnCall[2].status).toBe(403)
  })

  it('logs image_fetch_fail on network error / timeout (NOT silent)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const err = new Error('timeout')
      err.name = 'TimeoutError'
      throw err
    }))
    const { log, calls } = mkFakeLog()
    const out = await prepareImages([{ url: 'https://cdn.example.com/a.jpg' }], log)
    expect(out).toHaveLength(0)
    const warnCall = calls.find(c => c[0] === 'warn' && c[1] === 'image_fetch_fail')
    expect(warnCall).toBeDefined()
    expect(warnCall[2].host).toBe('cdn.example.com')
    expect(warnCall[2].reason).toMatch(/timeout/i)
  })

  it('mixes base64 and URL entries in a single call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okImageResponse()))
    const { log } = mkFakeLog()
    const out = await prepareImages(
      [
        { base64: 'pre-existing' },
        { url: 'https://cdn.example.com/a.jpg' },
      ],
      log
    )
    expect(out).toHaveLength(2)
    expect(out[0].base64).toBe('pre-existing')
    expect(out[1].base64).toBeTruthy()
  })
})
