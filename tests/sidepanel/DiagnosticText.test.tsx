import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DiagnosticText } from '@/sidepanel/components/DiagnosticText'

describe('DiagnosticText', () => {
  it('短错误直接显示，不增加折叠层', () => {
    render(<DiagnosticText message="模型暂时没有返回结果" />)

    expect(screen.getByText('模型暂时没有返回结果')).toBeDefined()
    expect(screen.queryByText('查看原始错误')).toBeNull()
  })

  it('长错误默认只显示摘要，原文收进可展开详情', () => {
    const detail = '{"results":' + 'x'.repeat(600) + '}'
    const message = `25 个书签分类失败，已保持原位。原因：${detail}`
    render(<DiagnosticText message={message} />)

    expect(screen.getByText('25 个书签分类失败，已保持原位。原因：')).toBeDefined()
    const details = screen.getByText('查看原始错误').closest('details')
    expect(details).not.toBeNull()
    expect(details?.open).toBe(false)
    expect(within(details!).getByText(message)).toBeDefined()
  })
})
