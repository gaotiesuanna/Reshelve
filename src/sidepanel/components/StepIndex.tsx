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
  children,
}: {
  items: readonly StepIndexItem<K>[]
  currentKey: K
  /** 只开放当前流程已满足前置条件的步骤，避免任意跳转造成空页面或丢草稿。 */
  selectableKeys?: readonly K[]
  onSelect?: (key: K) => void
  children: React.ReactNode
}): React.JSX.Element {
  const currentIndex = items.findIndex((item) => item.key === currentKey)

  return (
    <div className="flex min-h-full flex-col">
      <ol className="flex flex-wrap gap-x-2 gap-y-1 border-b border-index-line pb-3" aria-label={t('shellStepsLabel')}>
        {items.map((item, index) => {
          const current = index === currentIndex
          const completed = currentIndex >= 0 && index < currentIndex
          const selectable = !current && onSelect !== undefined && selectableKeys.includes(item.key)
          const className = [
            'rounded-index px-2 py-1 text-xs leading-none tabular-nums transition-colors',
            current
              ? 'bg-index-accent-soft font-semibold text-index-ink ring-1 ring-index-accent/20'
              : completed
                ? 'font-medium text-index-muted'
                : 'font-medium text-index-faint',
            selectable
              ? 'cursor-pointer hover:bg-index-accent-soft hover:text-index-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-index-accent motion-reduce:transition-none'
              : 'block',
          ].join(' ')
          const content = `${index + 1}. ${item.label}`
          return (
            <li key={item.key}>
              {selectable ? (
                <button
                  type="button"
                  className={className}
                  onClick={() => onSelect(item.key)}
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
        })}
      </ol>
      <div data-testid="step-content" className="mt-4 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
