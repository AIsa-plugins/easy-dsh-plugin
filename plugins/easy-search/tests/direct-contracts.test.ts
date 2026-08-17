import { describe, expect, it } from 'vitest'
import { EasySearchProviderClient } from '../src/providers/router.ts'
import type { EasySearchInput } from '../src/types.ts'
import { jsonResponse, TEST_CONFIG } from './helpers.ts'

interface CapturedRequest {
  readonly url: URL
  readonly init: RequestInit
}

const INPUT: EasySearchInput = {
  query: 'agent systems',
  sources: ['web', 'x', 'youtube', 'scholar'],
  maxResults: 3,
  webDepth: 'advanced',
  xOrder: 'Top',
  webCountry: 'Japan',
  youtubeRegion: 'jp',
  youtubeLanguage: 'ja',
  yearFrom: 2020,
  yearTo: 2026,
}

function urlOf(input: URL | RequestInfo): URL {
  return new URL(input instanceof Request ? input.url : String(input))
}

function bodyOf(request: CapturedRequest): Record<string, unknown> {
  return JSON.parse(String(request.init.body)) as Record<string, unknown>
}

function directResponse(url: URL): Response {
  if (url.hostname === 'api.tavily.com' && url.pathname === '/search') {
    return jsonResponse({ results: [] })
  }
  if (url.hostname === 'api.tavily.com' && url.pathname === '/extract') {
    return jsonResponse({ results: [], failed_results: [] })
  }
  if (url.hostname === 'api.x.com') {
    return jsonResponse({ data: [], includes: { users: [] }, meta: {} })
  }
  if (url.hostname === 'www.googleapis.com') {
    return jsonResponse({ items: [] })
  }
  if (url.hostname === 'serpapi.com') {
    return jsonResponse({ organic_results: [] })
  }
  throw new Error('Unexpected direct-provider URL: ' + url.href)
}

describe('direct provider HTTP contracts', () => {
  it('encodes each official API contract and snapshots credentials per operation', async () => {
    const requests: CapturedRequest[] = []
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const request = { url: urlOf(input), init: init ?? {} }
      requests.push(request)
      return directResponse(request.url)
    }) as typeof fetch
    const secrets: Record<string, string> = {
      TEST_TAVILY_API_KEY: 'tavily-secret',
      TEST_X_BEARER_TOKEN: 'x-secret',
      TEST_YOUTUBE_API_KEY: 'youtube-secret',
      TEST_SERPAPI_API_KEY: 'serpapi-secret',
    }
    const resolutions = new Map<string, number>()
    const client = new EasySearchProviderClient({
      config: () => ({ ...TEST_CONFIG, routingMode: 'byok' }),
      resolveCredential: async (reference) => {
        resolutions.set(reference, (resolutions.get(reference) ?? 0) + 1)
        return secrets[reference]
      },
      fetchImpl,
    })
    const operation = client.start()
    const signal = new AbortController().signal

    const web = await operation.search('web', INPUT, signal)
    const x = await operation.search('x', INPUT, signal)
    const youtube = await operation.search('youtube', INPUT, signal)
    const scholar = await operation.search('scholar', INPUT, signal)
    const extract = await operation.extract({
      urls: ['https://example.com/page'],
      depth: 'advanced',
    }, signal)

    expect([web.provider, x.provider, youtube.provider, scholar.provider, extract.provider])
      .toEqual(['tavily', 'x', 'youtube', 'serpapi', 'tavily'])
    expect(Object.fromEntries(resolutions)).toEqual({
      TEST_TAVILY_API_KEY: 1,
      TEST_X_BEARER_TOKEN: 1,
      TEST_YOUTUBE_API_KEY: 1,
      TEST_SERPAPI_API_KEY: 1,
    })

    const [webRequest, xRequest, youtubeRequest, scholarRequest, extractRequest] = requests
    expect(webRequest?.url.href).toBe('https://api.tavily.com/search')
    expect(webRequest?.init.method).toBe('POST')
    expect(new Headers(webRequest?.init.headers).get('authorization'))
      .toBe('Bearer tavily-secret')
    expect(bodyOf(webRequest as CapturedRequest)).toMatchObject({
      query: 'agent systems',
      search_depth: 'advanced',
      max_results: 3,
      country: 'Japan',
      include_answer: true,
    })

    expect(xRequest?.url.pathname).toBe('/2/tweets/search/recent')
    expect(xRequest?.url.searchParams.get('max_results')).toBe('10')
    expect(xRequest?.url.searchParams.get('sort_order')).toBe('relevancy')
    expect(xRequest?.url.searchParams.get('post.fields')).toBe('created_at,public_metrics')
    expect(xRequest?.url.searchParams.get('expansions')).toBe('author_id')
    expect(xRequest?.url.searchParams.get('user.fields')).toBe('name,username')
    expect(new Headers(xRequest?.init.headers).get('authorization')).toBe('Bearer x-secret')

    expect(youtubeRequest?.url.pathname).toBe('/youtube/v3/search')
    expect(youtubeRequest?.url.searchParams.get('part')).toBe('snippet')
    expect(youtubeRequest?.url.searchParams.get('maxResults')).toBe('3')
    expect(youtubeRequest?.url.searchParams.get('type')).toBe('video,channel,playlist')
    expect(youtubeRequest?.url.searchParams.get('regionCode')).toBe('JP')
    expect(youtubeRequest?.url.searchParams.get('relevanceLanguage')).toBe('ja')
    expect(youtubeRequest?.url.searchParams.get('key')).toBe('youtube-secret')

    expect(scholarRequest?.url.pathname).toBe('/search.json')
    expect(scholarRequest?.url.searchParams.get('engine')).toBe('google_scholar')
    expect(scholarRequest?.url.searchParams.get('num')).toBe('3')
    expect(scholarRequest?.url.searchParams.get('as_ylo')).toBe('2020')
    expect(scholarRequest?.url.searchParams.get('as_yhi')).toBe('2026')
    expect(scholarRequest?.url.searchParams.get('api_key')).toBe('serpapi-secret')

    expect(extractRequest?.url.href).toBe('https://api.tavily.com/extract')
    expect(bodyOf(extractRequest as CapturedRequest)).toEqual({
      urls: ['https://example.com/page'],
      extract_depth: 'advanced',
      include_images: false,
      format: 'markdown',
    })

    for (const request of requests) {
      expect(new Headers(request.init.headers).get('user-agent'))
        .toBe('deepseek-harness/easy-search/0.2.0')
    }
    expect(JSON.stringify(requests)).not.toContain('TEST_')
  })
})
