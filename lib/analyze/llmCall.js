// P7: thin helper for the main analysis LLM call. Extracted from route.js
// so the AbortSignal.timeout(...) behavior is unit-testable — the inline
// version inside the SSE route handler was impractical to exercise in a
// test without spinning up the whole stream.
//
// Default 180s = 3 min — generous for slow models, still inside the
// Vercel Function 300s hard ceiling with 2 min headroom for intel +
// post-processing. A hung upstream now surfaces as a TimeoutError /
// AbortError that the caller translates to fail('llm', 'timeout') on
// the SSE stream instead of wedging `stage` at `llm_analysis` for 5 min.

export const LLM_TIMEOUT_MS = 180_000

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
