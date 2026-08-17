import type { ResolvedConfig } from './config.ts'
import type {
  AisaResponse,
  ScholarSearchRequest,
  WebSearchRequest,
  XSearchRequest,
  YouTubeSearchRequest,
} from './types.ts'

const USER_AGENT = 'deepseek-harness/easy-search/0.1.0'

export class AisaHttpError extends Error {
  readonly status: number
  readonly requestId?: string

  constructor(status: number, requestId?: string) {
    super('AIsa request failed with HTTP status ' + String(status))
    this.name = 'AisaHttpError'
    this.status = status
    if (requestId !== undefined) this.requestId = requestId
  }
}

export interface AisaClientOptions {
  readonly config: () => ResolvedConfig
  readonly resolveApiKey: (reference: string) => Promise<string | undefined>
  readonly fetchImpl?: typeof fetch
}

export class AisaClient {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: AisaClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
  }

  async start(): Promise<AisaOperation> {
    const config = this.options.config()
    const apiKey = (await this.options.resolveApiKey(config.apiKeyEnv))?.trim()
    if (!apiKey) {
      throw new Error('AIsa credential ' + config.apiKeyEnv + ' is not configured')
    }
    return new AisaOperation(config, apiKey, this.fetchImpl)
  }
}

export class AisaOperation {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  searchWeb(request: WebSearchRequest, signal: AbortSignal): Promise<AisaResponse> {
    return this.request('/apis/v1/tavily/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: request.query,
        search_depth: request.searchDepth,
        max_results: request.maxResults,
        include_answer: true,
        include_raw_content: false,
        include_images: false,
        ...request.country === undefined ? {} : { country: request.country },
      }),
    }, signal)
  }

  searchX(request: XSearchRequest, signal: AbortSignal): Promise<AisaResponse> {
    const query = new URLSearchParams({
      query: request.query,
      queryType: request.order,
    })
    return this.request('/apis/v1/twitter/tweet/advanced_search?' + query.toString(), {
      method: 'GET',
    }, signal)
  }

  searchYouTube(request: YouTubeSearchRequest, signal: AbortSignal): Promise<AisaResponse> {
    const query = new URLSearchParams({ engine: 'youtube', q: request.query })
    if (request.region !== undefined) query.set('gl', request.region.toLowerCase())
    if (request.language !== undefined) query.set('hl', request.language)
    return this.request('/apis/v1/youtube/search?' + query.toString(), {
      method: 'GET',
    }, signal)
  }

  searchScholar(request: ScholarSearchRequest, signal: AbortSignal): Promise<AisaResponse> {
    const query = new URLSearchParams({
      query: request.query,
      max_num_results: String(request.maxResults),
    })
    if (request.yearFrom !== undefined) query.set('as_ylo', String(request.yearFrom))
    if (request.yearTo !== undefined) query.set('as_yhi', String(request.yearTo))
    return this.request('/apis/v1/scholar/search/web?' + query.toString(), {
      method: 'POST',
    }, signal)
  }

  extract(
    urls: readonly string[],
    depth: 'basic' | 'advanced',
    signal: AbortSignal,
  ): Promise<AisaResponse> {
    return this.request('/apis/v1/tavily/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls,
        extract_depth: depth,
        include_images: false,
        format: 'markdown',
      }),
    }, signal)
  }

  private async request(path: string, init: RequestInit, parentSignal: AbortSignal): Promise<AisaResponse> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    headers.set('Authorization', 'Bearer ' + this.apiKey)
    headers.set('User-Agent', USER_AGENT)
    const signal = AbortSignal.any([
      parentSignal,
      AbortSignal.timeout(this.config.requestTimeoutMs),
    ])
    const response = await this.fetchImpl(new URL(path, this.config.baseUrl), {
      ...init,
      headers,
      signal,
    })
    const requestId = response.headers.get('x-request-id') ?? undefined
    const text = await readText(response, this.config.maxResponseBytes)
    if (!response.ok) throw new AisaHttpError(response.status, requestId)
    if (text.length === 0) throw new Error('AIsa returned an empty response')
    const data: unknown = JSON.parse(text)
    return {
      data,
      ...requestId === undefined ? {} : { requestId },
    }
  }
}

export async function readText(response: Response, maxBytes: number): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > maxBytes) {
    throw new Error('AIsa response exceeded ' + String(maxBytes) + ' bytes')
  }
  if (response.body === null) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    total += chunk.value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('AIsa response exceeded ' + String(maxBytes) + ' bytes')
    }
    chunks.push(chunk.value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}
