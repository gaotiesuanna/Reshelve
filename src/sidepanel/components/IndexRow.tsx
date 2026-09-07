import { useId, type ReactNode } from 'react'

export function IndexRow({
  index,
  leading,
  title,
  description,
  measure,
  value,
  expanded = false,
  disclosureLabel,
  onToggle,
  children,
}: {
  index: string
  leading?: ReactNode
  title: ReactNode
  description?: ReactNode
  measure?: ReactNode
  value?: ReactNode
  expanded?: boolean
  disclosureLabel?: string
  onToggle?: () => void
  children?: ReactNode
}): React.JSX.Element {
  const detailId = useId()
  const hasToggle = onToggle !== undefined
  const showDetails = !hasToggle || expanded
  const content = (
    <>
      <span className="w-8 shrink-0 font-mono text-xs text-neutral-400">{index}</span>
      {leading !== undefined && <span className="shrink-0">{leading}</span>}
      <span className="min-w-[8rem] flex-1 basis-[8rem]">
        {title}
        {description !== undefined && <span className="mt-0.5 block break-words text-sm leading-body text-index-muted">{description}</span>}
      </span>
      {measure !== undefined && <span className="shrink-0 whitespace-nowrap text-xs text-index-muted">{measure}</span>}
      {value !== undefined && <span className="min-w-0 max-w-full shrink-0 text-sm text-index-ink">{value}</span>}
    </>
  )

  const fallbackDisclosureLabel = typeof title === 'string' ? title : 'Toggle details'

  return (
    <div className="border-b border-index-line">
      <div className="flex min-h-index-row flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2 text-left">
        {content}
        {hasToggle ? (
          <button
            type="button"
            className="ml-auto shrink-0 text-index-faint hover:text-index-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-index-blue"
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={disclosureLabel ?? fallbackDisclosureLabel}
            onClick={onToggle}
          >
            <span aria-hidden>{expanded ? '▾' : '▸'}</span>
          </button>
        ) : null}
      </div>
      {showDetails && children !== undefined && (
        <div id={detailId} className="ml-8 border-l border-index-line py-2 pl-3">
          {children}
        </div>
      )}
    </div>
  )
}
