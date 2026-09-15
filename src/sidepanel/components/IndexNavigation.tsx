import { BookmarkIcon, OpenInTabIcon, SettingsIcon } from './icons'

export type IndexNavigationItem<K extends string> = {
  key: K
  label: string
  shortLabel: string
}

export function IndexNavigation<K extends string>({
  items,
  activeKey,
  disabled = false,
  settingsLabel,
  variant = 'sidebar',
  openInTabLabel,
  onSelect,
  onOpenSettings,
  onOpenInTab,
}: {
  items: readonly IndexNavigationItem<K>[]
  activeKey: K
  disabled?: boolean
  settingsLabel: string
  variant?: 'sidebar' | 'tab'
  /** 不给就不渲染：完整标签页形态里这颗按钮没有存在意义。 */
  openInTabLabel?: string
  onSelect: (key: K) => void
  onOpenSettings: () => void
  onOpenInTab?: () => void
}): React.JSX.Element {
  const isTab = variant === 'tab'

  return (
    <div
      data-testid={isTab ? 'tab-app-header' : undefined}
      className={isTab
        ? 'flex min-h-[64px] items-center gap-5 border-b border-index-line bg-index-surface px-5 sm:gap-8 sm:px-8'
        : 'flex min-w-0 items-stretch border-b border-index-line bg-index-surface'}
    >
      {isTab && (
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-index bg-index-ink text-index-canvas shadow-sm">
            <BookmarkIcon className="h-4 w-4" />
          </span>
          <h1 className="text-base font-semibold tracking-[-0.02em] text-index-ink">Reshelve</h1>
        </div>
      )}
      <div className={isTab ? 'flex min-w-0 flex-1 self-stretch' : 'flex min-w-0 flex-1'} role="tablist">
        {items.map((item) => {
          const active = item.key === activeKey
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-label={item.label}
              aria-selected={active}
              disabled={disabled}
              className={[
                isTab
                  ? 'flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden border-b-2 px-2 text-sm'
                  : 'flex h-10 min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden border-b-2 px-1 text-xs',
                'cursor-pointer transition-colors duration-150 motion-reduce:transition-none',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-index-accent',
                'disabled:cursor-not-allowed disabled:opacity-40',
                active
                  ? 'border-index-accent bg-index-accent-soft/45 font-semibold text-index-accent'
                  : 'border-transparent font-medium text-index-muted hover:bg-index-surface-muted hover:text-index-ink',
              ].join(' ')}
              onClick={() => onSelect(item.key)}
            >
              <span className="hidden min-w-0 truncate min-[400px]:inline" aria-hidden>{item.label}</span>
              <span className="min-w-0 truncate min-[400px]:hidden" aria-hidden>{item.shortLabel}</span>
            </button>
          )
        })}
      </div>
      {/* 侧栏一直挤着右侧页面，给一个逃出口：换成完整标签页。
          贴在齿轮左边而不是混进 tab 里——它是「这个窗口的形态」，不是第五条功能路线。 */}
      {openInTabLabel !== undefined && onOpenInTab !== undefined && (
        <button
          type="button"
          className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center text-index-muted transition-colors duration-150 hover:bg-index-accent-soft hover:text-index-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-index-accent motion-reduce:transition-none"
          aria-label={openInTabLabel}
          title={openInTabLabel}
          onClick={onOpenInTab}
        >
          <OpenInTabIcon className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center text-index-muted transition-colors duration-150 hover:bg-index-accent-soft hover:text-index-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-index-accent motion-reduce:transition-none"
        aria-label={settingsLabel}
        onClick={onOpenSettings}
      >
        <SettingsIcon className="h-4 w-4" />
      </button>
    </div>
  )
}
