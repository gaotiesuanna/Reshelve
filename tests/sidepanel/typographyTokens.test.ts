import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'

describe('typography tokens', () => {
  it('exposes white-index color and geometry tokens', async () => {
    const css = await readFile(resolve('src/sidepanel/index.css'), 'utf8')

    expect(css).toContain('--index-line:')
    expect(css).toContain('--index-blue:')
    expect(css).toContain('--index-radius:')
    expect(css).toContain('--index-row-min-height: 42px')
    expect(css).toContain('--font-size-display:')
    expect(css).toContain('--font-size-title:')
    expect(css).toContain('--font-size-heading:')
    expect(css).toContain('--font-size-body-lg:')
    expect(css).toContain('--font-size-body:')
    expect(css).toContain('--font-size-caption:')
    expect(css).toContain('--font-size-overline:')
    expect(css).toContain('--font-weight-bold:')
    expect(css).toContain('--line-height-display:')
    expect(css).toContain('--line-height-title:')
    expect(css).toContain('--line-height-heading:')
    expect(css).toContain('--line-height-body-lg:')
    expect(css).toContain('--line-height-body-sm:')
    expect(css).toContain('--line-height-overline:')
  })

  it('defines the quiet workspace surface and interaction tokens', async () => {
    const css = await readFile(resolve('src/sidepanel/index.css'), 'utf8')

    expect(css).toContain('--index-surface:')
    expect(css).toContain('--index-surface-muted:')
    expect(css).toContain('--index-accent:')
    expect(css).toContain('--index-accent-soft:')
    expect(css).toContain('--index-shadow-soft:')
    expect(css).toContain('--index-focus-ring:')
  })

  it('compiles the named typography tokens to the shared CSS variables', async () => {
    const css = await readFile(resolve('src/sidepanel/index.css'), 'utf8')
    const result = await postcss([tailwindcss()]).process(`${css}
@source inline("font-sans font-mono text-2xs text-xs text-sm text-md text-base text-display text-title text-heading text-body-lg text-body text-caption text-overline font-regular font-medium font-semibold font-bold leading-snug leading-normal leading-relaxed leading-caption leading-body leading-display leading-title leading-heading leading-body-lg leading-body-sm leading-overline");`, {
      from: resolve('src/sidepanel/index.css'),
    })

    expect(result.css).toContain('.text-2xs')
    expect(result.css).toContain('font-size: var(--font-size-2xs)')
    expect(result.css).toContain('font-size: var(--font-size-xs)')
    expect(result.css).toContain('font-size: var(--font-size-sm)')
    expect(result.css).toContain('font-size: var(--font-size-md)')
    expect(result.css).toContain('font-size: var(--font-size-base)')
    expect(result.css).toContain('font-size: var(--font-size-display)')
    expect(result.css).toContain('font-size: var(--font-size-title)')
    expect(result.css).toContain('font-size: var(--font-size-heading)')
    expect(result.css).toContain('font-size: var(--font-size-body-lg)')
    expect(result.css).toContain('font-size: var(--font-size-body)')
    expect(result.css).toContain('font-size: var(--font-size-caption)')
    expect(result.css).toContain('font-size: var(--font-size-overline)')
    expect(result.css).toContain('font-family: var(--font-family-sans)')
    expect(result.css).toContain('font-family: var(--font-family-mono)')
    expect(result.css).toContain('font-weight: 400')
    expect(result.css).toContain('font-weight: 500')
    expect(result.css).toContain('font-weight: 600')
    expect(result.css).toContain('font-weight: 700')
    expect(result.css).toContain('line-height: var(--line-height-snug)')
    expect(result.css).toContain('line-height: var(--line-height-normal)')
    expect(result.css).toContain('line-height: var(--line-height-relaxed)')
    expect(result.css).toContain('line-height: var(--line-height-caption)')
    expect(result.css).toContain('line-height: var(--line-height-body)')
    expect(result.css).toContain('line-height: var(--line-height-display)')
    expect(result.css).toContain('line-height: var(--line-height-title)')
    expect(result.css).toContain('line-height: var(--line-height-heading)')
    expect(result.css).toContain('line-height: var(--line-height-body-lg)')
    expect(result.css).toContain('line-height: var(--line-height-body-sm)')
    expect(result.css).toContain('line-height: var(--line-height-overline)')
  })
})
