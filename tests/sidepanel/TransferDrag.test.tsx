import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferStep } from '@/sidepanel/steps/TransferStep'
import { useStore } from '@/sidepanel/store'
import { send } from '@/sidepanel/lib/send'
import { moveBookmarks } from '@/engine/moveBookmarks'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'

vi.mock('@/sidepanel/lib/send', () => ({ send: vi.fn() }))

function dragData() {
  return { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn(), setDragImage: vi.fn() }
}

function row(title: string): HTMLElement {
  const titleElement = screen.getByText(title)
  return (titleElement.closest('[data-bookmark-row]') ?? titleElement.parentElement!.parentElement!) as HTMLElement
}

let bookmarks: ReturnType<typeof createFakeBookmarks>

beforeEach(async () => {
  bookmarks = createFakeBookmarks([{ id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: '来源', children: [
        { id: '100', title: 'A', url: 'https://a.dev' },
        { id: '101', title: 'B', url: 'https://b.dev' },
        { id: '12', title: '子夹', children: [
          { id: '120', title: 'C', url: 'https://c.dev' },
        ] },
      ] },
      { id: '11', title: '归档', children: [
        { id: '110', title: '归档内容', url: 'https://archive.dev' },
      ] },
    ] },
  ] }])
  const tree = await bookmarks.api.getTree()
  useStore.setState({
    tree, checkedIds: new Set(), moveSelection: new Set(), busy: null, busyTask: null,
    error: null, importFile: null, importError: null, importDone: null,
  })
  vi.mocked(send).mockReset()
  vi.mocked(send).mockImplementation(async (request) => {
    if (request.kind === 'move_bookmarks') {
      const result = await moveBookmarks({ bookmarks: bookmarks.api, storage: createFakeStorage() }, request.input)
      return { ok: true, kind: 'move_bookmarks', result }
    }
    if (request.kind === 'get_tree') return { ok: true, kind: 'get_tree', tree: await bookmarks.api.getTree() }
    throw new Error(`Unexpected request: ${request.kind}`)
  })
})

afterEach(() => vi.useRealTimers())

describe('浏览列表拖拽移动', () => {
  it('从任意已选中书签拖起时一起移动多个书签，悬停高亮并在成功后刷新列表', async () => {
    render(<TransferStep />)
    await userEvent.click(screen.getByRole('button', { name: '展开 来源' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择书签 A' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择书签 B' }))
    expect(row('A').draggable).toBe(true)
    expect(screen.queryByText('C')).toBeNull()
    const dataTransfer = dragData()
    fireEvent.dragStart(row('B'), { dataTransfer })
    fireEvent.dragOver(row('归档'), { dataTransfer })
    expect(row('归档').getAttribute('data-drop-target')).toBe('true')
    fireEvent.drop(row('归档'), { dataTransfer })
    await waitFor(() => expect(bookmarks.structure()).toContain('书签栏/归档/B'))
    expect(bookmarks.structure()).toContain('书签栏/归档/A')
    await waitFor(() => expect(useStore.getState().moveSelection.size).toBe(0))
    expect(row('归档').getAttribute('data-drop-target')).not.toBe('true')
    expect(screen.queryByText('A')).toBeNull()
  })

  it('移动选中文件夹时保留结构并去重，不能放到自身、后代或书签上', async () => {
    render(<TransferStep />)
    await userEvent.click(screen.getByRole('button', { name: '全部展开' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '来源' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择书签 A' }))
    const dataTransfer = dragData()
    fireEvent.dragStart(row('子夹'), { dataTransfer })
    for (const title of ['来源', '子夹', '归档内容']) {
      fireEvent.dragOver(row(title), { dataTransfer })
      expect(row(title).getAttribute('data-drop-target')).not.toBe('true')
      fireEvent.drop(row(title), { dataTransfer })
    }
    expect(send).not.toHaveBeenCalled()
    fireEvent.dragStart(row('来源'), { dataTransfer })
    fireEvent.drop(row('归档'), { dataTransfer })
    await waitFor(() => expect(bookmarks.structure()).toContain('书签栏/归档/来源/子夹/C'))
    expect(bookmarks.structure()).toContain('书签栏/归档/来源/A')
    expect(bookmarks.structure()).not.toContain('书签栏/归档/A')
  })

  it('搜索后拖拽仍移动隐藏的选中项', async () => {
    useStore.setState({ moveSelection: new Set(['100', '101']) })
    render(<TransferStep />)
    await userEvent.type(screen.getByRole('searchbox'), 'a')
    const dataTransfer = dragData()
    fireEvent.dragStart(row('A'), { dataTransfer })
    await userEvent.clear(screen.getByRole('searchbox'))
    fireEvent.drop(row('归档'), { dataTransfer })
    await waitFor(() => expect(bookmarks.structure()).toContain('书签栏/归档/A'))
    expect(bookmarks.structure()).toContain('书签栏/归档/B')
  })

  it('未选中行、永久目录和忙碌期间不能拖起，也不接收外部拖放', async () => {
    render(<TransferStep />)
    await userEvent.click(screen.getByRole('button', { name: '全部展开' }))
    expect(row('A').draggable).toBe(false)
    await userEvent.click(screen.getByRole('checkbox', { name: '书签栏' }))
    expect(row('书签栏').draggable).toBe(false)
    act(() => useStore.setState({ checkedIds: new Set(), moveSelection: new Set(['100']), busy: '移动中' }))
    expect(row('A').draggable).toBe(false)
    const dataTransfer = dragData()
    fireEvent.dragStart(row('A'), { dataTransfer })
    fireEvent.drop(row('归档'), { dataTransfer })
    act(() => useStore.setState({ busy: null }))
    fireEvent.drop(row('归档'), { dataTransfer })
    expect(send).not.toHaveBeenCalled()
  })

  it('悬停收起的文件夹后自动展开，取消拖拽会清除提示', async () => {
    useStore.setState({ moveSelection: new Set(['100']) })
    render(<TransferStep />)
    await userEvent.click(screen.getByRole('button', { name: '展开 来源' }))
    vi.useFakeTimers()
    const dataTransfer = dragData()
    fireEvent.dragStart(row('A'), { dataTransfer })
    fireEvent.dragOver(row('归档'), { dataTransfer })
    act(() => vi.advanceTimersByTime(700))
    expect(screen.getByText('归档内容')).toBeDefined()
    fireEvent.dragEnd(row('A'), { dataTransfer })
    expect(row('归档').getAttribute('data-drop-target')).not.toBe('true')
    expect(useStore.getState().moveSelection).toEqual(new Set(['100']))
    expect(send).not.toHaveBeenCalled()
  })

  it('移动失败时保留选择以便重试，并展示已有的移动错误', async () => {
    vi.mocked(send).mockResolvedValue({ ok: false, error: '目标文件夹不存在' })
    useStore.setState({ moveSelection: new Set(['100', '101']) })
    render(<TransferStep />)
    await userEvent.click(screen.getByRole('button', { name: '展开 来源' }))
    const dataTransfer = dragData()
    fireEvent.dragStart(row('A'), { dataTransfer })
    fireEvent.drop(row('归档'), { dataTransfer })
    await waitFor(() => expect(useStore.getState().error).toBe('移动失败：目标文件夹不存在'))
    expect(useStore.getState().moveSelection).toEqual(new Set(['100', '101']))
    expect(bookmarks.structure()).toContain('书签栏/来源/A')
    expect(row('A').draggable).toBe(true)
    expect(row('归档').getAttribute('data-drop-target')).not.toBe('true')
  })

  it('拖动到滚动区边缘时滚动列表，离开目标时取消自动展开', async () => {
    useStore.setState({ moveSelection: new Set(['100']) })
    render(<TransferStep />)
    await userEvent.click(screen.getByRole('button', { name: '展开 来源' }))
    const viewport = screen.getByTestId('bookmark-workspace-viewport')
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 500 } as DOMRect)
    vi.useFakeTimers()
    const dataTransfer = dragData()
    fireEvent.dragStart(row('A'), { dataTransfer })
    const dragOver = createEvent.dragOver(row('归档'), { dataTransfer })
    Object.defineProperty(dragOver, 'clientY', { value: 490 })
    fireEvent(row('归档'), dragOver)
    expect(viewport.scrollTop).toBeGreaterThan(0)
    fireEvent.dragLeave(row('归档'), { relatedTarget: viewport })
    act(() => vi.advanceTimersByTime(700))
    expect(screen.queryByText('归档内容')).toBeNull()
    expect(row('归档').getAttribute('data-drop-target')).not.toBe('true')
    fireEvent.dragEnd(row('A'), { dataTransfer })
  })
})
