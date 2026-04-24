// P7: thin helper for the main analysis LLM call. Extracted from route.js
// so the AbortSignal.timeout(...) behavior is unit-testable — the inline
// version inside the SSE route handler was impractical to exercise in a
// test without spinning up the whole stream.
//
// Default 270s = 4.5 min — generous for slow models, still inside the
// Vercel Pro Function 300s hard ceiling with 30s headroom for intel +
// post-processing (intel fan-out typically ~6s). A hung upstream now
// surfaces as a TimeoutError / AbortError that the caller translates
// to fail('llm', 'timeout') on the SSE stream instead of wedging
// `stage` at `llm_analysis` until Vercel kills the function.

export const LLM_TIMEOUT_MS = 270_000

export async function callMainLLM({
  endpoint,
  apiKey,
  model,
  messages,
  timeoutMs = LLM_TIMEOUT_MS,
}) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
}
