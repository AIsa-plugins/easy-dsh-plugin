import { describe, expect, it } from 'vitest'
import {
  normalizeExtract,
  normalizeScholar,
  normalizeWeb,
  normalizeX,
  normalizeYouTube,
} from '../src/normalize.ts'
import { TEST_CONFIG } from './helpers.ts'

describe('AIsa response normalization', () => {
  it('normalizes Tavily web results and preserves the body request ID', () => {
    const value = normalizeWeb({
      data: {
        request_id: 'web-body-id',
        answer: 'A grounded answer',
        results: [
          {
            title: 'First result',
            url: 'https://example.com/first',
            content: 'A useful summary',
            score: 0.91,
          },
          {
            title: 'Second result',
            url: 'https://example.com/second',
            content: 'Another summary',
            score: 0.75,
          },
        ],
      },
      requestId: 'header-id',
    }, 1, TEST_CONFIG)

    expect(value).toEqual({
      source: 'web',
      requestId: 'web-body-id',
      answer: 'A grounded answer',
      truncated: true,
      results: [{
        source: 'web',
        kind: 'page',
        title: 'First result',
        url: 'https://example.com/first',
        snippet: 'A useful summary',
        score: 0.91,
      }],
    })
  })

  it('normalizes X posts without retaining provider-specific fields', () => {
    const value = normalizeX({
      data: {
        has_next_page: true,
        next_cursor: 'cursor',
        tweets: [{
          id: 'tweet-id',
          url: 'https://x.com/example/status/1',
          text: 'Post text',
          createdAt: '2026-08-17T00:00:00Z',
          author: { name: 'Example', userName: 'example' },
          likeCount: 10,
          replyCount: 2,
          retweetCount: 3,
          quoteCount: 1,
          viewCount: 500,
        }],
      },
      requestId: 'x-request-id',
    }, 5, TEST_CONFIG)

    expect(value).toEqual({
      source: 'x',
      requestId: 'x-request-id',
      truncated: true,
      results: [{
        source: 'x',
        kind: 'post',
        title: 'Example (@example)',
        url: 'https://x.com/example/status/1',
        snippet: 'Post text',
        publishedAt: '2026-08-17T00:00:00Z',
        author: 'Example (@example)',
        metrics: {
          likes: 10,
          replies: 2,
          reposts: 3,
          quotes: 1,
          views: 500,
        },
      }],
    })
  })

  it('merges and ranks the current YouTube result collections', () => {
    const value = normalizeYouTube({
      data: {
        search_metadata: { id: 'youtube-search-id' },
        pagination: { next_page_token: 'next' },
        videos: [{
          position: 2,
          title: 'Video',
          link: 'https://youtube.com/watch?v=1',
          description: 'Video description',
          published_time: '1 day ago',
          views: 1200,
          channel: { name: 'Creator' },
        }],
        channels: [{
          position: 1,
          title: 'Channel',
          link: 'https://youtube.com/@creator',
          description: 'Channel description',
        }],
        playlists: [{
          position: 3,
          title: 'Playlist',
          link: 'https://youtube.com/playlist?list=1',
        }],
      },
    }, 2, TEST_CONFIG)

    expect(value.requestId).toBe('youtube-search-id')
    expect(value.truncated).toBe(true)
    expect(value.results.map(result => [result.kind, result.title]))
      .toEqual([['channel', 'Channel'], ['video', 'Video']])
    expect(value.results[1]).toMatchObject({
      author: 'Creator',
      metrics: { views: 1200 },
    })
  })

  it('normalizes Scholar query results and Tavily extraction failures', () => {
    const scholar = normalizeScholar({
      data: {
        id: 'scholar-id',
        results: [{
          title: 'A paper',
          link: 'https://papers.example/paper',
          snippet: 'Abstract text',
          published_date: '2025',
        }],
      },
    }, 3, TEST_CONFIG)
    expect(scholar).toMatchObject({
      source: 'scholar',
      requestId: 'scholar-id',
      results: [{
        source: 'scholar',
        kind: 'page',
        title: 'A paper',
        url: 'https://papers.example/paper',
        snippet: 'Abstract text',
        publishedAt: '2025',
      }],
    })

    const extract = normalizeExtract({
      data: {
        request_id: 'extract-id',
        results: [{
          url: 'https://example.com/full',
          title: 'Full page',
          raw_content: 'x'.repeat(1_001),
        }],
        failed_results: ['https://example.com/unavailable'],
      },
    }, TEST_CONFIG)
    expect(extract.requestId).toBe('extract-id')
    expect(extract.documents[0]).toMatchObject({
      url: 'https://example.com/full',
      title: 'Full page',
      truncated: true,
    })
    expect(extract.documents[0]?.content).toHaveLength(1_000)
    expect(extract.failures).toEqual([{
      url: 'https://example.com/unavailable',
      error: 'AIsa could not extract this URL',
    }])
  })
})
