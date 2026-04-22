import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock every downstream of gatherIntel so the orchestrator's BRANCHING
// behavior is what gets tested — not any of the network side effects.

const fetchWebsiteMock = vi.fn()
const waybackMock = vi.fn()
const extractEntitiesMock = vi.fn()
const serpSearchMock = vi.fn()
const searchLinkedInMock = vi.fn()
const searchFacebookMock = vi.fn()
const searchPanjivaMock = vi.fn()
const searchNegativeMock = vi.fn()
const searchGeneralMock = vi.fn()
const searchPhoneMock = vi.fn()

vi.mock('@/lib/intel/fetchWebsite', () => ({
  fetchWebsite: (...a) => fetchWebsiteMock(...a),
}))
vi.mock('@/lib/intel/wayback', () => ({
  waybackFirstSnapshot: (...a) => waybackMock(...a),
}))
vi.mock('@/lib/intel/extract', () => ({
  extractEntities: (...a) => extractEntitiesMock(...a),
}))
vi.mock('@/lib/intel/serpapi', () => ({
  serpSearch: (...a) => serpSearchMock(...a),
}))
vi.mock('@/lib/intel/searches/linkedin', () => ({
  searchLinkedIn: (...a) => searchLinkedInMock(...a),
}))
vi.mock('@/lib/intel/searches/facebook', () => ({
  searchFacebook: (...a) => searchFacebookMock(...a),
}))
vi.mock('@/lib/intel/searches/panjiva', () => ({
  searchPanjiva: (...a) => searchPanjivaMock(...a),
}))
vi.mock('@/lib/intel/searches/negative', () => ({
  searchNegative: (...a) => searchNegativeMock(...a),
}))
vi.mock('@/lib/intel/searches/general', () => ({
  searchGeneral: (...a) => searchGeneralMock(...a),
}))
vi.mock('@/lib/intel/searches/phone', () => ({
  searchPhone: (...a) => searchPhoneMock(...a),
}))

import { gatherIntel } from '@/lib/intel'

function defaultMockSetup() {
  fetchWebsiteMock.mockResolvedValue({
    status: 'ok',
    source: 'direct_fetch',
    url: 'https://example.com',
    title: 'Example',
    excerpt: 'Example excerpt',
    siteName: null,
  })
  waybackMock.mockResolvedValue({ status: 'ok', firstSnapshot: '2015-01-01', ageYears: 10 })
  extractEntitiesMock.mockResolvedValue({
    status: 'ok',
    extracted: { companyName: 'Buyer Co', companyUrl: null, personName: null, email: null, phone: null, country: null, products: [] },
  })
  serpSearchMock.mockResolvedValue({ ok: true, query: 'x', results: [] })
  const okRes = { status: 'ok', query: 'x', found: false, topResults: [] }
  searchLinkedInMock.mockResolvedValue(okRes)
  searchFacebookMock.mockResolvedValue(okRes)
  searchPanjivaMock.mockResolvedValue({ status: 'ok', query: 'x', hasRecord: false, resultCount: 0, topResults: [] })
  searchNegativeMock.mockResolvedValue({ status: 'ok', query: 'x', hitCount: 0, hits: [] })
  searchGeneralMock.mockResolvedValue({ status: 'ok', query: 'x', topResults: [] })
  searchPhoneMock.mockResolvedValue({ status: 'skipped', error: '询盘未提及发件方电话' })
}

const baseArgs = {
  inquiry: 'Hello, we want to buy widgets.',
  images: [],
  apiKey: 'test-key',
  mainModel: 'test-model',
  globalSettings: {
    serpApiKey: 'serp-test-key',
    extractionModel: 'extract-model',
    extractionPrompt: 'extract prompt',
    baseUrl: 'https://llm.example',
  },
  onProgress: null,
}

describe('gatherIntel — userProfileText skip behavior (P5)', () => {
  beforeEach(() => {
    fetchWebsiteMock.mockReset()
    waybackMock.mockReset()
    extractEntitiesMock.mockReset()
    serpSearchMock.mockReset()
    searchLinkedInMock.mockReset()
    searchFacebookMock.mockReset()
    searchPanjivaMock.mockReset()
    searchNegativeMock.mockReset()
    searchGeneralMock.mockReset()
    searchPhoneMock.mockReset()
    defaultMockSetup()
  })

  it('when userProfileText is provided, does NOT fetch the user site', async () => {
    const intel = await gatherIntel({
      ...baseArgs,
      url: 'https://our-seller-site.com',
      userProfileText: '# Our Company\n\nWe make widgets.',
    })

    // userSite.fetchWebsite should NOT have been called with the user's URL.
    // (It may still be called with the TARGET URL from fanout if LLM extracted one.)
    const userSiteCall = fetchWebsiteMock.mock.calls.find(
      c => c[0] === 'https://our-seller-site.com'
    )
    expect(userSiteCall).toBeUndefined()

    expect(intel.userSite.status).toBe('skipped')
    expect(intel.userSite.error).toMatch(/userProfileText/i)
  })

  it('when userProfileText is provided, does NOT run the user-brand Serper search', async () => {
    await gatherIntel({
      ...baseArgs,
      url: 'https://our-seller-site.com',
      userProfileText: 'Our profile text — with enough characters to be non-trivial.',
    })

    expect(serpSearchMock).not.toHaveBeenCalled()
  })

  it('when userProfileText is provided, passes that text into extractEntities.websiteText (P3 alignment)', async () => {
    const profileText = 'Our curated company profile — rich self-description.'
    await gatherIntel({
      ...baseArgs,
      url: 'https://our-seller-site.com',
      userProfileText: profileText,
    })

    expect(extractEntitiesMock).toHaveBeenCalledTimes(1)
    const call = extractEntitiesMock.mock.calls[0][0]
    expect(call.websiteText).toBe(profileText)
  })

  it('legacy flow: when userProfileText is absent, DOES fetch the user site + userContext serp', async () => {
    await gatherIntel({
      ...baseArgs,
      url: 'https://our-seller-site.com',
      // userProfileText: undefined
    })

    const userSiteCall = fetchWebsiteMock.mock.calls.find(
      c => c[0] === 'https://our-seller-site.com'
    )
    expect(userSiteCall).toBeDefined()
    // fetchWebsite for user site should be called with enableSerpFallback=false
    expect(userSiteCall[1]).toMatchObject({ enableSerpFallback: false })

    // userContext Serper search should fire when the site fetch succeeds
    expect(serpSearchMock).toHaveBeenCalled()
  })

  it('empty-string userProfileText is treated as "not provided" (legacy flow kicks in)', async () => {
    await gatherIntel({
      ...baseArgs,
      url: 'https://our-seller-site.com',
      userProfileText: '',
    })

    const userSiteCall = fetchWebsiteMock.mock.calls.find(
      c => c[0] === 'https://our-seller-site.com'
    )
    expect(userSiteCall).toBeDefined()
  })

  it('whitespace-only userProfileText is treated as "not provided"', async () => {
    await gatherIntel({
      ...baseArgs,
      url: 'https://our-seller-site.com',
      userProfileText: '   \n  \t  ',
    })

    const userSiteCall = fetchWebsiteMock.mock.calls.find(
      c => c[0] === 'https://our-seller-site.com'
    )
    expect(userSiteCall).toBeDefined()
  })

  it('ownDomains is forwarded to extractEntities (P1 wiring)', async () => {
    await gatherIntel({
      ...baseArgs,
      url: 'https://our-seller-site.com',
      ownDomains: ['our-seller-site.com', 'our-seller-backup.net'],
      userProfileText: 'profile',
    })

    const call = extractEntitiesMock.mock.calls[0][0]
    expect(call.ownDomains).toEqual(['our-seller-site.com', 'our-seller-backup.net'])
  })

  it('target-site fetchWebsite is called with enableSerpFallback=true (P2 wiring)', async () => {
    // Make extractEntities return a target URL so fanout reaches fetchWebsite(target)
    extractEntitiesMock.mockResolvedValueOnce({
      status: 'ok',
      extracted: {
        companyName: 'Buyer Co',
        companyUrl: 'https://buyer.example',
        personName: null, email: null, phone: null, country: null, products: [],
      },
    })
    await gatherIntel({
      ...baseArgs,
      url: 'https://our-seller-site.com',
      userProfileText: 'profile',
    })

    const targetCall = fetchWebsiteMock.mock.calls.find(
      c => c[0] === 'https://buyer.example'
    )
    expect(targetCall).toBeDefined()
    expect(targetCall[1]).toMatchObject({ enableSerpFallback: true, serpKey: 'serp-test-key' })
  })
})
