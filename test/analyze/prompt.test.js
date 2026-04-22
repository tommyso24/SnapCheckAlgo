import { describe, it, expect } from 'vitest'
import { buildUserSiteBlock } from '@/lib/analyze/prompt'

// P3: main-LLM "我方公司背景" block priority waterfall must be:
//   1. companyText (SN contract §10.7 markdown profile_report) — the richest
//      self-description we have, always wins when present
//   2. companyObj.intro (legacy structured object form)
//   3. userSite.excerpt (scraped HTML — last resort, 3000-char stripped)
//   4. bare url fallback

describe('buildUserSiteBlock', () => {
  const headerMarker = '【我方公司背景(收件方'

  it('[priority 1] companyText present — used verbatim, userSite.excerpt ignored', () => {
    const out = buildUserSiteBlock({
      companyText: '# 星籽包装\n\n我们是环保包装制造商，服务东南亚市场。',
      companyObj: { intro: 'structured-intro-should-be-ignored' },
      url: 'https://starseedpkg.com',
      userSite: { status: 'ok', excerpt: 'scraped-html-excerpt-should-be-ignored', title: 'Star Seed' },
      userContext: { query: 'starseed', results: [{ title: 'x', link: 'y', snippet: 'z' }] },
    })
    expect(out).toContain(headerMarker)
    expect(out).toContain('星籽包装')
    expect(out).toContain('环保包装制造商')
    expect(out).toContain('https://starseedpkg.com')
    // Richer sources must NOT leak in when companyText wins
    expect(out).not.toContain('scraped-html-excerpt-should-be-ignored')
    expect(out).not.toContain('structured-intro-should-be-ignored')
  })

  it('[priority 1] companyText present without url — block still emitted, no 网址 line', () => {
    const out = buildUserSiteBlock({
      companyText: '我们是做 LED 的。',
      companyObj: {},
      url: '',
      userSite: null,
      userContext: null,
    })
    expect(out).toContain('LED')
    expect(out).not.toContain('网址:')
  })

  it('[priority 2] companyObj.intro used when companyText empty', () => {
    const out = buildUserSiteBlock({
      companyText: '',
      companyObj: {
        name: 'Acme',
        intro: 'we make widgets',
        industry: 'industrial',
        product_lines: ['sensors', 'gauges'],
      },
      url: 'https://acme.com',
      userSite: { status: 'ok', excerpt: 'should-not-appear' },
      userContext: null,
    })
    expect(out).toContain('公司名:Acme')
    expect(out).toContain('we make widgets')
    expect(out).toContain('行业:industrial')
    expect(out).toContain('sensors、gauges')
    expect(out).not.toContain('should-not-appear')
  })

  it('[priority 3] userSite.excerpt used only when both companyText AND intro are empty', () => {
    const out = buildUserSiteBlock({
      companyText: '',
      companyObj: { name: 'Acme' },  // no intro
      url: 'https://acme.com',
      userSite: {
        status: 'ok',
        title: 'Acme — Home',
        excerpt: 'Acme manufactures precision sensors for automotive clients.',
      },
      userContext: null,
    })
    expect(out).toContain('Acme — Home')
    expect(out).toContain('precision sensors')
  })

  it('[priority 3] userSite block appends userContext Serper results when present', () => {
    const out = buildUserSiteBlock({
      companyText: '',
      companyObj: {},
      url: 'https://acme.com',
      userSite: {
        status: 'ok',
        title: 'Acme',
        excerpt: 'about us',
      },
      userContext: {
        query: '"Acme"',
        results: [
          { title: 'Acme press release', link: 'https://news.com/acme', snippet: 'Shipping to 40 countries' },
        ],
      },
    })
    expect(out).toContain('网络足迹')
    expect(out).toContain('Acme press release')
    expect(out).toContain('40 countries')
  })

  it('[priority 4] bare-url fallback when nothing else available', () => {
    const out = buildUserSiteBlock({
      companyText: '',
      companyObj: {},
      url: 'https://acme.com',
      userSite: { status: 'failed', error: 'fetch failed' },
      userContext: null,
    })
    expect(out).toContain('https://acme.com')
    expect(out).not.toContain(headerMarker) // compact bare-url, no full block
  })

  it('[priority 4] with no url at all — still produces a block, not empty', () => {
    const out = buildUserSiteBlock({
      companyText: '',
      companyObj: {},
      url: '',
      userSite: null,
      userContext: null,
    })
    expect(out).toBeTruthy()
    expect(out.length).toBeGreaterThan(0)
  })

  // Regression: the P3 bug was exactly that userSite.ok came FIRST, which
  // meant SN's companyText never made it into the prompt. Lock this in.
  it('[regression P3] userSite.ok must NOT shadow companyText', () => {
    const out = buildUserSiteBlock({
      companyText: 'SN-provided profile report text 2000 chars...',
      companyObj: {},
      url: 'https://x.com',
      userSite: {
        status: 'ok',
        title: 'Scraped Title',
        excerpt: 'scraped-excerpt-that-must-be-ignored',
      },
      userContext: { query: 'x', results: [{ title: 't', link: 'l', snippet: 's' }] },
    })
    expect(out).toContain('SN-provided profile report text')
    expect(out).not.toContain('scraped-excerpt-that-must-be-ignored')
    expect(out).not.toContain('Scraped Title')
  })
})
