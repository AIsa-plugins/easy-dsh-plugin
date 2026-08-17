import type { RoutingMode } from '../config.ts'
import type {
  EasyExtractInput,
  EasyExtractResult,
  EasySearchInput,
  SearchSource,
  SourceSearchResult,
} from '../types.ts'

export interface SourceProvider {
  configured(): Promise<boolean>
  search(input: EasySearchInput, signal: AbortSignal): Promise<SourceSearchResult>
}

export interface ExtractProvider {
  configured(): Promise<boolean>
  extract(input: EasyExtractInput, signal: AbortSignal): Promise<EasyExtractResult>
}

export interface ProviderSet {
  readonly web: SourceProvider
  readonly x: SourceProvider
  readonly youtube: SourceProvider
  readonly scholar: SourceProvider
  readonly extract: ExtractProvider
}

export interface ProviderOperation {
  search(
    source: SearchSource,
    input: EasySearchInput,
    signal: AbortSignal,
  ): Promise<SourceSearchResult>
  extract(input: EasyExtractInput, signal: AbortSignal): Promise<EasyExtractResult>
}

export interface ProviderRoutes {
  readonly mode: RoutingMode
  readonly aisa: ProviderSet
  readonly direct: ProviderSet
}
