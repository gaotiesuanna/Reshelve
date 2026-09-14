import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BookmarkIcon } from '@/sidepanel/components/icons'

describe('shadcn/ui 基础层', () => {
  it('cn 合并 Tailwind 类并让后者覆盖冲突值', () => {
    expect(cn('px-2 text-slate-500', 'px-4 text-slate-900')).toBe('px-4 text-slate-900')
  })

  it('Button 提供 shadcn 的 data-slot、变体和可访问名称', () => {
    render(<Button variant="outline" size="sm">开始整理</Button>)

    const button = screen.getByRole('button', { name: '开始整理' })
    expect(button.getAttribute('data-slot')).toBe('button')
    expect(button.className).toContain('border')
    expect(button.className).toContain('h-9')
  })

  it('图标适配层使用 Lucide 的 SVG，并统一描边宽度', () => {
    const { container } = render(<BookmarkIcon className="h-4 w-4" />)

    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('svg')?.getAttribute('stroke-width')).toBe('1.75')
  })
})
