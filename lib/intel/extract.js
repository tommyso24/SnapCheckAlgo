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
export async function extractEntities({ inquiry, websiteText, images, baseUrl, apiKey, model, systemPrompt }) {
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

  // Fallback: if the LLM did not find a companyUrl but did extract a
  // corporate-looking email address, derive https://<domain> from the email.
  if (!extracted.companyUrl && extracted.email) {
    const derived = deriveCompanyUrlFromEmail(extracted.email)
    if (derived) extracted.companyUrl = derived
  }

  return { status: 'ok', extracted }
}
