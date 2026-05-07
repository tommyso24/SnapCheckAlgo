// P7: thin helper for the main analysis LLM call. Extracted from route.js
// so the AbortSignal.timeout(...) behavior is unit-testable — the inline
// version inside the SSE route handler was impractical to exercise in a
// test without spinning up the whole stream.
//
// Default 570s = 9.5 min — generous for claude-sonnet-4-6 with large system
// prompts, still inside the Vercel Pro Function 600s hard ceiling with 30s
// headroom for intel + post-processing.
export const LLM_TIMEOUT_MS = 570_000

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
