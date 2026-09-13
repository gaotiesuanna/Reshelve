import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProgressPanel } from '@/sidepanel/components/ProgressPanel'
import type { LogLine } from '@/sidepanel/store'

const logs: LogLine[] = [
  { id: 1, phase: 'tags', level: 'info', message: '标签批次 1/2：25 条' },
  { id: 2, phase: 'classify', level: 'info', message: '分类批次 1/2：25 条，成功 25 条' },
]

describe('ProgressPanel', () => {
  it('空闲且没有日志时不渲染', () => {
    const { container } = render(<ProgressPanel status={null} busy={null} progress={null} logs={[]} />)
    expect(container.textContent).toBe('')
  })

  it('显示当前阶段与进度数字', () => {
    render(
      <ProgressPanel
        status="running"
        busy="正在分析…"
        progress={{ phase: 'classify', done: 320, total: 923 }}
        logs={logs}
      />,
    )
    expect(screen.getByText('正在分析…')).toBeDefined()
    expect(screen.getByText('分类 320/923')).toBeDefined()
  })

  it('任务运行中明确显示进行中，即使已有失败级别的可恢复日志', () => {
    render(
      <ProgressPanel
        status="running"
        busy="正在分析…"
        progress={{ phase: 'classify', done: 320, total: 923 }}
        logs={[...logs, { id: 3, phase: 'classify', level: 'error', message: '批次失败，稍后继续' }]}
      />,
    )

    expect(screen.getByText('进行中')).toBeDefined()
    expect(screen.queryByText('失败')).toBeNull()
  })

  it('任务正常结束后明确显示已完成', () => {
    render(<ProgressPanel status="completed" busy={null} progress={null} logs={logs} />)

    expect(screen.getByText('已完成')).toBeDefined()
  })

  it('结构草稿生成后等待用户确认，不显示已完成', () => {
    render(
      <ProgressPanel
        status="waiting"
        busy={null}
        progress={{ phase: 'tags', done: 57, total: 57 }}
        logs={logs}
      />,
    )

    expect(screen.getByText('等待确认')).toBeDefined()
    expect(screen.queryByText('已完成')).toBeNull()
    expect(screen.queryByRole('status')?.querySelector('div[style="width: 99%;"]')).not.toBeNull()
  })

  it('任务最终失败后明确显示失败', () => {
    render(
      <ProgressPanel
        status="failed"
        busy={null}
        progress={null}
        logs={logs}
      />,
    )

    expect(screen.getByText('失败')).toBeDefined()
  })

  it('任务仍在运行且数字已到总数时，进度条保持未满', () => {
    const { container } = render(
      <ProgressPanel
        status="running"
        busy="正在分析…"
        progress={{ phase: 'classify', done: 923, total: 923 }}
        logs={logs}
      />,
    )

    expect(container.querySelector('div[style="width: 99%;"]')).not.toBeNull()
  })

  it('任务结束后，进度条可以显示 100%', () => {
    const { container } = render(
      <ProgressPanel
        status="completed"
        busy={null}
        progress={{ phase: 'classify', done: 923, total: 923 }}
        logs={logs}
      />,
    )

    expect(container.querySelector('div[style="width: 100%;"]')).not.toBeNull()
  })

  it('开跑时自动展开：busy 从 null 变成非空，全部日志直接可见', () => {
    const { rerender } = render(<ProgressPanel status={null} busy={null} progress={null} logs={[]} />)
    rerender(<ProgressPanel status="running" busy="正在分析…" progress={null} logs={logs} />)
    expect(screen.getByText(/标签批次 1\/2/)).toBeDefined()
    expect(screen.getByText('运行日志（2 条）')).toBeDefined()
  })

  // 重开侧栏接回一轮正在跑的任务时 busy 一开始就是非空，同样算「开跑」
  it('接回正在跑的任务（挂载时 busy 已非空）也自动展开', () => {
    render(<ProgressPanel status="running" busy="正在分析…" progress={null} logs={logs} />)
    expect(screen.getByText(/标签批次 1\/2/)).toBeDefined()
  })

  // 自动展开只负责「顶开」那一次；用户在运行途中折起来，后来的日志不再顶开它
  it('运行中手动折叠后，新日志不再把它顶开', async () => {
    const { rerender } = render(<ProgressPanel status="running" busy="正在分析…" progress={null} logs={logs} />)
    await userEvent.click(screen.getByRole('button', { name: '收起运行日志' }))
    expect(screen.queryByText(/标签批次 1\/2/)).toBeNull()
    rerender(
      <ProgressPanel
        status="running"
        busy="正在分析…"
        progress={null}
        logs={[...logs, { id: 3, phase: 'classify', level: 'info', message: '分类批次 2/2：23 条' }]}
      />,
    )
    expect(screen.queryByText(/标签批次 1\/2/)).toBeNull()
  })

  // 跑完留下的日志保持折叠的一行视图：跑完了，没人需要一屏历史
  it('空闲时的残留日志默认折叠，只显示最新一行', () => {
    render(<ProgressPanel status="completed" busy={null} progress={null} logs={logs} />)
    expect(screen.getByText('分类批次 1/2：25 条，成功 25 条')).toBeDefined()
    expect(screen.queryByText('标签批次 1/2：25 条')).toBeNull()
  })

  // 自动展开只管开跑那一下；空闲残留的日志仍是折叠的一行视图，手动展开照样可用
  it('空闲残留日志手动展开后显示全部日志', async () => {
    render(<ProgressPanel status="completed" busy={null} progress={null} logs={logs} />)
    await userEvent.click(screen.getByRole('button', { name: '展开运行日志' }))
    expect(screen.getByText(/标签批次 1\/2/)).toBeDefined()
    expect(screen.getByText('运行日志（2 条）')).toBeDefined()
  })

  it('有 error 级别日志时自动展开', () => {
    render(
      <ProgressPanel
        status="running"
        busy="正在分析…"
        progress={null}
        logs={[...logs, { id: 3, phase: 'classify', level: 'error', message: '批次失败：400' }]}
      />,
    )
    expect(screen.getByText(/标签批次 1\/2/)).toBeDefined()
  })

  it('传入 onCancel 时显示取消按钮并回调', async () => {
    const onCancel = vi.fn()
    render(<ProgressPanel status="running" busy="正在分析…" progress={null} logs={logs} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('不可取消的步骤没有取消按钮', () => {
    render(<ProgressPanel status="running" busy="正在应用…" progress={null} logs={logs} />)
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
  })

  it('分析结束后日志仍然保留', () => {
    render(<ProgressPanel status="completed" busy={null} progress={null} logs={logs} />)
    expect(screen.getByText('分类批次 1/2：25 条，成功 25 条')).toBeDefined()
  })
})
