import type { ResolvedConfig } from '../config.ts'
import { normalizeYouTubeApi } from '../normalize.ts'
import type { EasySearchInput } from '../types.ts'
import type { SourceProvider } from './contracts.ts'
import { CredentialSnapshot, JsonHttpClient } from './runtime.ts'

const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com'

export function createYouTubeProvider(
  config: ResolvedConfig,
  credentials: CredentialSnapshot,
  http: JsonHttpClient,
): SourceProvider {
  const reference = config.credentials.youtube

  return {
    configured: () => credentials.configured(reference),
    async search(input: EasySearchInput, signal: AbortSignal) {
      const apiKey = await credentials.require('youtube', reference)
      const query = new URLSearchParams({
        part: 'snippet',
        q: input.query,
        maxResults: String(input.maxResults),
        type: 'video,channel,playlist',
        key: apiKey,
      })
      if (input.youtubeRegion !== undefined) {
        query.set('regionCode', input.youtubeRegion.toUpperCase())
      }
      if (input.youtubeLanguage !== undefined) {
        query.set('relevanceLanguage', input.youtubeLanguage)
      }
      const response = await http.request(
        'youtube',
        new URL('/youtube/v3/search?' + query.toString(), YOUTUBE_API_BASE_URL),
        { method: 'GET' },
        signal,
      )
      return normalizeYouTubeApi(response, input.maxResults, config)
    },
  }
}
