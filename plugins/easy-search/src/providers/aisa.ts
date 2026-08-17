import type { ResolvedConfig } from '../config.ts'
import {
  normalizeAisaScholar,
  normalizeAisaX,
  normalizeAisaYouTube,
  normalizeTavilyExtract,
  normalizeTavilySearch,
} from '../normalize.ts'
import type { EasyExtractInput, EasySearchInput, ProviderResponse } from '../types.ts'
import type { ProviderSet } from './contracts.ts'
import { CredentialSnapshot, JsonHttpClient } from './runtime.ts'

class AisaTransport {
  private readonly reference: string

  constructor(
    private readonly config: ResolvedConfig,
    private readonly credentials: CredentialSnapshot,
    private readonly http: JsonHttpClient,
  ) {
    this.reference = config.credentials.aisa
  }

  configured(): Promise<boolean> {
    return this.credentials.configured(this.reference)
  }

  async request(
    path: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<ProviderResponse> {
    const apiKey = await this.credentials.require('aisa', this.reference)
    const headers = new Headers(init.headers)
    headers.set('Authorization', 'Bearer ' + apiKey)
    return await this.http.request(
      'aisa',
      new URL(path, this.config.aisaBaseUrl),
      { ...init, headers },
      signal,
    )
  }
}

export function createAisaProviderSet(
  config: ResolvedConfig,
  credentials: CredentialSnapshot,
  http: JsonHttpClient,
): ProviderSet {
  const transport = new AisaTransport(config, credentials, http)
  const configured = () => transport.configured()

  return {
    web: {
      configured,
      async search(input: EasySearchInput, signal: AbortSignal) {
        const response = await transport.request('/apis/v1/tavily/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: input.query,
            search_depth: input.webDepth,
            max_results: input.maxResults,
            include_answer: true,
            include_raw_content: false,
            include_images: false,
            ...input.webCountry === undefined ? {} : { country: input.webCountry },
          }),
        }, signal)
        return normalizeTavilySearch('aisa', response, input.maxResults, config)
      },
    },
    x: {
      configured,
      async search(input: EasySearchInput, signal: AbortSignal) {
        const query = new URLSearchParams({
          query: input.query,
          queryType: input.xOrder,
        })
        const response = await transport.request(
          '/apis/v1/twitter/tweet/advanced_search?' + query.toString(),
          { method: 'GET' },
          signal,
        )
        return normalizeAisaX(response, input.maxResults, config)
      },
    },
    youtube: {
      configured,
      async search(input: EasySearchInput, signal: AbortSignal) {
        const query = new URLSearchParams({ engine: 'youtube', q: input.query })
        if (input.youtubeRegion !== undefined) query.set('gl', input.youtubeRegion.toLowerCase())
        if (input.youtubeLanguage !== undefined) query.set('hl', input.youtubeLanguage)
        const response = await transport.request(
          '/apis/v1/youtube/search?' + query.toString(),
          { method: 'GET' },
          signal,
        )
        return normalizeAisaYouTube(response, input.maxResults, config)
      },
    },
    scholar: {
      configured,
      async search(input: EasySearchInput, signal: AbortSignal) {
        const query = new URLSearchParams({
          max_num_results: String(input.maxResults),
        })
        if (input.yearFrom !== undefined) query.set('as_ylo', String(input.yearFrom))
        if (input.yearTo !== undefined) query.set('as_yhi', String(input.yearTo))
        const response = await transport.request(
          '/apis/v1/scholar/search/web?' + query.toString(),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ query: input.query }).toString(),
          },
          signal,
        )
        return normalizeAisaScholar(response, input.maxResults, config)
      },
    },
    extract: {
      configured,
      async extract(input: EasyExtractInput, signal: AbortSignal) {
        const response = await transport.request('/apis/v1/tavily/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: input.urls,
            extract_depth: input.depth,
            include_images: false,
            format: 'markdown',
          }),
        }, signal)
        return normalizeTavilyExtract('aisa', response, config)
      },
    },
  }
}
