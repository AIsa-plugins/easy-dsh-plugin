import { describe, expect, it } from 'vitest'
import { AisaClient, readText } from '../src/client.ts'
import { jsonResponse, TEST_CONFIG } from './helpers.ts'

interface CapturedRequest {
  readonly url: URL
  readonly init: RequestInit
}

function urlOf(input: URL | RequestInfo): URL {
  return new URL(input instanceof Request ? input.url : String(input))
}

describe('AisaClient', () => {
  it('uses the current Scholar and YouTube HTTP contracts with one credential snapshot', async () => {
    const requests: CapturedRequest[] = []
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ url: urlOf(input), init: init ?? {} })
      return jsonResponse({ results: [] }, 200, { 'x-request-id': 'request-1' })
    }) as typeof fetch
    let credentialResolutions = 0
    const client = new AisaClient({
      config: () => TEST_CONFIG,
      resolveApiKey: async reference => {
        expect(reference).toBe('TEST_AISA_API_KEY')
        credentialResolutions += 1
        return 'top-secret'
      },
      fetchImpl,
    })

    const operation = await client.start()
    const signal = new AbortController().signal
    const scholar = await operation.searchScholar({
      query: 'agent systems',
      maxResults: 7,
      yearFrom: 2021,
      yearTo: 2026,
    }, signal)
    await operation.searchYouTube({
      query: 'agent systems',
      region: 'US',
      language: 'en',
    }, signal)

    expect(credentialResolutions).toBe(1)
    const [scholarRequest, youtubeRequest] = requests
    expect(scholarRequest?.url.pathname).toBe('/apis/v1/scholar/search/web')
    expect(scholarRequest?.url.searchParams.get('query')).toBe('agent systems')
    expect(scholarRequest?.url.searchParams.get('max_num_results')).toBe('7')
    expect(scholarRequest?.url.searchParams.get('as_ylo')).toBe('2021')
    expect(scholarRequest?.url.searchParams.get('as_yhi')).toBe('2026')
    expect(scholarRequest?.init.method).toBe('POST')
    expect(scholarRequest?.init.body).toBeUndefined()

    expect(youtubeRequest?.url.pathname).toBe('/apis/v1/youtube/search')
    expect(youtubeRequest?.url.searchParams.get('engine')).toBe('youtube')
    expect(youtubeRequest?.url.searchParams.get('q')).toBe('agent systems')
    expect(youtubeRequest?.url.searchParams.get('gl')).toBe('us')
    expect(youtubeRequest?.url.searchParams.get('hl')).toBe('en')
    expect(youtubeRequest?.init.method).toBe('GET')

    for (const request of requests) {
      expect(new Headers(request.init.headers).get('authorization'))
        .toBe('Bearer top-secret')
    }
    expect(JSON.stringify(scholar)).not.toContain('top-secret')
    expect(scholar.requestId).toBe('request-1')
  })

  it('requires a configured credential before sending traffic', async () => {
    let called = false
    const client = new AisaClient({
      config: () => TEST_CONFIG,
      resolveApiKey: async () => '   ',
      fetchImpl: (async () => {
        called = true
        return jsonResponse({})
      }) as typeof fetch,
    })

    await expect(client.start()).rejects.toThrow(/is not configured/)
    expect(called).toBe(false)
  })
})

describe('readText', () => {
  it('rejects oversized declared and streamed responses', async () => {
    const declared = new Response('12345', {
      headers: { 'content-length': '5' },
    })
    await expect(readText(declared, 4)).rejects.toThrow(/exceeded 4 bytes/)

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12345'))
        controller.close()
      },
    })
    await expect(readText(new Response(stream), 4))
      .rejects.toThrow(/exceeded 4 bytes/)
  })

  it('decodes a response within the byte budget', async () => {
    await expect(readText(new Response('hello'), 5)).resolves.toBe('hello')
  })
})
