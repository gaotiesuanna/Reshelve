import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { deleteHistoryUrls, visitUrls } from '@/sidepanel/lib/visits'

const chromeGlobal = globalThis as unknown as { chrome: Record<string, unknown> }
const original = chromeGlobal.chrome?.history

const NOW = Date.parse('2026-08-29T00:00:00Z')
const DAY = 86400000

let search: ReturnType<typeof vi.fn>
let getVisits: ReturnType<typeof vi.fn>
let deleteUrl: ReturnType<typeof vi.fn>

beforeEach(() => {
  search = vi.fn(() => Promise.resolve([]))
  getVisits = vi.fn(() => Promise.resolve([]))
  deleteUrl = vi.fn(() => Promise.resolve())
  chromeGlobal.chrome = { ...chromeGlobal.chrome, history: { search, getVisits, deleteUrl } }
})

afterAll(() => {
  chromeGlobal.chrome.history = original
})

describe('visitUrls', () => {
  it('「全部」只查一次，次数直接取 visitCount', async () => {
    search.mockResolvedValue([
      { url: 'https://github.com/a', title: 'A', visitCount: 20 },
      { url: 'https://github.com/b', title: 'B', visitCount: 3 },
    ])

    expect(await visitUrls('all', NOW)).toEqual([
      { url: 'https://github.com/a', title: 'A', weight: 20 },
      { url: 'https://github.com/b', title: 'B', weight: 3 },
    ])
    expect(search).toHaveBeenCalledWith({ text: '', maxResults: 10000, startTime: 0 })
    expect(getVisits).not.toHaveBeenCalled()
  })

  it('限了时间窗就逐条数窗内的时间戳，不用 visitCount', async () => {
    search.mockResolvedValue([
      { url: 'https://github.com/a', title: 'A', visitCount: 500 },
    ])
    getVisits.mockResolvedValue([
      { visitTime: NOW - 1 * DAY },
      { visitTime: NOW - 10 * DAY },
      // 窗外的两年前那笔不算
      { visitTime: NOW - 700 * DAY },
    ])

    expect(await visitUrls('3m', NOW)).toEqual([
      { url: 'https://github.com/a', title: 'A', weight: 2 },
    ])
    expect(search).toHaveBeenCalledWith({
      text: '', maxResults: 10000, startTime: NOW - 90 * DAY,
    })
    expect(getVisits).toHaveBeenCalledWith({ url: 'https://github.com/a' })
  })

  it('窗内一次都没有的丢掉', async () => {
    search.mockResolvedValue([{ url: 'https://github.com/old', visitCount: 900 }])
    getVisits.mockResolvedValue([{ visitTime: NOW - 700 * DAY }])

    expect(await visitUrls('3m', NOW)).toEqual([])
  })

  it('查不到访问明细的当作窗内没有，不炸', async () => {
    search.mockResolvedValue([{ url: 'https://github.com/x', visitCount: 5 }])
    getVisits.mockRejectedValue(new Error('nope'))

    expect(await visitUrls('3m', NOW)).toEqual([])
  })
})

describe('deleteHistoryUrls', () => {
  it('逐条 deleteUrl，一条失败不影响其余，重复地址只删一次', async () => {
    const deleteUrl = vi.fn(({ url }: { url: string }) =>
      url === 'https://b.example/x'
        ? Promise.reject(new Error('nope'))
        : Promise.resolve())
    chromeGlobal.chrome.history = { search, getVisits, deleteUrl }

    const result = await deleteHistoryUrls([
      'https://a.example/1',
      'https://a.example/1',
      'https://b.example/x',
      'https://c.example/2',
    ])

    expect(deleteUrl.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining([
      { url: 'https://a.example/1' },
      { url: 'https://b.example/x' },
      { url: 'https://c.example/2' },
    ]))
    expect(deleteUrl.mock.calls).toHaveLength(3)
    expect(result.deleted.sort()).toEqual(['https://a.example/1', 'https://c.example/2'])
    expect(result.failed).toEqual(['https://b.example/x'])
  })
})
