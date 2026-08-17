import type { ResolvedConfig } from '../config.ts'
import { normalizeXApi } from '../normalize.ts'
import type { EasySearchInput } from '../types.ts'
import type { SourceProvider } from './contracts.ts'
import { CredentialSnapshot, JsonHttpClient } from './runtime.ts'

const X_API_BASE_URL = 'https://api.x.com'

export function createXProvider(
  config: ResolvedConfig,
  credentials: CredentialSnapshot,
  http: JsonHttpClient,
): SourceProvider {
  const reference = config.credentials.x

  return {
    configured: () => credentials.configured(reference),
    async search(input: EasySearchInput, signal: AbortSignal) {
      const bearerToken = await credentials.require('x', reference)
      const query = new URLSearchParams({
        query: input.query,
        max_results: String(Math.max(10, input.maxResults)),
        sort_order: input.xOrder === 'Top' ? 'relevancy' : 'recency',
        'post.fields': 'created_at,public_metrics',
        expansions: 'author_id',
        'user.fields': 'name,username',
      })
      const response = await http.request(
        'x',
        new URL('/2/tweets/search/recent?' + query.toString(), X_API_BASE_URL),
        {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + bearerToken },
        },
        signal,
      )
      return normalizeXApi(response, input.maxResults, config)
    },
  }
}
