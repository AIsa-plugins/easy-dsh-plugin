import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  type GenericCallView,
  type JsonValue,
  type ToolResult,
  type WebFetchResultView,
  type WebSearchResultView,
  type WebSource,
} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MAX_REQUEST_TIMEOUT_MS } from './config.ts'
import { EasySearchService } from './search.ts'
import type {
  EasyExtractResult,
  EasySearchResult,
  SearchResult,
} from './types.ts'

const SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string', required: true },
    coverage: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true, enum: ['web', 'x', 'youtube', 'scholar'] },
          status: { type: 'string', required: true, enum: ['ok', 'error'] },
          resultCount: { type: 'integer', required: true },
          requestId: { type: 'string' },
          error: { type: 'string' },
        },
      },
    },
    results: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true, enum: ['web', 'x', 'youtube', 'scholar'] },
          kind: { type: 'string', required: true, enum: ['page', 'post', 'video', 'channel', 'playlist'] },
          title: { type: 'string', required: true },
          url: { type: 'string', required: true },
          snippet: { type: 'string' },
          publishedAt: { type: 'string' },
          author: { type: 'string' },
          score: { type: 'number' },
          metrics: {
            type: 'object',
            additionalProperties: false,
            properties: {
              likes: { type: 'integer' },
              replies: { type: 'integer' },
              reposts: { type: 'integer' },
              quotes: { type: 'integer' },
              views: { type: 'integer' },
            },
          },
        },
      },
    },
    truncated: { type: 'boolean', required: true },
    answer: { type: 'string' },
  },
} as const

const EXTRACT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    documents: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          content: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
          title: { type: 'string' },
        },
      },
    },
    failures: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          error: { type: 'string', required: true },
        },
      },
    },
    requestId: { type: 'string' },
  },
} as const

function inline(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function label(value: string): string {
  return inline(value).replaceAll('[', '\\[').replaceAll(']', '\\]')
}

function resultLine(item: SearchResult, index: number): string {
  const metadata = [
    item.source.toUpperCase(),
    item.author,
    item.publishedAt,
  ].filter((value): value is string => value !== undefined)
  const suffix = metadata.length === 0 ? '' : ' - ' + metadata.join(' | ')
  const preview = item.snippet === undefined ? '' : '\n   ' + inline(item.snippet)
  return String(index + 1) + '. [' + label(item.title) + '](' + item.url + ')' + suffix + preview
}

export function formatSearchOutput(value: EasySearchResult): string {
  const parts: string[] = []
  if (value.answer !== undefined) parts.push(value.answer)
  if (value.results.length === 0) {
    parts.push('No results found.')
  } else {
    parts.push('Sources:\n' + value.results.map(resultLine).join('\n'))
  }
  const failures = value.coverage.filter(entry => entry.status === 'error')
  if (failures.length > 0) {
    parts.push('Unavailable sources:\n' + failures.map(entry =>
      '- ' + entry.source + ': ' + (entry.error ?? 'request failed')).join('\n'))
  }
  if (value.truncated) parts.push('Some sources returned more results than the configured limit.')
  parts.push('Cite the relevant URLs above as markdown links in your answer.')
  return parts.join('\n\n')
}

export function formatExtractOutput(value: EasyExtractResult): string {
  const parts = value.documents.map((document) => {
    const title = document.title ?? document.url
    const note = document.truncated ? '\n\n(Content truncated by the configured output limit.)' : ''
    return '## [' + label(title) + '](' + document.url + ')\n\n' + document.content + note
  })
  if (value.failures.length > 0) {
    parts.push('## Failed URLs\n\n' + value.failures.map(failure =>
      '- [' + label(failure.url) + '](' + failure.url + '): ' + failure.error).join('\n'))
  }
  return parts.length === 0 ? 'No content was extracted.' : parts.join('\n\n')
}

interface SearchPresentationMeta {
  readonly sources: WebSource[]
  readonly truncated: boolean
  readonly answer?: string
}

function searchMeta(value: EasySearchResult): JsonValue {
  return {
    sources: value.results.map(item => ({
      url: item.url,
      title: item.title,
      ...item.snippet === undefined ? {} : { snippet: item.snippet },
      ...item.publishedAt === undefined ? {} : { publishedAt: item.publishedAt },
    })),
    truncated: value.truncated,
    ...value.answer === undefined ? {} : { answer: value.answer },
  }
}

function webSource(value: unknown): value is WebSource {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const source = value as Record<string, unknown>
  return typeof source.url === 'string'
    && (source.title === undefined || typeof source.title === 'string')
    && (source.snippet === undefined || typeof source.snippet === 'string')
    && (source.publishedAt === undefined || typeof source.publishedAt === 'string')
}

function searchPresentation(value: unknown): SearchPresentationMeta | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const meta = value as Record<string, unknown>
  if (!Array.isArray(meta.sources) || !meta.sources.every(webSource)) return undefined
  if (typeof meta.truncated !== 'boolean') return undefined
  if (meta.answer !== undefined && typeof meta.answer !== 'string') return undefined
  return {
    sources: meta.sources,
    truncated: meta.truncated,
    ...meta.answer === undefined ? {} : { answer: meta.answer },
  }
}

export function presentSearchCall(args: { query: string }): GenericCallView {
  return { card: 'generic', kind: 'search', title: args.query, rawInput: args.query }
}

export function presentSearchResult(
  args: { query: string },
  result: ToolResult,
): WebSearchResultView | undefined {
  if (result.isError) return undefined
  const meta = searchPresentation(result.meta)
  if (meta === undefined) return undefined
  return {
    card: 'web',
    kind: 'search',
    title: args.query,
    sources: meta.sources,
    truncated: meta.truncated,
    ...meta.answer === undefined ? {} : { answer: meta.answer },
  }
}

function extractMeta(value: EasyExtractResult): JsonValue {
  const [document] = value.documents
  if (document === undefined || value.documents.length !== 1) return {}
  return { url: document.url, statusCode: 200, truncated: document.truncated }
}

function presentExtractResult(result: ToolResult): WebFetchResultView | undefined {
  if (result.isError || typeof result.meta !== 'object' || result.meta === null || Array.isArray(result.meta)) {
    return undefined
  }
  const meta = result.meta as Record<string, unknown>
  if (typeof meta.url !== 'string' || typeof meta.statusCode !== 'number' || typeof meta.truncated !== 'boolean') {
    return undefined
  }
  return {
    card: 'web',
    kind: 'fetch',
    title: meta.url,
    url: meta.url,
    statusCode: meta.statusCode,
    truncated: meta.truncated,
  }
}

export function createEasySearchTool(service: EasySearchService) {
  return defineTool({
    name: 'easy_search',
    description: 'Search one topic across selected AIsa sources in parallel. Choose only the sources relevant to the question. Returns citeable URLs and per-source coverage.',
    parameters: {
      query: { type: 'string', required: true, description: 'Focused search query.' },
      sources: {
        type: 'array',
        required: true,
        description: 'One or more sources: web, x, youtube, scholar.',
        items: { type: 'string', enum: ['web', 'x', 'youtube', 'scholar'] },
      },
      max_results: { type: 'integer', description: 'Maximum results retained from each source.' },
      web_depth: {
        type: 'string',
        enum: ['basic', 'advanced', 'fast', 'ultra-fast'],
        description: 'Tavily depth. Defaults to basic; advanced costs more.',
      },
      x_order: { type: 'string', enum: ['Latest', 'Top'], description: 'X ordering. Defaults to Latest.' },
      web_country: { type: 'string', description: 'Country name used to boost Tavily web results.' },
      youtube_region: { type: 'string', description: 'Two-letter YouTube region code, such as us or jp.' },
      youtube_language: { type: 'string', description: 'YouTube interface language, such as en or ja.' },
      year_from: { type: 'integer', description: 'Scholar lower publication-year bound.' },
      year_to: { type: 'integer', description: 'Scholar upper publication-year bound.' },
    },
    output: {
      schema: SEARCH_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatSearchOutput(value) }],
      presentationMeta: (_args, value) => searchMeta(value),
    },
    timeoutMs: MAX_REQUEST_TIMEOUT_MS,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const outcome = await service.search({
        query: args.query,
        sources: args.sources,
        ...args.max_results === undefined ? {} : { maxResults: args.max_results },
        ...args.web_depth === undefined ? {} : { webDepth: args.web_depth },
        ...args.x_order === undefined ? {} : { xOrder: args.x_order },
        ...args.web_country === undefined ? {} : { webCountry: args.web_country },
        ...args.youtube_region === undefined ? {} : { youtubeRegion: args.youtube_region },
        ...args.youtube_language === undefined ? {} : { youtubeLanguage: args.youtube_language },
        ...args.year_from === undefined ? {} : { yearFrom: args.year_from },
        ...args.year_to === undefined ? {} : { yearTo: args.year_to },
      }, exec.signal)
      return {
        query: outcome.query,
        coverage: [...outcome.coverage],
        results: [...outcome.results],
        truncated: outcome.truncated,
        ...outcome.answer === undefined ? {} : { answer: outcome.answer },
      }
    },
    presentCall: presentSearchCall,
    presentResult: (args, result) => presentSearchResult(args, result),
  })
}

export function createEasyExtractTool(service: EasySearchService) {
  return defineTool({
    name: 'easy_extract',
    description: 'Extract clean markdown from one to three known public HTTP(S) URLs through AIsa. Use after search when full page content is needed.',
    parameters: {
      urls: {
        type: 'array',
        required: true,
        description: 'One to three public HTTP(S) URLs.',
        items: { type: 'string' },
      },
      depth: {
        type: 'string',
        enum: ['basic', 'advanced'],
        description: 'Extraction depth. Defaults to basic; advanced costs more.',
      },
    },
    output: {
      schema: EXTRACT_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatExtractOutput(value) }],
      presentationMeta: (_args, value) => extractMeta(value),
    },
    timeoutMs: MAX_REQUEST_TIMEOUT_MS,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const outcome = await service.extract({
        urls: args.urls,
        ...args.depth === undefined ? {} : { depth: args.depth },
      }, exec.signal)
      return {
        documents: [...outcome.documents],
        failures: [...outcome.failures],
        ...outcome.requestId === undefined ? {} : { requestId: outcome.requestId },
      }
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'fetch',
      title: args.urls.length === 1 ? args.urls[0] ?? 'Extract page' : 'Extract ' + String(args.urls.length) + ' pages',
      rawInput: args.urls.join('\n'),
    }),
    presentResult: (_args, result) => presentExtractResult(result),
  })
}

export function registerEasySearchTools(ctx: Context, service: EasySearchService): void {
  ctx.systemPrompt.section({
    name: 'tool:easy-search',
    order: 112,
    text: 'Use easy_search for current, source-grounded research across the open web, X, YouTube, and Scholar. Select only relevant sources. Use easy_extract for full content only when snippets are insufficient. Cite relevant returned URLs as markdown links.',
  })
  ctx.tools.register(createEasySearchTool(service))
  ctx.tools.register(createEasyExtractTool(service))
}
