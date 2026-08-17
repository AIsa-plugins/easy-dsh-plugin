import type { ResolvedConfig } from '../config.ts'
import { normalizeTavilyExtract, normalizeTavilySearch } from '../normalize.ts'
import type { EasyExtractInput, EasySearchInput, ProviderResponse } from '../types.ts'
import type { ExtractProvider, SourceProvider } from './contracts.ts'
import { CredentialSnapshot, JsonHttpClient } from './runtime.ts'

const TAVILY_BASE_URL = 'https://api.tavily.com'

class TavilyTransport {
  private readonly reference: string

  constructor(
    config: ResolvedConfig,
    private readonly credentials: CredentialSnapshot,
    private readonly http: JsonHttpClient,
  ) {
    this.reference = config.credentials.tavily
  }

  configured(): Promise<boolean> {
    return this.credentials.configured(this.reference)
  }

  async request(
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<ProviderResponse> {
    const apiKey = await this.credentials.require('tavily', this.reference)
    return await this.http.request('tavily', new URL(path, TAVILY_BASE_URL), {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, signal)
  }
}

export interface TavilyProviders {
  readonly web: SourceProvider
  readonly extract: ExtractProvider
}

export function createTavilyProviders(
  config: ResolvedConfig,
  credentials: CredentialSnapshot,
  http: JsonHttpClient,
): TavilyProviders {
  const transport = new TavilyTransport(config, credentials, http)
  const configured = () => transport.configured()

  return {
    web: {
      configured,
      async search(input: EasySearchInput, signal: AbortSignal) {
        const response = await transport.request('/search', {
          query: input.query,
          search_depth: input.webDepth,
          max_results: input.maxResults,
          include_answer: true,
          include_raw_content: false,
          include_images: false,
          ...input.webCountry === undefined ? {} : { country: input.webCountry },
        }, signal)
        return normalizeTavilySearch('tavily', response, input.maxResults, config)
      },
    },
    extract: {
      configured,
      async extract(input: EasyExtractInput, signal: AbortSignal) {
        const response = await transport.request('/extract', {
          urls: input.urls,
          extract_depth: input.depth,
          include_images: false,
          format: 'markdown',
        }, signal)
        return normalizeTavilyExtract('tavily', response, config)
      },
    },
  }
}
