import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AISA_API_KEY_ENV,
  DEFAULT_AISA_BASE_URL,
  DEFAULT_MAX_RESULTS,
  DEFAULT_ROUTING_MODE,
  DEFAULT_SERPAPI_API_KEY_ENV,
  DEFAULT_TAVILY_API_KEY_ENV,
  DEFAULT_X_BEARER_TOKEN_ENV,
  DEFAULT_YOUTUBE_API_KEY_ENV,
  resolveConfig,
} from '../src/config.ts'

describe('resolveConfig', () => {
  it('resolves routing, credentials, and a canonical AIsa origin', () => {
    const defaults = resolveConfig()
    expect(defaults.routingMode).toBe(DEFAULT_ROUTING_MODE)
    expect(defaults.credentials).toEqual({
      aisa: DEFAULT_AISA_API_KEY_ENV,
      tavily: DEFAULT_TAVILY_API_KEY_ENV,
      x: DEFAULT_X_BEARER_TOKEN_ENV,
      youtube: DEFAULT_YOUTUBE_API_KEY_ENV,
      serpapi: DEFAULT_SERPAPI_API_KEY_ENV,
    })
    expect(defaults.aisaBaseUrl).toBe(DEFAULT_AISA_BASE_URL)
    expect(defaults.defaultMaxResults).toBe(DEFAULT_MAX_RESULTS)

    expect(resolveConfig({ aisaBaseUrl: 'https://example.com/' }).aisaBaseUrl)
      .toBe('https://example.com')
  })

  it('rejects base URLs that are not plain HTTP origins', () => {
    for (const value of [
      'ftp://example.com',
      'https://user:secret@example.com',
      'https://example.com/api',
      'https://example.com?debug=1',
    ]) {
      expect(() => resolveConfig({ aisaBaseUrl: value })).toThrow(/HTTP\(S\) origin/)
    }
  })

  it('keeps credential references and result limits internally consistent', () => {
    for (const config of [
      { aisaApiKeyEnv: 'not-valid-key' },
      { tavilyApiKeyEnv: 'not-valid-key' },
      { xBearerTokenEnv: 'not-valid-key' },
      { youtubeApiKeyEnv: 'not-valid-key' },
      { serpApiKeyEnv: 'not-valid-key' },
    ]) {
      expect(() => resolveConfig(config)).toThrow(/POSIX environment-variable/)
    }
    expect(() => resolveConfig({ defaultMaxResults: 6, maxResults: 5 }))
      .toThrow(/cannot exceed/)
  })

  it('enforces the same lower bounds exposed by the settings schema', () => {
    expect(() => resolveConfig({ maxSnippetChars: 99 })).toThrow()
    expect(() => resolveConfig({ maxExtractChars: 999 })).toThrow()
  })
})
