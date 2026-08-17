import { describe, expect, it } from 'vitest'
import { AisaClient } from '../src/client.ts'
import {
  EasySearchService,
  parseExtractOptions,
  parseSearchOptions,
  publicUrl,
} from '../src/search.ts'
import { jsonResponse, TEST_CONFIG } from './helpers.ts'

describe('search input boundaries', () => {
  it('normalizes options and removes duplicate sources', () => {
    expect(parseSearchOptions({
      query: '  distributed agents  ',
      sources: ['web', 'web', 'scholar'],
      maxResults: 2,
      yearFrom: 2020,
      yearTo: 2026,
    }, TEST_CONFIG)).toEqual({
      query: 'distributed agents',
      sources: ['web', 'scholar'],
      maxResults: 2,
      webDepth: 'basic',
      xOrder: 'Latest',
      yearFrom: 2020,
      yearTo: 2026,
    })

    expect(() => parseSearchOptions({
      query: ' ',
      sources: ['web'],
    }, TEST_CONFIG)).toThrow(/must not be blank/)
    expect(() => parseSearchOptions({
      query: 'topic',
      sources: ['scholar'],
      yearFrom: 2026,
      yearTo: 2025,
    }, TEST_CONFIG)).toThrow(/cannot be later/)
  })

  it('accepts only public credential-free HTTP URLs for extraction', () => {
    expect(publicUrl('https://example.com/page?q=1'))
      .toBe('https://example.com/page?q=1')

    for (const value of [
      'ftp://example.com/file',
      'https://user:secret@example.com/',
      'http://localhost/admin',
      'http://api.local/status',
      'http://127.0.0.1/',
      'http://10.0.0.1/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[::ffff:127.0.0.1]/',
    ]) {
      expect(() => publicUrl(value), value).toThrow()
    }
  })

  it('deduplicates extraction URLs before enforcing the three-URL limit', () => {
    expect(parseExtractOptions({
      urls: ['https://example.com', 'https://example.com/'],
      depth: 'advanced',
    })).toEqual({
      urls: ['https://example.com/'],
      depth: 'advanced',
    })
    expect(() => parseExtractOptions({
      urls: [
        'https://one.example',
        'https://two.example',
        'https://three.example',
        'https://four.example',
      ],
    })).toThrow(/between one and three/)
  })
})

describe('EasySearchService', () => {
  it('retains successful sources when a sibling source fails', async () => {
    let credentialResolutions = 0
    const fetchImpl = (async (input: URL | RequestInfo) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/apis/v1/tavily/search') {
        return jsonResponse({
          request_id: 'web-id',
          answer: 'Web answer',
          results: [{
            title: 'Working result',
            url: 'https://example.com/result',
            content: 'Available content',
            score: 0.8,
          }],
        })
      }
      if (url.pathname === '/apis/v1/twitter/tweet/advanced_search') {
        return jsonResponse({ error: 'temporarily unavailable' }, 503, {
          'x-request-id': 'x-id',
        })
      }
      throw new Error('Unexpected test URL: ' + url.href)
    }) as typeof fetch
    const client = new AisaClient({
      config: () => TEST_CONFIG,
      resolveApiKey: async () => {
        credentialResolutions += 1
        return 'test-key'
      },
      fetchImpl,
    })
    const service = new EasySearchService(client, () => TEST_CONFIG)

    const result = await service.search({
      query: 'current topic',
      sources: ['x', 'web'],
      maxResults: 2,
    }, new AbortController().signal)

    expect(credentialResolutions).toBe(1)
    expect(result.answer).toBe('Web answer')
    expect(result.results).toEqual([{
      source: 'web',
      kind: 'page',
      title: 'Working result',
      url: 'https://example.com/result',
      snippet: 'Available content',
      score: 0.8,
    }])
    expect(result.coverage).toEqual([
      {
        source: 'x',
        status: 'error',
        resultCount: 0,
        error: 'AIsa request failed with HTTP status 503',
      },
      {
        source: 'web',
        status: 'ok',
        resultCount: 1,
        requestId: 'web-id',
      },
    ])
  })
})
