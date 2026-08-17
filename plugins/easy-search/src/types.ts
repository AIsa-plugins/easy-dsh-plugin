export const SEARCH_SOURCES = ['web', 'x', 'youtube', 'scholar'] as const
export type SearchSource = typeof SEARCH_SOURCES[number]

export const WEB_DEPTHS = ['basic', 'advanced', 'fast', 'ultra-fast'] as const
export type WebDepth = typeof WEB_DEPTHS[number]

export const X_ORDERS = ['Latest', 'Top'] as const
export type XOrder = typeof X_ORDERS[number]

export interface EasySearchInput {
  readonly query: string
  readonly sources: readonly SearchSource[]
  readonly maxResults: number
  readonly webDepth: WebDepth
  readonly xOrder: XOrder
  readonly webCountry?: string
  readonly youtubeRegion?: string
  readonly youtubeLanguage?: string
  readonly yearFrom?: number
  readonly yearTo?: number
}

export type SearchResultKind = 'page' | 'post' | 'video' | 'channel' | 'playlist'

export interface SearchMetrics {
  readonly likes?: number
  readonly replies?: number
  readonly reposts?: number
  readonly quotes?: number
  readonly views?: number
}

export interface SearchResult {
  readonly source: SearchSource
  readonly kind: SearchResultKind
  readonly title: string
  readonly url: string
  readonly snippet?: string
  readonly publishedAt?: string
  readonly author?: string
  readonly score?: number
  readonly metrics?: SearchMetrics
}

export interface SourceCoverage {
  readonly source: SearchSource
  readonly status: 'ok' | 'error'
  readonly resultCount: number
  readonly requestId?: string
  readonly error?: string
}

export interface EasySearchResult {
  readonly query: string
  readonly coverage: readonly SourceCoverage[]
  readonly results: readonly SearchResult[]
  readonly truncated: boolean
  readonly answer?: string
}

export interface SourceSearchResult {
  readonly source: SearchSource
  readonly results: readonly SearchResult[]
  readonly truncated: boolean
  readonly requestId?: string
  readonly answer?: string
}

export interface EasyExtractInput {
  readonly urls: readonly string[]
  readonly depth: 'basic' | 'advanced'
}

export interface ExtractedDocument {
  readonly url: string
  readonly content: string
  readonly truncated: boolean
  readonly title?: string
}

export interface ExtractionFailure {
  readonly url: string
  readonly error: string
}

export interface EasyExtractResult {
  readonly documents: readonly ExtractedDocument[]
  readonly failures: readonly ExtractionFailure[]
  readonly requestId?: string
}

export interface AisaResponse {
  readonly data: unknown
  readonly requestId?: string
}

export interface WebSearchRequest {
  readonly query: string
  readonly searchDepth: WebDepth
  readonly maxResults: number
  readonly country?: string
}

export interface XSearchRequest {
  readonly query: string
  readonly order: XOrder
}

export interface YouTubeSearchRequest {
  readonly query: string
  readonly region?: string
  readonly language?: string
}

export interface ScholarSearchRequest {
  readonly query: string
  readonly maxResults: number
  readonly yearFrom?: number
  readonly yearTo?: number
}
