import { describe, it, expect, vi, afterEach } from 'vitest'
import { callMainLLM, LLM_TIMEOUT_MS } from '@/lib/analyze/llmCall'

describe('callMainLLM', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('exports a 270s default timeout constant', () => {
    expect(LLM_TIMEOUT_MS).toBe(270_000)
  })

  it('passes an AbortSignal to fetch', async () => {
    const seen = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      seen.push(init)
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) }
    }))
    await callMainLLM({
      endpoint: 'https://llm.example/chat/completions',
      apiKey: 'k',
      model: 'gpt',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(seen).toHaveLength(1)
    expect(seen[0].signal).toBeInstanceOf(AbortSignal)
  })

  it('sends the correct body shape (model, stream:false, messages) and auth header', async () => {
    const seen = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      seen.push({ url, init })
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) }
    }))
    await callMainLLM({
      endpoint: 'https://llm.example/chat/completions',
      apiKey: 'my-key',
      model: 'gemini-x',
      messages: [{ role: 'user', content: 'hello' }],
    })
    expect(seen[0].url).toBe('https://llm.example/chat/completions')
    expect(seen[0].init.method).toBe('POST')
    expect(seen[0].init.headers.Authorization).toBe('Bearer my-key')
    const body = JSON.parse(seen[0].init.body)
    expect(body.model).toBe('gemini-x')
    expect(body.stream).toBe(false)
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  // Behavioral test of the actual timeout: short timeoutMs + a fetch that
  // never resolves → we must see the signal-driven abort, not a hang.
  it('aborts when timeoutMs elapses before fetch resolves', async () => {
    let abortedWith = null
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        abortedWith = init.signal.reason
        const e = new Error('aborted')
        e.name = 'AbortError'
        reject(e)
      })
      // Otherwise never resolves — simulates a hung upstream.
    })))
    await expect(callMainLLM({
      endpoint: 'https://llm.example',
      apiKey: 'k',
      model: 'm',
      messages: [],
      timeoutMs: 20,
    })).rejects.toThrow()
    expect(abortedWith).toBeDefined()
  })
})
