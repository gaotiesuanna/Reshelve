import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { BookmarkWorkspace } from '@/sidepanel/components/BookmarkWorkspace'

describe('BookmarkWorkspace', () => {
  it('keeps controls and actions outside the independently scrollable bookmark viewport', () => {
    render(
      <BookmarkWorkspace
        viewportLabel="书签列表"
        toolbar={<button type="button">全部展开</button>}
        summary={<div>已选范围摘要</div>}
        footer={<button type="button">继续</button>}
      >
        <div>很长的书签列表</div>
      </BookmarkWorkspace>,
    )

    const workspace = screen.getByTestId('bookmark-workspace')
    const summary = within(workspace).getByTestId('bookmark-workspace-summary')
    const viewport = within(workspace).getByTestId('bookmark-workspace-viewport')
    const footer = within(workspace).getByTestId('bookmark-workspace-footer')

    expect(workspace.className).toContain('max-w-[54rem]')
    expect(workspace.className).toContain('flex-1')
    expect(workspace.className).toContain('max-h-[48rem]')
    expect(workspace.className).not.toContain('overflow-hidden')
    expect(viewport.className).toContain('overflow-y-auto')
    expect(viewport.className).toContain('min-h-32')
    expect(within(workspace).getByRole('region', { name: '书签列表' })).toBe(viewport)
    expect(within(viewport).getByText('很长的书签列表')).toBeDefined()
    expect(within(viewport).queryByRole('button', { name: '全部展开' })).toBeNull()
    expect(within(viewport).queryByText('已选范围摘要')).toBeNull()
    expect(within(viewport).queryByRole('button', { name: '继续' })).toBeNull()
    expect(within(summary).getByText('已选范围摘要')).toBeDefined()
    expect(summary.className).toContain('max-h-40')
    expect(footer.className).toContain('bg-index-surface')
    expect(footer.className).toContain('max-h-[40%]')
    expect(footer.className).not.toContain('sticky')
  })
})
