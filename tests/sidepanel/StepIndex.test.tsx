import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StepIndex, type StepIndexItem } from '@/sidepanel/components/StepIndex'

type StepKey = 'scope' | 'preferences' | 'structure' | 'review' | 'result'

const items: readonly StepIndexItem<StepKey>[] = [
  { key: 'scope', label: '选择范围' },
  { key: 'preferences', label: '设置偏好' },
  { key: 'structure', label: '确认结构' },
  { key: 'review', label: '预览修改' },
  { key: 'result', label: '完成整理' },
]

describe('StepIndex', () => {
  it('让步骤内容撑满主区域，为底部操作栏提供稳定的布局空间', () => {
    render(
      <StepIndex items={items} currentKey="scope">
        <div>范围编辑器</div>
      </StepIndex>,
    )

    const content = screen.getByTestId('step-content')
    expect(content.className).toContain('flex-1')
    expect(content.className).toContain('flex-col')
  })

  it('渲染当前步骤内容，并把当前步骤标成 aria-current', () => {
    render(
      <StepIndex items={items} currentKey="structure">
        <div>结构编辑器</div>
      </StepIndex>,
    )

    expect(screen.getByText('结构编辑器')).toBeDefined()
    expect(screen.getByText(/确认结构/).getAttribute('aria-current')).toBe('step')
    expect(screen.getByText(/选择范围/).getAttribute('aria-current')).toBeNull()
  })

  it('序号跟着位置走，从 1 开始', () => {
    render(
      <StepIndex items={items} currentKey="scope">
        <div>范围编辑器</div>
      </StepIndex>,
    )

    expect(screen.getByText(/选择范围/).textContent).toBe('1. 选择范围')
    expect(screen.getByText(/完成整理/).textContent).toBe('5. 完成整理')
  })

  it('五个步骤都列出来，标题可见', () => {
    render(
      <StepIndex items={items} currentKey="scope">
        <div>范围编辑器</div>
      </StepIndex>,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    for (const item of items) {
      expect(screen.getByText(new RegExp(item.label))).toBeDefined()
    }
  })

  it('有 onSelect 时非当前步骤都可点；已开放的走回调，未开放的出提示', async () => {
    const onSelect = vi.fn()
    render(
      <StepIndex
        items={items}
        currentKey="review"
        selectableKeys={['preferences']}
        onSelect={onSelect}
      >
        <div>修改预览</div>
      </StepIndex>,
    )

    expect(screen.getByRole('button', { name: '2. 设置偏好' })).toBeDefined()
    expect(screen.getByRole('button', { name: '3. 确认结构' })).toBeDefined()
    expect(screen.getByRole('button', { name: '1. 选择范围' })).toBeDefined()
    expect(screen.getByRole('button', { name: '5. 完成整理' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '4. 预览修改' })).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)

    await userEvent.click(screen.getByRole('button', { name: '2. 设置偏好' }))
    expect(onSelect).toHaveBeenCalledWith('preferences')

    onSelect.mockClear()
    await userEvent.click(screen.getByRole('button', { name: '3. 确认结构' }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('请先完成前面的步骤')
    expect(screen.getByRole('status').textContent).toContain('确认结构')
  })

  it('variant="sidebar" 时渲染左侧侧边栏和主内容区', () => {
    render(
      <StepIndex items={items} currentKey="preferences" variant="sidebar">
        <div>偏好设置表单</div>
      </StepIndex>,
    )

    const sidebar = screen.getByTestId('step-sidebar')
    expect(sidebar).toBeDefined()
    expect(screen.getByText('偏好设置表单')).toBeDefined()
    expect(screen.getByText(/设置偏好/).getAttribute('aria-current')).toBe('step')
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('variant="sidebar" 时未开放步骤点击只提示、不回调', async () => {
    const onSelect = vi.fn()
    render(
      <StepIndex
        items={items}
        currentKey="scope"
        selectableKeys={[]}
        onSelect={onSelect}
        variant="sidebar"
      >
        <div>范围</div>
      </StepIndex>,
    )

    await userEvent.click(screen.getByRole('button', { name: '5. 完成整理' }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('请先完成前面的步骤')
    expect(screen.getByRole('status').textContent).toContain('完成整理')
  })

  it('variant="sidebar" 时支持可交互步骤的点击回调', async () => {
    const onSelect = vi.fn()
    render(
      <StepIndex
        items={items}
        currentKey="review"
        selectableKeys={['preferences']}
        onSelect={onSelect}
        variant="sidebar"
      >
        <div>预览</div>
      </StepIndex>,
    )

    const btn = screen.getByRole('button', { name: '2. 设置偏好' })
    await userEvent.click(btn)
    expect(onSelect).toHaveBeenCalledWith('preferences')
  })
})
