import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useStore } from '@/sidepanel/store'
import { send } from '@/sidepanel/lib/send'

vi.mock('@/sidepanel/lib/send', () => ({ send: vi.fn() }))

/** 三档勾选的互斥 reducer：一条书签同一时刻至多待在一档里。 */
describe('cleanupSelection 的互斥 reducer', () => {
  beforeEach(() => {
    vi.mocked(send).mockReset()
    useStore.setState({
      cleanupSelection: { delete: new Set(), move: new Set(), staleMove: new Set() },
      cleanupKeep: {},
      cleanupScan: null,
    })
  })

  it('勾上待删：自动从移走、待清理两档摘掉', () => {
    useStore.setState({
      cleanupSelection: {
        delete: new Set(), move: new Set(['b1']), staleMove: new Set(['b1']),
      },
    })
    useStore.getState().updateCleanupSelection({ deleteAdds: ['b1'] })
    const sel = useStore.getState().cleanupSelection
    expect([...sel.delete]).toEqual(['b1'])
    expect(sel.move.size).toBe(0)
    expect(sel.staleMove.size).toBe(0)
  })

  it('勾上移走：自动从待删、待清理两档摘掉', () => {
    useStore.setState({
      cleanupSelection: {
        delete: new Set(['b1']), move: new Set(), staleMove: new Set(['b1']),
      },
    })
    useStore.getState().updateCleanupSelection({ moveAdds: ['b1'] })
    const sel = useStore.getState().cleanupSelection
    expect([...sel.move]).toEqual(['b1'])
    expect(sel.delete.size).toBe(0)
    expect(sel.staleMove.size).toBe(0)
  })

  it('再点一次取消勾选：只摘自己那一档', () => {
    useStore.setState({
      cleanupSelection: { delete: new Set(['b1']), move: new Set(), staleMove: new Set() },
    })
    useStore.getState().updateCleanupSelection({ deleteRemoves: ['b1'] })
    expect(useStore.getState().cleanupSelection.delete.size).toBe(0)
  })

  it('成批勾删/取消（stale 区的批量勾选）', () => {
    useStore.getState().updateCleanupSelection({ deleteAdds: ['b1', 'b2'] })
    useStore.getState().updateCleanupSelection({ deleteRemoves: ['b1'] })
    expect([...useStore.getState().cleanupSelection.delete]).toEqual(['b2'])
  })

  it('setCleanupKeep 的联动走同一条 reducer：新保留项从待删摘下、旧保留项补上', () => {
    const scan = {
      duplicates: [{ key: 'g1', keepId: 'old', items: [
        { id: 'old', title: 'old', url: 'https://old.dev' },
        { id: 'new', title: 'new', url: 'https://new.dev' },
      ] }],
      scopeRootIds: ['1'], items: [], folders: [], emptyFolders: [],
    } as never
    useStore.setState({
      cleanupScan: scan,
      cleanupSelection: { delete: new Set(['new']), move: new Set(), staleMove: new Set() },
    })
    useStore.getState().setCleanupKeep('g1', 'new')
    expect(useStore.getState().cleanupSelection.delete).toEqual(new Set(['old']))
    expect(useStore.getState().cleanupKeep.g1).toBe('new')
  })
})
