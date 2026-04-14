// Calls the lightweight extraction LLM and parses a structured JSON result.
// Pure parser (`parseExtractionJson`) and email-derivation helper are
// exported for testing.

const FIELDS = [
  'companyName',
  'companyUrl',
  'personName',
  'personTitle',
  'email',
  'phone',
  'country',
  'products',
]

// Public/free email providers — if the extracted email uses one of these
// domains, we cannot treat the domain as a corporate website.
const FREE_EMAIL_DOMAINS = new Set([
  // Western
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.co.uk', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.jp', 'yahoo.co.in', 'yahoo.fr', 'yahoo.de',
  'ymail.com', 'rocketmail.com',
  'aol.com', 'aim.com',
  'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'pm.me',
  'zoho.com', 'zohomail.com',
  'yandex.com', 'yandex.ru',
  'mail.com', 'email.com',
  'gmx.com', 'gmx.net', 'gmx.de', 'gmx.us',
  'web.de', 't-online.de',
  'fastmail.com', 'fastmail.fm',
  'tutanota.com', 'tutanota.de', 'tuta.io',
  // Chinese
  '163.com', '126.com', 'yeah.net', '139.com', '189.cn', '188.com',
  'qq.com', 'foxmail.com', 'vip.qq.com',
  'sina.com', 'sina.cn', 'vip.sina.com',
  'sohu.com', 'tom.com', 'aliyun.com',
  // Korean
  'naver.com', 'daum.net', 'hanmail.net', 'kakao.com',
  // Indian
  'rediffmail.com',
  // Japanese
  'nifty.com', 'biglobe.ne.jp', 'excite.co.jp',
  // Russian
  'mail.ru', 'bk.ru', 'list.ru', 'inbox.ru', 'rambler.ru',
])

export function deriveCompanyUrlFromEmail(email) {
  if (!email || typeof email !== 'string') return null
  const match = email.toLowerCase().trim().match(/@([a-z0-9][a-z0-9.-]*\.[a-z]{2,})$/i)
  if (!match) return null
  const domain = match[1]
  if (FREE_EMAIL_DOMAINS.has(domain)) return null
  return `https://${domain}`
}

// Domains that, even when pasted in an inquiry, don't describe the sender's
// own corporate website — social, search, marketplaces, messaging, customs DBs.
const NON_COMPANY_DOMAINS = new Set([
  'google.com', 'google.co.uk', 'bing.com', 'baidu.com', 'yahoo.com', 'duckduckgo.com',
  'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com',
  'linkedin.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'pinterest.com',
  'reddit.com', 'wikipedia.org', 'wikimedia.org',
  'alibaba.com', 'aliexpress.com', '1688.com', 'taobao.com', 'tmall.com', 'made-in-china.com',
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'ebay.com', 'walmart.com',
  'whatsapp.com', 'wa.me', 'wechat.com', 'weixin.qq.com', 'telegram.org', 't.me', 'signal.org',
  'panjiva.com', 'importgenius.com',
  'github.com', 'gitlab.com',
])

// Extract the first plausible corporate URL from free-form text.
// - Requires http://, https://, or www. prefix (so we don't match email domains)
// - Filters out known social / search / marketplace / free-email domains
// - Filters out `excludeDomain` (typically the user's own site)
export function deriveCompanyUrlFromText(text, excludeDomain) {
  if (!text || typeof text !== 'string') return null

  const excluded = new Set([...FREE_EMAIL_DOMAINS, ...NON_COMPANY_DOMAINS])
  if (excludeDomain && typeof excludeDomain === 'string') {
    const d = excludeDomain
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
    if (d) {
      excluded.add(d)
      // Also exclude the base 2-segment form (e.g. shop.mysite.com → mysite.com)
      const parts = d.split('.')
      if (parts.length > 2) excluded.add(parts.slice(-2).join('.'))
    }
  }

  const regex = /(?:https?:\/\/|\bwww\.)([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi
  const seen = new Set()
  const matches = [...text.toLowerCase().matchAll(regex)]
  for (const m of matches) {
    let domain = m[1].toLowerCase()
    if (domain.startsWith('www.')) domain = domain.slice(4)
    if (seen.has(domain)) continue
    seen.add(domain)

    const parts = domain.split('.')
    if (parts.length < 2) continue
    const last2 = parts.slice(-2).join('.')

    if (excluded.has(domain) || excluded.has(last2)) continue

    return `https://${domain}`
  }
  return null
}

export function parseExtractionJson(raw) {
  if (!raw || typeof raw !== 'string') return null

  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()

  let obj = null
  try { obj = JSON.parse(text) } catch {}

  if (!obj) {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      try { obj = JSON.parse(m[0]) } catch {}
    }
  }

  if (!obj || typeof obj !== 'object') return null

  const out = {}
  for (const f of FIELDS) {
    if (f === 'products') out.products = Array.isArray(obj.products) ? obj.products.map(String) : []
    else out[f] = obj[f] ?? null
  }
  return out
}

// Identifies the INQUIRY SENDER (investigation target), NOT the user's own company.
// Accepts images (business cards, email screenshots) as multimodal input.
// `userUrl` is the user's own site URL — passed so the fallback URL-regex
// doesn't accidentally pick up the exporter's own domain from the inquiry.
export async function extractEntities({ inquiry, websiteText, images, userUrl, baseUrl, apiKey, model, systemPrompt }) {
  if (!baseUrl || !apiKey) {
    return { status: 'skipped', error: 'missing baseUrl or apiKey', extracted: null }
  }

  const hasImages = Array.isArray(images) && images.length > 0
  const textPart =
    (websiteText
      ? `【我方公司背景(收件方,仅供参考,不要抽取为发件方)】\n${websiteText.slice(0, 1500)}\n\n`
      : '') +
    `【询盘文本】\n${inquiry || '(无)'}` +
    (hasImages ? `\n\n【图片附件】共 ${images.length} 张,请 OCR 识别其中的发件方姓名/公司/邮箱/电话/网址。` : '')

  const userContent = hasImages
    ? [
        { type: 'text', text: textPart },
        ...images.map(img => ({
          type: 'image_url',
          image_url: {
            url: `data:${img.type || 'image/jpeg'};base64,${img.base64}`,
            detail: 'high',
          },
        })),
      ]
    : textPart

  const endpoint = baseUrl.replace(/\/$/, '') + '/chat/completions'

  let res
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(hasImages ? 30000 : 15000),
    })
  } catch (e) {
    return { status: 'failed', error: e.message || String(e), extracted: null }
  }

  if (!res.ok) {
    let detail = ''
    try { detail = await res.text() } catch {}
    return { status: 'failed', error: `HTTP ${res.status}: ${detail.slice(0, 200)}`, extracted: null }
  }

  let json
  try { json = await res.json() } catch (e) {
    return { status: 'failed', error: 'non-json response', extracted: null }
  }

  const content = json?.choices?.[0]?.message?.content ?? ''
  const extracted = parseExtractionJson(content)
  if (!extracted) return { status: 'failed', error: 'parse failed', extracted: null, raw: content }

  // Defensive: if the LLM extracted the user's own URL as the sender's URL
  // (confused), clear it so the fallbacks below can pick a better one.
  if (extracted.companyUrl && userUrl) {
    const extractedDomain = String(extracted.companyUrl)
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
    const userDomain = String(userUrl)
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
    if (extractedDomain && userDomain && extractedDomain === userDomain) {
      extracted.companyUrl = null
    }
  }

  // Fallback chain — run in priority order:
  //   1. LLM already extracted a good companyUrl → keep it
  //   2. Regex scan of the inquiry text for an http/https/www URL
  //   3. Derive from a corporate email domain
  if (!extracted.companyUrl) {
    const fromText = deriveCompanyUrlFromText(inquiry || '', userUrl)
    if (fromText) extracted.companyUrl = fromText
  }
  if (!extracted.companyUrl && extracted.email) {
    const fromEmail = deriveCompanyUrlFromEmail(extracted.email)
    if (fromEmail) extracted.companyUrl = fromEmail
  }

  return { status: 'ok', extracted }
}
