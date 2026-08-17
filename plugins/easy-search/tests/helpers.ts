import { resolveConfig, type ResolvedConfig } from '../src/config.ts'

export const TEST_CONFIG: ResolvedConfig = resolveConfig({
  apiKeyEnv: 'TEST_AISA_API_KEY',
  baseUrl: 'https://api.example.test',
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
