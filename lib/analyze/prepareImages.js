// P6: normalize inquiry_images into the base64 form the downstream LLMs
// expect. Extracted from route.js as a pure async function so the fetch
// UA behavior + failure-logging contract can be unit tested without
// spinning up the whole SSE route.
//
// Invariants tested in test/analyze/prepareImages.test.js:
//   - base64-supplied entries pass through untouched
//   - URL-supplied entries are fetched with a BROWSER UA (not empty, not
//     SnapCheckBot) — many image CDNs (Alibaba, generic anti-hotlink,
//     SN's own buckets sometimes) 403 on bot-ish UAs
//   - every failure emits an `image_fetch_fail` log line (never silent)
//   - maximum 4 images per request

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const MAX_IMAGES = 4
const FETCH_TIMEOUT_MS = 10_000

function hostOf(url) {
  try { return new URL(url).host } catch { return null }
}

function classifyError(e) {
  if (e?.name === 'TimeoutError' || /timeout/i.test(e?.message || '')) return 'timeout'
  return (e?.message || String(e)).slice(0, 160)
}

export async function prepareImages(inquiryImages, log) {
  const prepared = []
  const list = Array.isArray(inquiryImages) ? inquiryImages.slice(0, MAX_IMAGES) : []
  for (const img of list) {
    if (img?.base64) {
      prepared.push({ base64: img.base64, type: img.type || 'image/jpeg' })
      continue
    }
    if (!img?.url) continue
    const imgHost = hostOf(img.url)
    try {
      const res = await fetch(img.url, {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (res.ok) {
        const buf = await res.arrayBuffer()
        const base64 = Buffer.from(buf).toString('base64')
        prepared.push({
          base64,
          type: img.type || res.headers.get('content-type') || 'image/jpeg',
        })
      } else {
        log.warn('image_fetch_fail', {
          host: imgHost,
          status: res.status,
          reason: `HTTP ${res.status}`,
        })
      }
    } catch (e) {
      log.warn('image_fetch_fail', {
        host: imgHost,
        reason: classifyError(e),
      })
    }
  }
  return prepared
}
