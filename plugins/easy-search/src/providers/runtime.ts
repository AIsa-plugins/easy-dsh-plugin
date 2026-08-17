import type { ResolvedConfig } from '../config.ts'
import { PROVIDER_IDS, type ProviderId, type ProviderResponse } from '../types.ts'

export type CredentialResolver = (reference: string) => Promise<string | undefined>

export class ProviderCredentialError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly reference: string,
  ) {
    super(provider + ' credential ' + reference + ' is not configured')
    this.name = 'ProviderCredentialError'
  }
}

export class ProviderHttpError extends Error {
  readonly requestId?: string

  constructor(
    readonly provider: ProviderId,
    readonly status: number,
    requestId?: string,
  ) {
    super(provider + ' request failed with HTTP status ' + String(status))
    this.name = 'ProviderHttpError'
    if (requestId !== undefined) this.requestId = requestId
  }
}

export class ProviderDataError extends Error {
  constructor(
    readonly provider: ProviderId,
    message: string,
  ) {
    super(provider + ' returned ' + message)
    this.name = 'ProviderDataError'
  }
}

export function providerFromError(reason: unknown): ProviderId | undefined {
  if (typeof reason !== 'object' || reason === null || !('provider' in reason)) return undefined
  const provider = (reason as { provider?: unknown }).provider
  return typeof provider === 'string' && PROVIDER_IDS.includes(provider as ProviderId)
    ? provider as ProviderId
    : undefined
}

export class CredentialSnapshot {
  private readonly values = new Map<string, Promise<string | undefined>>()

  constructor(private readonly resolveCredential: CredentialResolver) {}

  resolve(reference: string): Promise<string | undefined> {
    const existing = this.values.get(reference)
    if (existing !== undefined) return existing
    const pending = this.resolveCredential(reference).then((value) => {
      const trimmed = value?.trim()
      return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
    })
    this.values.set(reference, pending)
    return pending
  }

  async configured(reference: string): Promise<boolean> {
    return await this.resolve(reference) !== undefined
  }

  async require(provider: ProviderId, reference: string): Promise<string> {
    const value = await this.resolve(reference)
    if (value === undefined) throw new ProviderCredentialError(provider, reference)
    return value
  }
}

const USER_AGENT = 'deepseek-harness/easy-search/0.2.0'

export class JsonHttpClient {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async request(
    provider: ProviderId,
    url: URL,
    init: RequestInit,
    parentSignal: AbortSignal,
  ): Promise<ProviderResponse> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    headers.set('User-Agent', USER_AGENT)
    const signal = AbortSignal.any([
      parentSignal,
      AbortSignal.timeout(this.config.requestTimeoutMs),
    ])
    const response = await this.fetchImpl(url, { ...init, headers, signal })
    const requestId = response.headers.get('x-request-id') ?? undefined
    const text = await readText(response, this.config.maxResponseBytes, provider)
    if (!response.ok) throw new ProviderHttpError(provider, response.status, requestId)
    if (text.length === 0) throw new ProviderDataError(provider, 'an empty response')
    const data: unknown = JSON.parse(text)
    return {
      data,
      ...requestId === undefined ? {} : { requestId },
    }
  }
}

export async function readText(
  response: Response,
  maxBytes: number,
  provider: ProviderId = 'aisa',
): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > maxBytes) {
    throw new ProviderDataError(provider, 'a response larger than ' + String(maxBytes) + ' bytes')
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
      throw new ProviderDataError(provider, 'a response larger than ' + String(maxBytes) + ' bytes')
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
