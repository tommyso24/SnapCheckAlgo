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
