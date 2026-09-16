import { useEffect, useState } from 'react'
import { t } from '@/i18n'

export type StepIndexItem<K extends string> = {
  key: K
  label: string
}

export function StepIndex<K extends string>({
  items,
  currentKey,
  selectableKeys = [],
  onSelect,
  variant = 'bar',
  children,
}: {
  items: readonly StepIndexItem<K>[]
  currentKey: K
  /** 已满足前置、可以真跳转的步骤；其余有 onSelect 时仍可点，但只提示、不回调。 */
  selectableKeys?: readonly K[]
  onSelect?: (key: K) => void
  variant?: 'bar' | 'sidebar'
  children: React.ReactNode
}): React.JSX.Element {
  const currentIndex = items.findIndex((item) => item.key === currentKey)
  const [lockedTip, setLockedTip] = useState<string | null>(null)

  useEffect(() => {
    setLockedTip(null)
  }, [currentKey])

  useEffect(() => {
    if (lockedTip === null) return
    const timer = window.setTimeout(() => setLockedTip(null), 4000)
    return () => window.clearTimeout(timer)
  }, [lockedTip])

  const handleClick = (key: K, label: string, selectable: boolean): void => {
    if (onSelect === undefined) return
    if (selectable) {
      setLockedTip(null)
      onSelect(key)
      return
    }
    setLockedTip(t('shellStepLocked', label))
  }

  const renderItem = (item: StepIndexItem<K>, index: number, layout: 'sidebar' | 'bar') => {
    const current = index === currentIndex
    const completed = currentIndex >= 0 && index < currentIndex
    const interactive = !current && onSelect !== undefined
    const selectable = interactive && selectableKeys.includes(item.key)
    const className = [
      layout === 'sidebar'
        ? 'flex w-full items-center rounded-index px-2.5 py-2 text-xs leading-body tabular-nums transition-colors text-left'
        : 'rounded-index px-2 py-1 text-xs leading-none tabular-nums transition-colors',
      current
        ? 'bg-index-accent-soft font-semibold text-index-ink ring-1 ring-index-accent/20'
        : completed
          ? 'font-medium text-index-muted'
          : 'font-medium text-index-faint',
      interactive
        ? 'cursor-pointer hover:bg-index-accent-soft hover:text-index-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-index-accent motion-reduce:transition-none'
        : '',
    ].join(' ')
    const content = `${index + 1}. ${item.label}`

    return (
      <li key={item.key}>
        {interactive ? (
          <button
            type="button"
            className={className}
            onClick={() => handleClick(item.key, item.label, selectable)}
          >
            {content}
          </button>
        ) : (
          <span
            {...(current ? { 'aria-current': 'step' as const } : {})}
            className={className}
          >
            {content}
          </span>
        )}
      </li>
    )
  }

  const tip = lockedTip !== null && (
    <p
      role="status"
      aria-live="polite"
      data-testid="step-locked-tip"
      className={
        variant === 'sidebar'
          ? 'mt-3 px-2 text-xs leading-relaxed text-index-muted'
          : 'mt-2 text-xs leading-relaxed text-index-muted'
      }
    >
      {lockedTip}
    </p>
  )

  if (variant === 'sidebar') {
    return (
      <div className="flex min-h-full flex-col md:flex-row gap-3 md:gap-4">
        <aside
          data-testid="step-sidebar"
          className="w-full md:w-36 lg:w-40 shrink-0 border-b md:border-b-0 md:border-r border-index-line pb-4 md:pb-0 pr-0 md:pr-3"
        >
          <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-index-muted">
            {t('shellStepsLabel')}
          </div>
          <ol className="flex flex-col space-y-1" aria-label={t('shellStepsLabel')}>
            {items.map((item, index) => renderItem(item, index, 'sidebar'))}
          </ol>
          {tip}
        </aside>
        <div data-testid="step-content" className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      <ol className="flex flex-wrap gap-x-2 gap-y-1 border-b border-index-line pb-3" aria-label={t('shellStepsLabel')}>
        {items.map((item, index) => renderItem(item, index, 'bar'))}
      </ol>
      {tip}
      <div data-testid="step-content" className="mt-4 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
