import { describe, expect, it } from 'vitest'
import {
  normalizeSerpApiScholar,
  normalizeXApi,
  normalizeYouTubeApi,
} from '../src/normalize.ts'
import { TEST_CONFIG } from './helpers.ts'

describe('direct provider response normalization', () => {
  it('joins X posts to expanded users and retains public metrics', () => {
    const value = normalizeXApi({
      data: {
        data: [{
          id: 'post-1',
          author_id: 'user-1',
          text: 'A direct X result',
          created_at: '2026-08-17T00:00:00Z',
          public_metrics: {
            like_count: 12,
            reply_count: 2,
            retweet_count: 3,
            quote_count: 1,
            impression_count: 900,
          },
        }],
        includes: {
          users: [{ id: 'user-1', name: 'Example', username: 'example' }],
        },
        meta: { next_token: 'next' },
      },
      requestId: 'x-request',
    }, 3, TEST_CONFIG)

    expect(value).toEqual({
      provider: 'x',
      source: 'x',
      requestId: 'x-request',
      truncated: true,
      results: [{
        source: 'x',
        kind: 'post',
        title: 'Example (@example)',
        url: 'https://x.com/example/status/post-1',
        snippet: 'A direct X result',
        publishedAt: '2026-08-17T00:00:00Z',
        author: 'Example (@example)',
        metrics: {
          likes: 12,
          replies: 2,
          reposts: 3,
          quotes: 1,
          views: 900,
        },
      }],
    })
  })

  it('maps all YouTube search result identities to canonical URLs', () => {
    const value = normalizeYouTubeApi({
      data: {
        items: [
          {
            id: { kind: 'youtube#video', videoId: 'video-1' },
            snippet: {
              title: 'Video',
              description: 'Video description',
              publishedAt: '2026-08-17T00:00:00Z',
              channelTitle: 'Creator',
            },
          },
          {
            id: { kind: 'youtube#channel', channelId: 'channel-1' },
            snippet: { title: 'Channel', description: '' },
          },
          {
            id: { kind: 'youtube#playlist', playlistId: 'playlist-1' },
            snippet: { title: 'Playlist', description: '' },
          },
        ],
      },
    }, 3, TEST_CONFIG)

    expect(value.provider).toBe('youtube')
    expect(value.results.map(result => [result.kind, result.url])).toEqual([
      ['video', 'https://www.youtube.com/watch?v=video-1'],
      ['channel', 'https://www.youtube.com/channel/channel-1'],
      ['playlist', 'https://www.youtube.com/playlist?list=playlist-1'],
    ])
  })

  it('normalizes SerpApi Scholar metadata without leaking raw fields', () => {
    const value = normalizeSerpApiScholar({
      data: {
        search_metadata: { id: 'scholar-request' },
        serpapi_pagination: { next: 'https://serpapi.com/search.json?start=10' },
        organic_results: [{
          title: 'A paper',
          link: 'https://papers.example/paper',
          snippet: 'Abstract text',
          publication_info: { summary: 'A. Author - Journal, 2026' },
          result_id: 'provider-only-id',
        }],
      },
    }, 3, TEST_CONFIG)

    expect(value).toEqual({
      provider: 'serpapi',
      source: 'scholar',
      requestId: 'scholar-request',
      truncated: true,
      results: [{
        source: 'scholar',
        kind: 'page',
        title: 'A paper',
        url: 'https://papers.example/paper',
        snippet: 'Abstract text',
        author: 'A. Author - Journal, 2026',
      }],
    })
  })
})
