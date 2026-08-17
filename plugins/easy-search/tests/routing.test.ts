import { describe, expect, it } from 'vitest'
import { EasySearchProviderClient } from '../src/providers/router.ts'
import { ProviderHttpError } from '../src/providers/runtime.ts'
import type { EasySearchInput } from '../src/types.ts'
import { jsonResponse, TEST_CONFIG } from './helpers.ts'

const INPUT: EasySearchInput = {
  query: 'routing policy',
  sources: ['web', 'x'],
  maxResults: 3,
  webDepth: 'basic',
  xOrder: 'Latest',
}

function urlOf(input: URL | RequestInfo): URL {
  return new URL(input instanceof Request ? input.url : String(input))
}

describe('provider routing', () => {
  it('uses direct credentials when present and AIsa only when the direct credential is absent', async () => {
    const requests: URL[] = []
    const resolved: string[] = []
    const values: Record<string, string | undefined> = {
      TEST_TAVILY_API_KEY: 'tavily-secret',
      TEST_X_BEARER_TOKEN: undefined,
      TEST_AISA_API_KEY: 'aisa-secret',
    }
    const client = new EasySearchProviderClient({
      config: () => ({ ...TEST_CONFIG, routingMode: 'hybrid' }),
      resolveCredential: async (reference) => {
        resolved.push(reference)
        return values[reference]
      },
      fetchImpl: (async (input: URL | RequestInfo) => {
        const url = urlOf(input)
        requests.push(url)
        if (url.hostname === 'api.tavily.com') return jsonResponse({ results: [] })
        if (url.hostname === 'api.example.test') return jsonResponse({ tweets: [] })
        throw new Error('Unexpected routed URL: ' + url.href)
      }) as typeof fetch,
    })
    const operation = client.start()
    const signal = new AbortController().signal

    const web = await operation.search('web', INPUT, signal)
    const x = await operation.search('x', INPUT, signal)

    expect([web.provider, x.provider]).toEqual(['tavily', 'aisa'])
    expect(requests.map(url => url.hostname)).toEqual([
      'api.tavily.com',
      'api.example.test',
    ])
    expect(resolved).toEqual([
      'TEST_TAVILY_API_KEY',
      'TEST_X_BEARER_TOKEN',
      'TEST_AISA_API_KEY',
    ])
  })

  it('does not switch providers after a selected direct provider fails', async () => {
    const requests: URL[] = []
    const resolved: string[] = []
    const client = new EasySearchProviderClient({
      config: () => ({ ...TEST_CONFIG, routingMode: 'hybrid' }),
      resolveCredential: async (reference) => {
        resolved.push(reference)
        return reference === 'TEST_TAVILY_API_KEY' ? 'tavily-secret' : 'aisa-secret'
      },
      fetchImpl: (async (input: URL | RequestInfo) => {
        requests.push(urlOf(input))
        return jsonResponse({ error: 'unavailable' }, 503)
      }) as typeof fetch,
    })
    const operation = client.start()

    await expect(operation.search('web', INPUT, new AbortController().signal))
      .rejects.toEqual(expect.objectContaining<Partial<ProviderHttpError>>({
        provider: 'tavily',
        status: 503,
      }))
    expect(requests.map(url => url.hostname)).toEqual(['api.tavily.com'])
    expect(resolved).toEqual(['TEST_TAVILY_API_KEY'])
  })

  it('keeps byok mode strict when a provider credential is missing', async () => {
    let called = false
    const client = new EasySearchProviderClient({
      config: () => ({ ...TEST_CONFIG, routingMode: 'byok' }),
      resolveCredential: async () => undefined,
      fetchImpl: (async () => {
        called = true
        return jsonResponse({})
      }) as typeof fetch,
    })

    await expect(client.start().search('scholar', INPUT, new AbortController().signal))
      .rejects.toMatchObject({ provider: 'serpapi' })
    expect(called).toBe(false)
  })
})
