import type { ReactNode } from 'react'

type BookmarkWorkspaceProps = {
  children: ReactNode
  viewportLabel: string
  toolbar?: ReactNode
  summary?: ReactNode
  footer?: ReactNode
  className?: string
  testId?: string
}

/**
 * 三条书签工作流共用的视觉 seam。
 *
 * 调用方只提供工具、内容和操作，不再各自决定容器宽高、滚动归属或操作栏定位。
 * 中间视口独立滚动；底部操作区是卡片自己的普通布局行，因此不会盖在书签上。
 */
export function BookmarkWorkspace({
  children,
  viewportLabel,
  toolbar,
  summary,
  footer,
  className = '',
  testId = 'bookmark-workspace',
}: BookmarkWorkspaceProps): React.JSX.Element {
  return (
    <section
      data-testid={testId}
      data-bookmark-workspace="true"
      className={[
        'flex min-h-0 max-h-[48rem] w-full max-w-[54rem] flex-1 flex-col',
        'rounded-[calc(var(--index-radius)+4px)] border border-index-line bg-index-surface',
        'shadow-[var(--index-shadow-soft)]',
        className,
      ].join(' ')}
    >
      {toolbar !== undefined && (
        <div className="shrink-0 rounded-t-[calc(var(--index-radius)+3px)] border-b border-index-line bg-index-surface-muted px-3 py-3 sm:px-4">
          {toolbar}
        </div>
      )}
      {summary !== undefined && (
        <div
          data-testid="bookmark-workspace-summary"
          className="max-h-40 min-h-0 overflow-y-auto border-b border-index-line bg-index-surface-muted p-3 sm:p-4"
        >
          {summary}
        </div>
      )}
      <div
        data-testid="bookmark-workspace-viewport"
        role="region"
        aria-label={viewportLabel}
        tabIndex={0}
        className="min-h-32 flex-1 overflow-y-auto overscroll-contain bg-index-surface [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-index-accent"
      >
        {children}
      </div>
      {footer !== undefined && (
        <div
          data-testid="bookmark-workspace-footer"
          className="max-h-[40%] min-h-0 overflow-y-auto rounded-b-[calc(var(--index-radius)+3px)] border-t border-index-line bg-index-surface px-3 py-3 sm:px-4"
        >
          {footer}
        </div>
      )}
    </section>
  )
}
