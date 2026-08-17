import type { ResolvedConfig } from '../config.ts'
import { normalizeSerpApiScholar } from '../normalize.ts'
import type { EasySearchInput } from '../types.ts'
import type { SourceProvider } from './contracts.ts'
import { CredentialSnapshot, JsonHttpClient } from './runtime.ts'

const SERPAPI_BASE_URL = 'https://serpapi.com'

export function createSerpApiScholarProvider(
  config: ResolvedConfig,
  credentials: CredentialSnapshot,
  http: JsonHttpClient,
): SourceProvider {
  const reference = config.credentials.serpapi

  return {
    configured: () => credentials.configured(reference),
    async search(input: EasySearchInput, signal: AbortSignal) {
      const apiKey = await credentials.require('serpapi', reference)
      const query = new URLSearchParams({
        engine: 'google_scholar',
        q: input.query,
        num: String(input.maxResults),
        api_key: apiKey,
      })
      if (input.yearFrom !== undefined) query.set('as_ylo', String(input.yearFrom))
      if (input.yearTo !== undefined) query.set('as_yhi', String(input.yearTo))
      const response = await http.request(
        'serpapi',
        new URL('/search.json?' + query.toString(), SERPAPI_BASE_URL),
        { method: 'GET' },
        signal,
      )
      return normalizeSerpApiScholar(response, input.maxResults, config)
    },
  }
}
