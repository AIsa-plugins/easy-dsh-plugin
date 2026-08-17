import z from '@deepseek-ai/schemastery'

export const DEFAULT_AISA_BASE_URL = 'https://api.aisa.one'
export const ROUTING_MODES = ['aisa', 'byok', 'hybrid'] as const
export type RoutingMode = typeof ROUTING_MODES[number]
export const DEFAULT_ROUTING_MODE: RoutingMode = 'aisa'
export const DEFAULT_AISA_API_KEY_ENV = 'AISA_API_KEY'
export const DEFAULT_TAVILY_API_KEY_ENV = 'TAVILY_API_KEY'
export const DEFAULT_X_BEARER_TOKEN_ENV = 'X_BEARER_TOKEN'
export const DEFAULT_YOUTUBE_API_KEY_ENV = 'YOUTUBE_API_KEY'
export const DEFAULT_SERPAPI_API_KEY_ENV = 'SERPAPI_API_KEY'
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
export const MAX_REQUEST_TIMEOUT_MS = 120_000
export const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024
export const DEFAULT_MAX_RESULTS = 5
export const MAX_RESULTS = 10
export const DEFAULT_MAX_SNIPPET_CHARS = 1_200
export const DEFAULT_MAX_EXTRACT_CHARS = 100_000

export interface Config {
  readonly routingMode?: RoutingMode
  readonly aisaApiKeyEnv?: string
  readonly aisaBaseUrl?: string
  readonly tavilyApiKeyEnv?: string
  readonly xBearerTokenEnv?: string
  readonly youtubeApiKeyEnv?: string
  readonly serpApiKeyEnv?: string
  readonly requestTimeoutMs?: number
  readonly maxResponseBytes?: number
  readonly defaultMaxResults?: number
  readonly maxResults?: number
  readonly maxSnippetChars?: number
  readonly maxExtractChars?: number
}

export interface ResolvedConfig {
  readonly routingMode: RoutingMode
  readonly credentials: {
    readonly aisa: string
    readonly tavily: string
    readonly x: string
    readonly youtube: string
    readonly serpapi: string
  }
  readonly aisaBaseUrl: string
  readonly requestTimeoutMs: number
  readonly maxResponseBytes: number
  readonly defaultMaxResults: number
  readonly maxResults: number
  readonly maxSnippetChars: number
  readonly maxExtractChars: number
}

export const Config: z<Config> = z.object({
  routingMode: z.union(ROUTING_MODES).default(DEFAULT_ROUTING_MODE),
  aisaApiKeyEnv: z.string().role('credential-ref').default(DEFAULT_AISA_API_KEY_ENV),
  aisaBaseUrl: z.string().default(DEFAULT_AISA_BASE_URL),
  tavilyApiKeyEnv: z.string().role('credential-ref').default(DEFAULT_TAVILY_API_KEY_ENV),
  xBearerTokenEnv: z.string().role('credential-ref').default(DEFAULT_X_BEARER_TOKEN_ENV),
  youtubeApiKeyEnv: z.string().role('credential-ref').default(DEFAULT_YOUTUBE_API_KEY_ENV),
  serpApiKeyEnv: z.string().role('credential-ref').default(DEFAULT_SERPAPI_API_KEY_ENV),
  requestTimeoutMs: z.number().step(1).min(1).max(MAX_REQUEST_TIMEOUT_MS).default(DEFAULT_REQUEST_TIMEOUT_MS),
  maxResponseBytes: z.number().step(1).min(1).max(20 * 1024 * 1024).default(DEFAULT_MAX_RESPONSE_BYTES),
  defaultMaxResults: z.number().step(1).min(1).max(20).default(DEFAULT_MAX_RESULTS),
  maxResults: z.number().step(1).min(1).max(20).default(MAX_RESULTS),
  maxSnippetChars: z.number().step(1).min(100).max(10_000).default(DEFAULT_MAX_SNIPPET_CHARS),
  maxExtractChars: z.number().step(1).min(1_000).max(1_000_000).default(DEFAULT_MAX_EXTRACT_CHARS),
})

function integerBetween(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    const range = String(minimum) + ' and ' + String(maximum)
    throw new Error('easy-search: ' + name + ' must be an integer between ' + range)
  }
  return value
}

function origin(value: string): string {
  if (!URL.canParse(value)) throw new Error('easy-search: aisaBaseUrl must be an HTTP(S) origin')
  const url = new URL(value)
  const hasRootOnly = url.pathname === '/' && url.search === '' && url.hash === ''
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '' || !hasRootOnly) {
    throw new Error('easy-search: aisaBaseUrl must be an HTTP(S) origin without credentials, path, query, or fragment')
  }
  return url.origin
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const resolved: ResolvedConfig = {
    routingMode: config.routingMode ?? DEFAULT_ROUTING_MODE,
    credentials: {
      aisa: config.aisaApiKeyEnv ?? DEFAULT_AISA_API_KEY_ENV,
      tavily: config.tavilyApiKeyEnv ?? DEFAULT_TAVILY_API_KEY_ENV,
      x: config.xBearerTokenEnv ?? DEFAULT_X_BEARER_TOKEN_ENV,
      youtube: config.youtubeApiKeyEnv ?? DEFAULT_YOUTUBE_API_KEY_ENV,
      serpapi: config.serpApiKeyEnv ?? DEFAULT_SERPAPI_API_KEY_ENV,
    },
    aisaBaseUrl: origin(config.aisaBaseUrl ?? DEFAULT_AISA_BASE_URL),
    requestTimeoutMs: integerBetween(
      'requestTimeoutMs',
      config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      1,
      MAX_REQUEST_TIMEOUT_MS,
    ),
    maxResponseBytes: integerBetween(
      'maxResponseBytes',
      config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      1,
      20 * 1024 * 1024,
    ),
    defaultMaxResults: integerBetween(
      'defaultMaxResults',
      config.defaultMaxResults ?? DEFAULT_MAX_RESULTS,
      1,
      20,
    ),
    maxResults: integerBetween('maxResults', config.maxResults ?? MAX_RESULTS, 1, 20),
    maxSnippetChars: integerBetween(
      'maxSnippetChars',
      config.maxSnippetChars ?? DEFAULT_MAX_SNIPPET_CHARS,
      100,
      10_000,
    ),
    maxExtractChars: integerBetween(
      'maxExtractChars',
      config.maxExtractChars ?? DEFAULT_MAX_EXTRACT_CHARS,
      1_000,
      1_000_000,
    ),
  }
  for (const [provider, reference] of Object.entries(resolved.credentials)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference)) {
      throw new Error('easy-search: ' + provider + ' credential must be a POSIX environment-variable name')
    }
  }
  if (resolved.defaultMaxResults > resolved.maxResults) {
    throw new Error('easy-search: defaultMaxResults cannot exceed maxResults')
  }
  return resolved
}
