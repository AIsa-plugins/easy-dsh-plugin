import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/config.d.ts
interface Config {
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly defaultMaxResults?: number;
  readonly maxResults?: number;
  readonly maxSnippetChars?: number;
  readonly maxExtractChars?: number;
}
interface ResolvedConfig {
  readonly apiKeyEnv: string;
  readonly baseUrl: string;
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
  readonly documents: readonly ExtractedDocument[];
  readonly failures: readonly ExtractionFailure[];
  readonly requestId?: string;
}
interface AisaResponse {
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
//#region src/client.d.ts
interface AisaClientOptions {
  readonly config: () => ResolvedConfig;
  readonly resolveApiKey: (reference: string) => Promise<string | undefined>;
  readonly fetchImpl?: typeof fetch;
}
declare class AisaClient {
  private readonly options;
  private readonly fetchImpl;
  constructor(options: AisaClientOptions);
  start(): Promise<AisaOperation>;
}
declare class AisaOperation {
  private readonly config;
  private readonly apiKey;
  private readonly fetchImpl;
  constructor(config: ResolvedConfig, apiKey: string, fetchImpl: typeof fetch);
  searchWeb(request: WebSearchRequest, signal: AbortSignal): Promise<AisaResponse>;
  searchX(request: XSearchRequest, signal: AbortSignal): Promise<AisaResponse>;
  searchYouTube(request: YouTubeSearchRequest, signal: AbortSignal): Promise<AisaResponse>;
  searchScholar(request: ScholarSearchRequest, signal: AbortSignal): Promise<AisaResponse>;
  extract(urls: readonly string[], depth: 'basic' | 'advanced', signal: AbortSignal): Promise<AisaResponse>;
  private request;
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
  private readonly client;
  private readonly config;
  constructor(client: AisaClient, config: () => ResolvedConfig);
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
export { AisaResponse, Config, type Config as EasySearchConfig, EASY_SEARCH_SETTINGS_NAMESPACE, EasyExtractInput, EasyExtractResult, EasySearchInput, EasySearchResult, EasySearchService, ExtractedDocument, ExtractionFailure, type ResolvedConfig, SEARCH_SOURCES, ScholarSearchRequest, SearchMetrics, SearchResult, SearchResultKind, SearchSource, SourceCoverage, SourceSearchResult, WEB_DEPTHS, WebDepth, WebSearchRequest, XOrder, XSearchRequest, X_ORDERS, YouTubeSearchRequest, apply, inject, name, parseExtractOptions, parseSearchOptions, publicUrl };
//# sourceMappingURL=index.d.ts.map