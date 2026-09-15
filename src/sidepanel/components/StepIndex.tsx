import { t } from '@/i18n'

export type StepIndexItem<K extends string> = {
  key: K
  label: string
}

export function StepIndex<K extends string>({
  items,
  currentKey,
  children,
}: {
  items: readonly StepIndexItem<K>[]
  currentKey: K
  children: React.ReactNode
}): React.JSX.Element {
  const currentIndex = items.findIndex((item) => item.key === currentKey)

  return (
    <div className="flex min-h-full flex-col">
      <ol className="flex flex-wrap gap-x-2 gap-y-1 border-b border-index-line pb-3" aria-label={t('shellStepsLabel')}>
        {items.map((item, index) => {
          const current = index === currentIndex
          const completed = currentIndex >= 0 && index < currentIndex
          return (
            <li key={item.key}>
              {/* 只读进度，不是导航——刻意不长成按钮。当前步靠字重和底色给视觉，
                  aria-current 给读屏，序号和标题都是真文本，两边读到的是同一句。 */}
              <span
                {...(current ? { 'aria-current': 'step' as const } : {})}
                className={[
                  'block rounded-index px-2 py-1 text-xs leading-none tabular-nums transition-colors',
                  current
                    ? 'bg-index-accent-soft font-semibold text-index-ink ring-1 ring-index-accent/20'
                    : completed
                      ? 'font-medium text-index-muted'
                      : 'font-medium text-index-faint',
                ].join(' ')}
              >
                {index + 1}. {item.label}
              </span>
            </li>
          )
        })}
      </ol>
      <div data-testid="step-content" className="mt-4 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
