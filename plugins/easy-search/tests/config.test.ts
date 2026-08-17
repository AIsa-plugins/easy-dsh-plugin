import { describe, expect, it } from 'vitest'
import {
  DEFAULT_API_KEY_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RESULTS,
  resolveConfig,
} from '../src/config.ts'

describe('resolveConfig', () => {
  it('resolves defaults and canonicalizes an origin', () => {
    const defaults = resolveConfig()
    expect(defaults.apiKeyEnv).toBe(DEFAULT_API_KEY_ENV)
    expect(defaults.baseUrl).toBe(DEFAULT_BASE_URL)
    expect(defaults.defaultMaxResults).toBe(DEFAULT_MAX_RESULTS)

    expect(resolveConfig({ baseUrl: 'https://example.com/' }).baseUrl)
      .toBe('https://example.com')
  })

  it('rejects base URLs that are not plain HTTP origins', () => {
    for (const value of [
      'ftp://example.com',
      'https://user:secret@example.com',
      'https://example.com/api',
      'https://example.com?debug=1',
    ]) {
      expect(() => resolveConfig({ baseUrl: value })).toThrow(/HTTP\(S\) origin/)
    }
  })

  it('keeps credential references and result limits internally consistent', () => {
    expect(() => resolveConfig({ apiKeyEnv: 'not-valid-key' }))
      .toThrow(/POSIX environment-variable/)
    expect(() => resolveConfig({ defaultMaxResults: 6, maxResults: 5 }))
      .toThrow(/cannot exceed/)
  })

  it('enforces the same lower bounds exposed by the settings schema', () => {
    expect(() => resolveConfig({ maxSnippetChars: 99 })).toThrow()
    expect(() => resolveConfig({ maxExtractChars: 999 })).toThrow()
  })
})
