import { describe, it, expect } from 'vitest'
import { buildLinkedInQuery } from '@/lib/intel/searches/linkedin'
import { buildFacebookQuery } from '@/lib/intel/searches/facebook'

describe('buildLinkedInQuery', () => {
  it('uses person + company when both are present', () => {
    const q = buildLinkedInQuery({ personName: 'John Smith', companyName: 'ABC Ltd' })
    expect(q).toBe('site:linkedin.com/in "John Smith" "ABC Ltd"')
  })

  it('falls back to person only', () => {
    const q = buildLinkedInQuery({ personName: 'Jane Doe', companyName: null })
    expect(q).toBe('site:linkedin.com/in "Jane Doe"')
  })

  it('falls back to company only (no /in path)', () => {
    const q = buildLinkedInQuery({ personName: null, companyName: 'ABC Ltd' })
    expect(q).toBe('site:linkedin.com/company "ABC Ltd"')
  })

  it('returns null when nothing to search', () => {
    expect(buildLinkedInQuery({ personName: null, companyName: null })).toBeNull()
  })
})

describe('buildFacebookQuery', () => {
  it('prefers company name', () => {
    expect(buildFacebookQuery({ companyName: 'ABC Ltd', personName: 'x' }))
      .toBe('site:facebook.com "ABC Ltd"')
  })
  it('falls back to person name', () => {
    expect(buildFacebookQuery({ companyName: null, personName: 'Jane Doe' }))
      .toBe('site:facebook.com "Jane Doe"')
  })
  it('returns null with neither', () => {
    expect(buildFacebookQuery({})).toBeNull()
  })
})
