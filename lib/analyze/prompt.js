// Shared prompt-building helpers for the analyze pipeline.
//
// `buildUserSiteBlock` constructs the "我方公司背景" (who-we-are) context
// injected into the main analysis LLM's user message. Extracted as a pure
// function so the priority waterfall is unit-testable (P3 regression: the
// prior inline version put userSite.excerpt ahead of companyText, which
// meant SN's 2000-3000 word profile_report never made it into the prompt
// once direct fetch of our own site succeeded).

const HEADER = '【我方公司背景(收件方,仅供语境参考,不是调查目标)】'

export function buildUserSiteBlock({ companyText, companyObj, url, userSite, userContext }) {
  const safeUrl = url || ''
  const obj = companyObj || {}

  // Priority 1: companyText (SN contract §10.7 markdown profile_report).
  // Richest and most accurate. Used verbatim.
  if (companyText && typeof companyText === 'string' && companyText.trim().length > 0) {
    return (
      `${HEADER}\n` +
      (safeUrl ? `网址:${safeUrl}\n` : '') +
      `资料:${companyText}\n\n`
    )
  }

  // Priority 2: legacy structured object form.
  if (obj.intro) {
    return (
      `${HEADER}\n` +
      `公司名:${obj.name || '未提供'}\n` +
      `网址:${safeUrl || '未提供'}\n` +
      `简介:${obj.intro}\n` +
      (obj.industry ? `行业:${obj.industry}\n` : '') +
      (obj.product_lines?.length ? `产品线:${obj.product_lines.join('、')}\n` : '') +
      `\n`
    )
  }

  // Priority 3: directly-scraped HTML excerpt + supplementary Serper hits.
  if (userSite && userSite.status === 'ok') {
    let block =
      `${HEADER}\n` +
      `网址:${safeUrl || '未提供'}\n` +
      (userSite.title ? `网站标题:${userSite.title}\n` : '') +
      `网站摘录:${(userSite.excerpt || '').slice(0, 1500).replace(/\n/g, ' ')}\n`
    if (userContext && userContext.results?.length > 0) {
      block +=
        `\n我方公司网络足迹(Google 搜索 ${userContext.query}):\n` +
        userContext.results
          .map((r, i) => `  ${i + 1}. ${r.title} — ${r.link}\n     ${r.snippet || ''}`)
          .join('\n') +
        `\n`
    }
    return block + `\n`
  }

  // Priority 4: bare-url fallback (compact).
  return `**我方公司网址:** ${safeUrl || '未提供'}\n\n`
}
