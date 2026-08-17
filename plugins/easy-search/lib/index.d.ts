import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/config.d.ts
declare const ROUTING_MODES: readonly ["aisa", "byok", "hybrid"];
type RoutingMode = typeof ROUTING_MODES[number];
interface Config {
  readonly routingMode?: RoutingMode;
  readonly aisaApiKeyEnv?: string;
  readonly aisaBaseUrl?: string;
  readonly tavilyApiKeyEnv?: string;
  readonly xBearerTokenEnv?: string;
  readonly youtubeApiKeyEnv?: string;
  readonly serpApiKeyEnv?: string;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly defaultMaxResults?: number;
  readonly maxResults?: number;
  readonly maxSnippetChars?: number;
  readonly maxExtractChars?: number;
}
interface ResolvedConfig {
  readonly routingMode: RoutingMode;
  readonly credentials: {
    readonly aisa: string;
    readonly tavily: string;
    readonly x: string;
    readonly youtube: string;
    readonly serpapi: string;
  };
  readonly aisaBaseUrl: string;
  readonly requestTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly defaultMaxResults: number;
  readonly maxResults: number;
  readonly maxSnippetChars: number;
  readonly maxExtractChars: number;
}
declare const Config: z<Config>;
//#endregion
//#region src/types.d.ts
declare const PROVIDER_IDS: readonly ["aisa", "tavily", "x", "youtube", "serpapi"];
type ProviderId = typeof PROVIDER_IDS[number];
type ExtractProviderId = Extract<ProviderId, 'aisa' | 'tavily'>;
declare const SEARCH_SOURCES: readonly ["web", "x", "youtube", "scholar"];
type SearchSource = typeof SEARCH_SOURCES[number];
declare const WEB_DEPTHS: readonly ["basic", "advanced", "fast", "ultra-fast"];
type WebDepth = typeof WEB_DEPTHS[number];
declare const X_ORDERS: readonly ["Latest", "Top"];
type XOrder = typeof X_ORDERS[number];
interface EasySearchInput {
  readonly query: string;
  readonly sources: readonly SearchSource[];
  readonly maxResults: number;
  readonly webDepth: WebDepth;
  readonly xOrder: XOrder;
  readonly webCountry?: string;
  readonly youtubeRegion?: string;
  readonly youtubeLanguage?: string;
  readonly yearFrom?: number;
  readonly yearTo?: number;
}
type SearchResultKind = 'page' | 'post' | 'video' | 'channel' | 'playlist';
interface SearchMetrics {
  readonly likes?: number;
  readonly replies?: number;
  readonly reposts?: number;
  readonly quotes?: number;
  readonly views?: number;
}
interface SearchResult {
  readonly source: SearchSource;
  readonly kind: SearchResultKind;
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
  readonly publishedAt?: string;
  readonly author?: string;
  readonly score?: number;
  readonly metrics?: SearchMetrics;
}
interface SourceCoverage {
  readonly source: SearchSource;
  readonly provider?: ProviderId;
  readonly status: 'ok' | 'error';
  readonly resultCount: number;
  readonly requestId?: string;
  readonly error?: string;
}
interface EasySearchResult {
  readonly query: string;
  readonly coverage: readonly SourceCoverage[];
  readonly results: readonly SearchResult[];
  readonly truncated: boolean;
  readonly answer?: string;
}
interface SourceSearchResult {
  readonly source: SearchSource;
  readonly provider: ProviderId;
  readonly results: readonly SearchResult[];
  readonly truncated: boolean;
  readonly requestId?: string;
  readonly answer?: string;
}
interface EasyExtractInput {
  readonly urls: readonly string[];
  readonly depth: 'basic' | 'advanced';
}
interface ExtractedDocument {
  readonly url: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly title?: string;
}
interface ExtractionFailure {
  readonly url: string;
  readonly error: string;
}
interface EasyExtractResult {
  readonly provider: ExtractProviderId;
  readonly documents: readonly ExtractedDocument[];
  readonly failures: readonly ExtractionFailure[];
  readonly requestId?: string;
}
interface ProviderResponse {
  readonly data: unknown;
  readonly requestId?: string;
}
interface WebSearchRequest {
  readonly query: string;
  readonly searchDepth: WebDepth;
  readonly maxResults: number;
  readonly country?: string;
}
interface XSearchRequest {
  readonly query: string;
  readonly order: XOrder;
}
interface YouTubeSearchRequest {
  readonly query: string;
  readonly region?: string;
  readonly language?: string;
}
interface ScholarSearchRequest {
  readonly query: string;
  readonly maxResults: number;
  readonly yearFrom?: number;
  readonly yearTo?: number;
}
//#endregion
//#region src/providers/contracts.d.ts
interface ProviderOperation {
  search(source: SearchSource, input: EasySearchInput, signal: AbortSignal): Promise<SourceSearchResult>;
  extract(input: EasyExtractInput, signal: AbortSignal): Promise<EasyExtractResult>;
}
//#endregion
//#region src/providers/runtime.d.ts
type CredentialResolver = (reference: string) => Promise<string | undefined>;
//#endregion
//#region src/providers/router.d.ts
interface EasySearchProviderClientOptions {
  readonly config: () => ResolvedConfig;
  readonly resolveCredential: CredentialResolver;
  readonly fetchImpl?: typeof fetch;
}
declare class EasySearchProviderClient {
  private readonly options;
  constructor(options: EasySearchProviderClientOptions);
  start(): ProviderOperation;
}
//#endregion
//#region src/search.d.ts
interface SearchOptions {
  readonly query: string;
  readonly sources: readonly SearchSource[];
  readonly maxResults?: number;
  readonly webDepth?: WebDepth;
  readonly xOrder?: XOrder;
  readonly webCountry?: string;
  readonly youtubeRegion?: string;
  readonly youtubeLanguage?: string;
  readonly yearFrom?: number;
  readonly yearTo?: number;
}
interface ExtractOptions {
  readonly urls: readonly string[];
  readonly depth?: 'basic' | 'advanced';
}
declare function parseSearchOptions(options: SearchOptions, config: ResolvedConfig): EasySearchInput;
declare function publicUrl(raw: string): string;
declare function parseExtractOptions(options: ExtractOptions): EasyExtractInput;
declare class EasySearchService {
  private readonly providers;
  private readonly config;
  constructor(providers: EasySearchProviderClient, config: () => ResolvedConfig);
  search(options: SearchOptions, signal: AbortSignal): Promise<EasySearchResult>;
  extract(options: ExtractOptions, signal: AbortSignal): Promise<EasyExtractResult>;
  private searchSource;
}
//#endregion
//#region src/index.d.ts
declare const name = "easy-search";
declare const inject: string[];
declare const EASY_SEARCH_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { Config, type Config as EasySearchConfig, EASY_SEARCH_SETTINGS_NAMESPACE, EasyExtractInput, EasyExtractResult, EasySearchInput, EasySearchResult, EasySearchService, ExtractProviderId, ExtractedDocument, ExtractionFailure, PROVIDER_IDS, ProviderId, ProviderResponse, type ResolvedConfig, SEARCH_SOURCES, ScholarSearchRequest, SearchMetrics, SearchResult, SearchResultKind, SearchSource, SourceCoverage, SourceSearchResult, WEB_DEPTHS, WebDepth, WebSearchRequest, XOrder, XSearchRequest, X_ORDERS, YouTubeSearchRequest, apply, inject, name, parseExtractOptions, parseSearchOptions, publicUrl };
//# sourceMappingURL=index.d.ts.map