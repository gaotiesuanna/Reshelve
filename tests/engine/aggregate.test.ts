import { describe, expect, it } from 'vitest'
import { aggregateBookmarks, type AggregateInput } from '@/engine/aggregate'
import { SNAPSHOT_KEY, type BookmarkSnapshot } from '@/engine/snapshot'
import { undoLast } from '@/engine/undo'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'

function setup() {
  const bookmarks = createFakeBookmarks([
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '网络', children: [
          { id: '100', title: '路由器', url: 'http://192.168.5.1' },
          { id: '101', title: 'NAS', url: 'http://192.168.5.2' },
          { id: '102', title: '保留原位', url: 'https://example.com' },
        ]},
        { id: '11', title: '归档', children: [] },
      ]},
    ]},
  ])
  const storage = createFakeStorage()
  return { bookmarks, storage, ports: { bookmarks: bookmarks.api, storage } }
}

function input(over: Partial<AggregateInput> = {}): AggregateInput {
  return {
    planId: 'aggregate-1', bookmarkIds: ['100', '101'],
    destination: { kind: 'existing', folderId: '11' }, folderTitle: '局域网设备', ...over,
  }
}

describe('aggregateBookmarks', () => {
  it('在指定位置新建文件夹，只移动明确选中的书签，并可完整撤销', async () => {
    const { bookmarks, storage, ports } = setup()

    const result = await aggregateBookmarks(ports, input(), 'zh_CN', { now: () => 123 })

    expect(result).toMatchObject({
      status: 'completed', moved: 2, folderTitle: '局域网设备',
      createdFolder: true, changed: true, skipped: [],
    })
    expect(bookmarks.structure()).toContain('书签栏/归档/局域网设备/路由器')
    expect(bookmarks.structure()).toContain('书签栏/归档/局域网设备/NAS')
    expect(bookmarks.structure()).toContain('书签栏/网络/保留原位')
    const snapshot = await storage.get<BookmarkSnapshot>(SNAPSHOT_KEY)
    expect(snapshot?.createdAt).toBe(123)
    expect(snapshot?.nodes.map((node) => node.id)).toEqual(['100', '101'])
    expect(snapshot?.createdFolderIds).toEqual([result.targetFolderId])

    await undoLast(ports, 'zh_CN')
    expect(bookmarks.structure()).toContain('书签栏/网络/路由器')
    expect(bookmarks.structure()).toContain('书签栏/网络/NAS')
    expect(bookmarks.structure()).not.toContain('局域网设备')
  })

  it('手动路径缺失时逐级创建，并在撤销时连同空路径一起删除', async () => {
    const { bookmarks, storage, ports } = setup()

    const result = await aggregateBookmarks(ports, input({
      destination: { kind: 'path', segments: ['书签栏', 'finished', '魔法'] },
    }), 'zh_CN')

    expect(result).toMatchObject({
      status: 'completed', moved: 2, createdFolder: true, changed: true,
    })
    expect(bookmarks.structure()).toContain('书签栏/finished/魔法/局域网设备/路由器')
    expect(bookmarks.structure()).toContain('书签栏/finished/魔法/局域网设备/NAS')
    const snapshot = await storage.get<BookmarkSnapshot>(SNAPSHOT_KEY)
    expect(snapshot?.createdFolderIds).toHaveLength(3)
    expect(snapshot?.createdFolderIds.at(-1)).toBe(result.targetFolderId)

    await undoLast(ports, 'zh_CN')
    expect(bookmarks.structure()).toContain('书签栏/网络/路由器')
    expect(bookmarks.structure()).toContain('书签栏/网络/NAS')
    expect(bookmarks.structure()).not.toContain('书签栏/finished')
  })

  it('复用指定位置下的同名直接子目录，已在其中的书签不重复移动', async () => {
    const bookmarks = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: '来源', children: [
            { id: '100', title: '路由器', url: 'http://192.168.5.1' },
          ]},
          { id: '11', title: '归档', children: [
            { id: '12', title: '局域网设备', children: [
              { id: '101', title: 'NAS', url: 'http://192.168.5.2' },
            ]},
          ]},
        ]},
      ]},
    ])
    const ports = { bookmarks: bookmarks.api, storage: createFakeStorage() }

    const result = await aggregateBookmarks(ports, input(), 'zh_CN')

    expect(result).toMatchObject({
      moved: 1, alreadyInTarget: 1, targetFolderId: '12',
      createdFolder: false, changed: true,
    })
    expect((await bookmarks.api.get('100'))?.parentId).toBe('12')
    expect((await bookmarks.api.get('101'))?.parentId).toBe('12')
  })

  it('去重书签 id，并把执行前已不存在的条目记为跳过', async () => {
    const { bookmarks, ports } = setup()

    const result = await aggregateBookmarks(
      ports,
      input({ bookmarkIds: ['100', '100', 'missing'] }),
      'zh_CN',
    )

    expect(result.moved).toBe(1)
    expect(result.skipped.map((item) => item.bookmarkId)).toEqual(['missing'])
    expect((await bookmarks.api.get('100'))?.parentId).toBe(result.targetFolderId)
  })

  it('全部书签已经在目标中时不覆盖上一份撤销快照', async () => {
    const { bookmarks, storage, ports } = setup()
    const previous = {
      createdAt: 1, planId: 'previous', scopeRootIds: [], nodes: [],
      createdFolderIds: [], renamedBookmarkIds: [], rootNodes: [], deletedBookmarkIds: [],
    }
    await storage.set(SNAPSHOT_KEY, previous)
    const created = await bookmarks.api.create({ parentId: '11', title: '局域网设备' })
    await bookmarks.api.move('100', { parentId: created.id })

    const result = await aggregateBookmarks(
      ports,
      input({ bookmarkIds: ['100'] }),
      'zh_CN',
    )

    expect(result).toMatchObject({ moved: 0, alreadyInTarget: 1, changed: false })
    expect(await storage.get(SNAPSHOT_KEY)).toEqual(previous)
  })

  it('目标位置已不存在时在任何改动前失败', async () => {
    const { bookmarks, storage, ports } = setup()
    const before = bookmarks.structure()

    const result = await aggregateBookmarks(
      ports,
      input({ destination: { kind: 'existing', folderId: 'gone' } }),
      'zh_CN',
    )

    expect(result).toMatchObject({ status: 'failed', changed: false, moved: 0 })
    expect(result.error).toContain('目标位置')
    expect(bookmarks.structure()).toBe(before)
    expect(await storage.get(SNAPSHOT_KEY)).toBeNull()
  })
})
