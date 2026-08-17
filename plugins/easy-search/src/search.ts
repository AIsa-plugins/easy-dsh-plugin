import { isIP } from 'node:net'
import type { ResolvedConfig } from './config.ts'
import type { ProviderOperation } from './providers/contracts.ts'
import { EasySearchProviderClient } from './providers/router.ts'
import { providerFromError } from './providers/runtime.ts'
import {
  SEARCH_SOURCES,
  WEB_DEPTHS,
  X_ORDERS,
  type EasyExtractInput,
  type EasyExtractResult,
  type EasySearchInput,
  type EasySearchResult,
  type SearchSource,
  type SourceCoverage,
  type SourceSearchResult,
  type WebDepth,
  type XOrder,
} from './types.ts'

export interface SearchOptions {
  readonly query: string
  readonly sources: readonly SearchSource[]
  readonly maxResults?: number
  readonly webDepth?: WebDepth
  readonly xOrder?: XOrder
  readonly webCountry?: string
  readonly youtubeRegion?: string
  readonly youtubeLanguage?: string
  readonly yearFrom?: number
  readonly yearTo?: number
}

export interface ExtractOptions {
  readonly urls: readonly string[]
  readonly depth?: 'basic' | 'advanced'
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

function year(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value < 1900 || value > 2030) {
    throw new Error(name + ' must be an integer between 1900 and 2030')
  }
  return value
}

export function parseSearchOptions(options: SearchOptions, config: ResolvedConfig): EasySearchInput {
  const query = options.query.trim()
  if (query.length === 0) throw new Error('query must not be blank')
  const sources = [...new Set(options.sources)]
  if (sources.length === 0) throw new Error('select at least one search source')
  if (!sources.every(source => SEARCH_SOURCES.includes(source))) {
    throw new Error('sources contains an unsupported search source')
  }

  const maxResults = options.maxResults ?? config.defaultMaxResults
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > config.maxResults) {
    throw new Error('max_results must be an integer between 1 and ' + String(config.maxResults))
  }
  const webDepth = options.webDepth ?? 'basic'
  if (!WEB_DEPTHS.includes(webDepth)) throw new Error('web_depth is unsupported')
  const xOrder = options.xOrder ?? 'Latest'
  if (!X_ORDERS.includes(xOrder)) throw new Error('x_order is unsupported')
  const yearFrom = year('year_from', options.yearFrom)
  const yearTo = year('year_to', options.yearTo)
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) {
    throw new Error('year_from cannot be later than year_to')
  }

  const webCountry = optionalText(options.webCountry)
  const youtubeRegion = optionalText(options.youtubeRegion)
  const youtubeLanguage = optionalText(options.youtubeLanguage)
  return {
    query,
    sources,
    maxResults,
    webDepth,
    xOrder,
    ...webCountry === undefined ? {} : { webCountry },
    ...youtubeRegion === undefined ? {} : { youtubeRegion },
    ...youtubeLanguage === undefined ? {} : { youtubeLanguage },
    ...yearFrom === undefined ? {} : { yearFrom },
    ...yearTo === undefined ? {} : { yearTo },
  }
}

function ipv4Private(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  const first = parts[0] ?? 0
  const second = parts[1] ?? 0
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224
}

function mappedIpv4(address: string): string | undefined {
  const prefix = '::ffff:'
  if (!address.startsWith(prefix)) return undefined
  const suffix = address.slice(prefix.length)
  if (isIP(suffix) === 4) return suffix
  const words = suffix.split(':')
  if (words.length !== 2 || !words.every(word => /^[0-9a-f]{1,4}$/.test(word))) {
    return undefined
  }
  const high = Number.parseInt(words[0] ?? '', 16)
  const low = Number.parseInt(words[1] ?? '', 16)
  return [
    high >>> 8,
    high & 0xff,
    low >>> 8,
    low & 0xff,
  ].join('.')
}

function ipPrivate(hostname: string): boolean {
  const version = isIP(hostname)
  if (version === 4) return ipv4Private(hostname)
  if (version !== 6) return false
  const address = hostname.toLowerCase()
  if (address === '::' || address === '::1') return true
  if (address.startsWith('fc') || address.startsWith('fd')) return true
  if (/^fe[89ab]/.test(address) || address.startsWith('ff')) return true
  const mapped = mappedIpv4(address)
  return mapped !== undefined && ipv4Private(mapped)
}

export function publicUrl(raw: string): string {
  if (!URL.canParse(raw)) throw new Error('extract URLs must be valid HTTP(S) URLs')
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('extract URLs must use HTTP or HTTPS')
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('credential-bearing extract URLs are not allowed')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || ipPrivate(hostname)) {
    throw new Error('local or private-network extract URLs are not allowed')
  }
  return url.href
}

export function parseExtractOptions(options: ExtractOptions): EasyExtractInput {
  const urls = [...new Set(options.urls.map(publicUrl))]
  if (urls.length < 1 || urls.length > 3) {
    throw new Error('provide between one and three public URLs')
  }
  return { urls, depth: options.depth ?? 'basic' }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function successfulCoverage(result: SourceSearchResult): SourceCoverage {
  return {
    source: result.source,
    provider: result.provider,
    status: 'ok',
    resultCount: result.results.length,
    ...result.requestId === undefined ? {} : { requestId: result.requestId },
  }
}

function failedCoverage(source: SearchSource, reason: unknown): SourceCoverage {
  const provider = providerFromError(reason)
  return {
    source,
    ...provider === undefined ? {} : { provider },
    status: 'error',
    resultCount: 0,
    error: errorMessage(reason),
  }
}

export class EasySearchService {
  constructor(
    private readonly providers: EasySearchProviderClient,
    private readonly config: () => ResolvedConfig,
  ) {}

  async search(options: SearchOptions, signal: AbortSignal): Promise<EasySearchResult> {
    const config = this.config()
    const input = parseSearchOptions(options, config)
    const operation = this.providers.start()
    const settled = await Promise.allSettled(
      input.sources.map(source => this.searchSource(operation, source, input, signal)),
    )

    const coverage: SourceCoverage[] = []
    const results: EasySearchResult['results'][number][] = []
    let truncated = false
    let answer: string | undefined
    settled.forEach((outcome, index) => {
      const source = input.sources[index]
      if (source === undefined) return
      if (outcome.status === 'rejected') {
        coverage.push(failedCoverage(source, outcome.reason))
        return
      }
      coverage.push(successfulCoverage(outcome.value))
      results.push(...outcome.value.results)
      truncated ||= outcome.value.truncated
      answer ??= outcome.value.answer
    })

    return {
      query: input.query,
      coverage,
      results,
      truncated,
      ...answer === undefined ? {} : { answer },
    }
  }

  async extract(options: ExtractOptions, signal: AbortSignal): Promise<EasyExtractResult> {
    const input = parseExtractOptions(options)
    const operation = this.providers.start()
    return await operation.extract(input, signal)
  }

  private searchSource(
    operation: ProviderOperation,
    source: SearchSource,
    input: EasySearchInput,
    signal: AbortSignal,
  ): Promise<SourceSearchResult> {
    return operation.search(source, input, signal)
  }
}
