import { resolveConfig, type ResolvedConfig } from '../src/config.ts'

export const TEST_CONFIG: ResolvedConfig = resolveConfig({
  routingMode: 'aisa',
  aisaApiKeyEnv: 'TEST_AISA_API_KEY',
  aisaBaseUrl: 'https://api.example.test',
  tavilyApiKeyEnv: 'TEST_TAVILY_API_KEY',
  xBearerTokenEnv: 'TEST_X_BEARER_TOKEN',
  youtubeApiKeyEnv: 'TEST_YOUTUBE_API_KEY',
  serpApiKeyEnv: 'TEST_SERPAPI_API_KEY',
  requestTimeoutMs: 1_000,
  maxResponseBytes: 1_024,
  defaultMaxResults: 3,
  maxResults: 5,
  maxSnippetChars: 100,
  maxExtractChars: 1_000,
})

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  })
}
