import { describe, expect, it } from 'vitest'
import type { JsonValue, ToolResult } from '@deepseek-ai/dsh-tools'
import { EasySearchService } from '../src/search.ts'
import {
  createEasyExtractTool,
  createEasySearchTool,
  formatExtractOutput,
  formatSearchOutput,
  presentSearchCall,
  presentSearchResult,
} from '../src/tools.ts'
import type { EasyExtractResult, EasySearchResult } from '../src/types.ts'

const service = Object.create(EasySearchService.prototype) as EasySearchService

const searchValue: EasySearchResult = {
  query: 'agent systems',
  answer: 'Grounded answer',
  truncated: true,
  coverage: [
    { source: 'web', provider: 'tavily', status: 'ok', resultCount: 1, requestId: 'web-id' },
    { source: 'x', provider: 'x', status: 'error', resultCount: 0, error: 'temporarily unavailable' },
  ],
  results: [{
    source: 'web',
    kind: 'page',
    title: 'Result title',
    url: 'https://example.com/result',
    snippet: 'Result snippet',
    publishedAt: '2026-08-17',
    author: 'Example',
  }],
}

describe('Easy Search tool presentation', () => {
  it('projects replayable metadata into a native DSH web-search card', () => {
    const tool = createEasySearchTool(service)
    const args = { query: 'agent systems', sources: ['web'] }
    const meta = tool.output.presentationMeta?.(args, searchValue as unknown as JsonValue)
    const result: ToolResult = {
      content: [],
      isError: false,
      ...meta === undefined ? {} : { meta },
    }

    expect(tool.name).toBe('easy_search')
    expect(meta).toEqual({
      sources: [{
        url: 'https://example.com/result',
        title: 'Result title',
        snippet: 'Result snippet',
        publishedAt: '2026-08-17',
      }],
      truncated: true,
      answer: 'Grounded answer',
    })
    expect(tool.presentResult?.(args, result)).toEqual({
      card: 'web',
      kind: 'search',
      title: 'agent systems',
      sources: [{
        url: 'https://example.com/result',
        title: 'Result title',
        snippet: 'Result snippet',
        publishedAt: '2026-08-17',
      }],
      truncated: true,
      answer: 'Grounded answer',
    })
  })

  it('falls back cleanly for failed or obsolete presentation payloads', () => {
    expect(presentSearchCall({ query: 'topic' })).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'topic',
      rawInput: 'topic',
    })
    expect(presentSearchResult({ query: 'topic' }, {
      content: [],
      isError: true,
    })).toBeUndefined()
    expect(presentSearchResult({ query: 'topic' }, {
      content: [],
      isError: false,
      meta: { sources: [], truncated: 'no' },
    })).toBeUndefined()
  })

  it('renders citeable model-facing text without leaking provider payloads', () => {
    const output = formatSearchOutput(searchValue)
    expect(output).toContain('[Result title](https://example.com/result)')
    expect(output).toContain('WEB | Example | 2026-08-17')
    expect(output).toContain('x: temporarily unavailable')
    expect(output).toContain('Cite the relevant URLs')
  })
})

describe('Easy Extract tool presentation', () => {
  it('uses a fetch card only when one document maps to one URL', () => {
    const value: EasyExtractResult = {
      provider: 'tavily',
      requestId: 'extract-id',
      documents: [{
        url: 'https://example.com/page',
        title: 'Page title',
        content: '# Content',
        truncated: false,
      }],
      failures: [],
    }
    const tool = createEasyExtractTool(service)
    const args = { urls: ['https://example.com/page'] }
    const meta = tool.output.presentationMeta?.(args, value as unknown as JsonValue)
    expect(tool.presentResult?.(args, {
      content: [],
      isError: false,
      ...meta === undefined ? {} : { meta },
    })).toEqual({
      card: 'web',
      kind: 'fetch',
      title: 'https://example.com/page',
      url: 'https://example.com/page',
      statusCode: 200,
      truncated: false,
    })
    expect(formatExtractOutput(value))
      .toContain('## [Page title](https://example.com/page)')
  })
})
