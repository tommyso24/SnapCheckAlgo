// Debug trace sink — admin-only, fire-and-forget per-request node tracing.
// Separate channel from obs.js: allowed to store raw inquiry text, images,
// and full LLM I/O for operational debugging. Gated behind DEBUG_TRACE_ENABLED.
//
// Storage layout (Upstash Redis, debug: prefix, TTL per config):
//   debug:meta:<YYYYMMDD>:<requestId>   hash, per-request summary
//   debug:trace:<YYYYMMDD>:<requestId>  list, append-only node events
//   debug:index:<YYYYMMDD>              zset score=startMs member=requestId

import crypto from 'crypto'

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
