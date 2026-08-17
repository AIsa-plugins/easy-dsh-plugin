import type { ResolvedConfig } from './config.ts'
import type {
  ProviderResponse,
  ProviderId,
  ExtractProviderId,
  EasyExtractResult,
  ExtractedDocument,
  SearchMetrics,
  SearchResult,
  SourceSearchResult,
} from './types.ts'

type JsonObject = Record<string, unknown>

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Upstream returned an invalid ' + label)
  }
  return value as JsonObject
}

function optionalObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error('Upstream returned an invalid ' + label)
  return value
}

function optionalArray(value: unknown, label: string): unknown[] {
  return value === undefined ? [] : array(value, label)
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function requiredString(value: unknown, label: string): string {
  const parsed = string(value)
  if (parsed === undefined) throw new Error('Upstream returned an invalid ' + label)
  return parsed
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function requestId(body: string | undefined, response: ProviderResponse): string | undefined {
  return body ?? response.requestId
}

function snippet(value: unknown, maximum: number): string | undefined {
  const parsed = string(value)
  if (parsed === undefined) return undefined
  return parsed.length <= maximum ? parsed : parsed.slice(0, maximum) + '...'
}

function result(
  source: SearchResult['source'],
  kind: SearchResult['kind'],
  title: string,
  url: string,
  fields: Omit<SearchResult, 'source' | 'kind' | 'title' | 'url'>,
): SearchResult {
  return { source, kind, title, url, ...fields }
}

export function normalizeTavilySearch(
  provider: ProviderId,
  response: ProviderResponse,
  maxResults: number,
  config: ResolvedConfig,
): SourceSearchResult {
  const root = object(response.data, 'Tavily search response')
  const raw = array(root.results, 'Tavily results')
  const results = raw.slice(0, maxResults).map((value, index) => {
    const item = object(value, 'Tavily result #' + String(index + 1))
    const content = snippet(item.content, config.maxSnippetChars)
    const score = number(item.score)
    return result(
      'web',
      'page',
      requiredString(item.title, 'Tavily result title'),
      requiredString(item.url, 'Tavily result URL'),
      {
        ...content === undefined ? {} : { snippet: content },
        ...score === undefined ? {} : { score },
      },
    )
  })
  const answer = string(root.answer)
  const id = requestId(string(root.request_id), response)
  return {
    provider,
    source: 'web',
    results,
    truncated: raw.length > maxResults,
    ...id === undefined ? {} : { requestId: id },
    ...answer === undefined ? {} : { answer },
  }
}

function xMetrics(item: JsonObject): SearchMetrics | undefined {
  const likes = integer(item.likeCount)
  const replies = integer(item.replyCount)
  const reposts = integer(item.retweetCount)
  const quotes = integer(item.quoteCount)
  const views = integer(item.viewCount)
  const metrics: SearchMetrics = {
    ...likes === undefined ? {} : { likes },
    ...replies === undefined ? {} : { replies },
    ...reposts === undefined ? {} : { reposts },
    ...quotes === undefined ? {} : { quotes },
    ...views === undefined ? {} : { views },
  }
  return Object.keys(metrics).length === 0 ? undefined : metrics
}

function xAuthor(value: unknown): string | undefined {
  const author = optionalObject(value)
  if (author === undefined) return undefined
  const name = string(author.name)
  const username = string(author.userName)
  if (name !== undefined && username !== undefined) return name + ' (@' + username + ')'
  return name ?? (username === undefined ? undefined : '@' + username)
}

export function normalizeAisaX(
  response: ProviderResponse,
  maxResults: number,
  config: ResolvedConfig,
): SourceSearchResult {
  const root = object(response.data, 'X search response')
  const raw = array(root.tweets, 'X tweets')
  const results = raw.slice(0, maxResults).map((value, index) => {
    const item = object(value, 'X post #' + String(index + 1))
    const author = xAuthor(item.author)
    const metrics = xMetrics(item)
    const text = snippet(item.text, config.maxSnippetChars)
    const publishedAt = string(item.createdAt)
    return result(
      'x',
      'post',
      author ?? 'X post',
      requiredString(item.url, 'X post URL'),
      {
        ...text === undefined ? {} : { snippet: text },
        ...publishedAt === undefined ? {} : { publishedAt },
        ...author === undefined ? {} : { author },
        ...metrics === undefined ? {} : { metrics },
      },
    )
  })
  return {
    provider: 'aisa',
    source: 'x',
    results,
    truncated: root.has_next_page === true || raw.length > maxResults,
    ...response.requestId === undefined ? {} : { requestId: response.requestId },
  }
}

interface PositionedResult {
  readonly position: number
  readonly result: SearchResult
}

function youtubeAuthor(value: unknown): string | undefined {
  return string(optionalObject(value)?.name)
}

function youtubeVideo(value: unknown, index: number, config: ResolvedConfig): PositionedResult {
  const item = object(value, 'YouTube video #' + String(index + 1))
  const views = integer(item.views)
  const author = youtubeAuthor(item.channel)
  const description = snippet(item.description, config.maxSnippetChars)
  const publishedAt = string(item.published_time)
  return {
    position: integer(item.position) ?? Number.MAX_SAFE_INTEGER,
    result: result(
      'youtube',
      'video',
      requiredString(item.title, 'YouTube video title'),
      requiredString(item.link, 'YouTube video URL'),
      {
        ...description === undefined ? {} : { snippet: description },
        ...publishedAt === undefined ? {} : { publishedAt },
        ...author === undefined ? {} : { author },
        ...views === undefined ? {} : { metrics: { views } },
      },
    ),
  }
}

function youtubeCollection(
  value: unknown,
  index: number,
  kind: 'channel' | 'playlist',
  config: ResolvedConfig,
): PositionedResult {
  const item = object(value, 'YouTube ' + kind + ' #' + String(index + 1))
  const description = snippet(item.description, config.maxSnippetChars)
  return {
    position: integer(item.position) ?? Number.MAX_SAFE_INTEGER,
    result: result(
      'youtube',
      kind,
      requiredString(item.title, 'YouTube ' + kind + ' title'),
      requiredString(item.link, 'YouTube ' + kind + ' URL'),
      {
        ...description === undefined ? {} : { snippet: description },
      },
    ),
  }
}

export function normalizeAisaYouTube(
  response: ProviderResponse,
  maxResults: number,
  config: ResolvedConfig,
): SourceSearchResult {
  const root = object(response.data, 'YouTube search response')
  const videos = optionalArray(root.videos, 'YouTube videos').map((value, index) =>
    youtubeVideo(value, index, config))
  const channels = optionalArray(root.channels, 'YouTube channels').map((value, index) =>
    youtubeCollection(value, index, 'channel', config))
  const playlists = optionalArray(root.playlists, 'YouTube playlists').map((value, index) =>
    youtubeCollection(value, index, 'playlist', config))
  const ranked = [...videos, ...channels, ...playlists].sort((left, right) => left.position - right.position)
  const metadata = optionalObject(root.search_metadata)
  const pagination = optionalObject(root.pagination)
  const id = requestId(string(metadata?.id), response)
  return {
    provider: 'aisa',
    source: 'youtube',
    results: ranked.slice(0, maxResults).map(entry => entry.result),
    truncated: ranked.length > maxResults || string(pagination?.next_page_token) !== undefined,
    ...id === undefined ? {} : { requestId: id },
  }
}

export function normalizeAisaScholar(
  response: ProviderResponse,
  maxResults: number,
  config: ResolvedConfig,
): SourceSearchResult {
  const root = object(response.data, 'Scholar search response')
  const raw = array(root.results, 'Scholar results')
  const results = raw.slice(0, maxResults).map((value, index) => {
    const item = object(value, 'Scholar result #' + String(index + 1))
    const summary = snippet(item.snippet, config.maxSnippetChars)
    const publishedAt = string(item.published_date)
    return result(
      'scholar',
      'page',
      requiredString(item.title, 'Scholar result title'),
      requiredString(item.link, 'Scholar result URL'),
      {
        ...summary === undefined ? {} : { snippet: summary },
        ...publishedAt === undefined ? {} : { publishedAt },
      },
    )
  })
  const id = requestId(string(root.id), response)
  return {
    provider: 'aisa',
    source: 'scholar',
    results,
    truncated: raw.length > maxResults,
    ...id === undefined ? {} : { requestId: id },
  }
}

function extractedDocument(value: unknown, index: number, config: ResolvedConfig): ExtractedDocument {
  const item = object(value, 'Tavily extract result #' + String(index + 1))
  const content = requiredString(item.raw_content, 'Tavily extracted content')
  const truncated = content.length > config.maxExtractChars
  const title = string(item.title)
  return {
    url: requiredString(item.url, 'Tavily extracted URL'),
    content: truncated ? content.slice(0, config.maxExtractChars) : content,
    truncated,
    ...title === undefined ? {} : { title },
  }
}

export function normalizeTavilyExtract(
  provider: ExtractProviderId,
  response: ProviderResponse,
  config: ResolvedConfig,
): EasyExtractResult {
  const root = object(response.data, 'Tavily extract response')
  const documents = array(root.results, 'Tavily extract results').map((value, index) =>
    extractedDocument(value, index, config))
  const failures = array(root.failed_results, 'Tavily failed results').map((value, index) => ({
    url: requiredString(value, 'Tavily failed URL #' + String(index + 1)),
    error: provider + ' could not extract this URL',
  }))
  const id = requestId(string(root.request_id), response)
  return {
    provider,
    documents,
    failures,
    ...id === undefined ? {} : { requestId: id },
  }
}

function xApiMetrics(value: unknown): SearchMetrics | undefined {
  const raw = optionalObject(value)
  if (raw === undefined) return undefined
  const likes = integer(raw.like_count)
  const replies = integer(raw.reply_count)
  const reposts = integer(raw.retweet_count)
  const quotes = integer(raw.quote_count)
  const views = integer(raw.impression_count)
  const metrics: SearchMetrics = {
    ...likes === undefined ? {} : { likes },
    ...replies === undefined ? {} : { replies },
    ...reposts === undefined ? {} : { reposts },
    ...quotes === undefined ? {} : { quotes },
    ...views === undefined ? {} : { views },
  }
  return Object.keys(metrics).length === 0 ? undefined : metrics
}

function xApiAuthor(user: JsonObject | undefined): string | undefined {
  if (user === undefined) return undefined
  const name = string(user.name)
  const username = string(user.username)
  if (name !== undefined && username !== undefined) return name + ' (@' + username + ')'
  return name ?? (username === undefined ? undefined : '@' + username)
}

function xPostUrl(id: string, user: JsonObject | undefined): string {
  const username = string(user?.username)
  const owner = username === undefined ? 'i/web' : encodeURIComponent(username)
  return 'https://x.com/' + owner + '/status/' + encodeURIComponent(id)
}

export function normalizeXApi(
  response: ProviderResponse,
  maxResults: number,
  config: ResolvedConfig,
): SourceSearchResult {
  const root = object(response.data, 'X API search response')
  const raw = optionalArray(root.data, 'X API posts')
  const includes = optionalObject(root.includes)
  const users = new Map<string, JsonObject>(
    optionalArray(includes?.users, 'X API users').map((value, index) => {
      const user = object(value, 'X API user #' + String(index + 1))
      return [requiredString(user.id, 'X API user id'), user]
    }),
  )
  const results = raw.slice(0, maxResults).map((value, index) => {
    const item = object(value, 'X API post #' + String(index + 1))
    const id = requiredString(item.id, 'X API post id')
    const user = users.get(requiredString(item.author_id, 'X API author id'))
    const author = xApiAuthor(user)
    const text = snippet(item.text, config.maxSnippetChars)
    const publishedAt = string(item.created_at)
    const metrics = xApiMetrics(item.public_metrics)
    return result('x', 'post', author ?? 'X post', xPostUrl(id, user), {
      ...text === undefined ? {} : { snippet: text },
      ...publishedAt === undefined ? {} : { publishedAt },
      ...author === undefined ? {} : { author },
      ...metrics === undefined ? {} : { metrics },
    })
  })
  const meta = optionalObject(root.meta)
  return {
    provider: 'x',
    source: 'x',
    results,
    truncated: raw.length > maxResults || string(meta?.next_token) !== undefined,
    ...response.requestId === undefined ? {} : { requestId: response.requestId },
  }
}

function youtubeApiUrl(id: JsonObject): { kind: SearchResult['kind']; url: string } {
  const kind = requiredString(id.kind, 'YouTube API result kind')
  if (kind === 'youtube#video') {
    return {
      kind: 'video',
      url: 'https://www.youtube.com/watch?v='
        + encodeURIComponent(requiredString(id.videoId, 'YouTube video id')),
    }
  }
  if (kind === 'youtube#channel') {
    return {
      kind: 'channel',
      url: 'https://www.youtube.com/channel/'
        + encodeURIComponent(requiredString(id.channelId, 'YouTube channel id')),
    }
  }
  if (kind === 'youtube#playlist') {
    return {
      kind: 'playlist',
      url: 'https://www.youtube.com/playlist?list='
        + encodeURIComponent(requiredString(id.playlistId, 'YouTube playlist id')),
    }
  }
  throw new Error('Upstream returned an unsupported YouTube result kind')
}

function youtubeApiResult(value: unknown, index: number, config: ResolvedConfig): SearchResult {
  const item = object(value, 'YouTube API result #' + String(index + 1))
  const id = object(item.id, 'YouTube API result identity')
  const details = object(item.snippet, 'YouTube API result snippet')
  const target = youtubeApiUrl(id)
  const description = snippet(details.description, config.maxSnippetChars)
  const publishedAt = string(details.publishedAt)
  const author = string(details.channelTitle)
  return result(
    'youtube',
    target.kind,
    requiredString(details.title, 'YouTube API result title'),
    target.url,
    {
      ...description === undefined ? {} : { snippet: description },
      ...publishedAt === undefined ? {} : { publishedAt },
      ...author === undefined ? {} : { author },
    },
  )
}

export function normalizeYouTubeApi(
  response: ProviderResponse,
  maxResults: number,
  config: ResolvedConfig,
): SourceSearchResult {
  const root = object(response.data, 'YouTube API search response')
  const raw = array(root.items, 'YouTube API results')
  const results = raw.slice(0, maxResults).map((value, index) =>
    youtubeApiResult(value, index, config))
  return {
    provider: 'youtube',
    source: 'youtube',
    results,
    truncated: raw.length > maxResults || string(root.nextPageToken) !== undefined,
    ...response.requestId === undefined ? {} : { requestId: response.requestId },
  }
}

export function normalizeSerpApiScholar(
  response: ProviderResponse,
  maxResults: number,
  config: ResolvedConfig,
): SourceSearchResult {
  const root = object(response.data, 'SerpApi Scholar response')
  const raw = array(root.organic_results, 'SerpApi Scholar results')
  const results = raw.slice(0, maxResults).map((value, index) => {
    const item = object(value, 'SerpApi Scholar result #' + String(index + 1))
    const publication = optionalObject(item.publication_info)
    const summary = snippet(item.snippet, config.maxSnippetChars)
    const author = string(publication?.summary)
    return result(
      'scholar',
      'page',
      requiredString(item.title, 'SerpApi Scholar result title'),
      requiredString(item.link, 'SerpApi Scholar result URL'),
      {
        ...summary === undefined ? {} : { snippet: summary },
        ...author === undefined ? {} : { author },
      },
    )
  })
  const metadata = optionalObject(root.search_metadata)
  const pagination = optionalObject(root.serpapi_pagination)
  const id = requestId(string(metadata?.id), response)
  return {
    provider: 'serpapi',
    source: 'scholar',
    results,
    truncated: raw.length > maxResults || string(pagination?.next) !== undefined,
    ...id === undefined ? {} : { requestId: id },
  }
}
