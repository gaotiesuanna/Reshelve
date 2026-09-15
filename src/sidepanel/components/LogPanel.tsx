import { PHASE_LABELS } from '@/background/events'
import { plural, t } from '@/i18n'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { LogLine, Progress } from '../store'
import {
  LEVEL_CLASS,
  STATUS_CLASS,
  STATUS_LABELS,
  type ProgressStatus,
} from './ProgressPanel'

interface Props {
  status: ProgressStatus | null
  busy: string | null
  progress: Progress | null
  logs: LogLine[]
  /** 传入时显示取消按钮；只有可中断的步骤才传。 */
  onCancel?: () => void
}

function statusMark(status: ProgressStatus): ReactNode {
  if (status === 'running') {
    return (
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 animate-spin rounded-full border border-index-line-strong border-t-index-muted"
      />
    )
  }

  return (
    <span aria-hidden className="w-3 shrink-0 text-center font-semibold">
      {status === 'failed' ? '!' : status === 'waiting' ? '…' : '✓'}
    </span>
  )
}

export function LogPanel({ status, busy, progress, logs, onCancel }: Props) {
  const logScrollArea = useRef<HTMLDivElement>(null)
  const shouldFollowLogs = useRef(true)
  const percent =
    status !== null && progress !== null && progress.total > 0
      ? status === 'completed'
        ? Math.round((progress.done / progress.total) * 100)
        : Math.min(99, Math.round((progress.done / progress.total) * 100))
      : null

  useLayoutEffect(() => {
    const scrollArea = logScrollArea.current
    if (scrollArea === null || !shouldFollowLogs.current) return
    scrollArea.scrollTop = Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight)
  }, [logs])

  function handleLogScroll(): void {
    const scrollArea = logScrollArea.current
    if (scrollArea === null) return
    shouldFollowLogs.current =
      scrollArea.scrollHeight - scrollArea.clientHeight - scrollArea.scrollTop <= 16
  }

  return (
    <aside
      data-testid="tab-llm-log"
      aria-label={t('llmLogTitle')}
      className="sticky top-6 flex min-h-[20rem] flex-col overflow-hidden rounded-index border border-index-line bg-index-surface shadow-[var(--index-shadow-soft)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-index-line bg-index-surface-muted/45 px-4 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-index-ink">{t('llmLogTitle')}</h2>
          <p className="mt-0.5 text-xs text-index-faint">{busy ?? t('llmLogEmpty')}</p>
        </div>
        {status !== null && (
          <div className={`flex shrink-0 items-center gap-1.5 text-xs ${STATUS_CLASS[status]}`}>
            {statusMark(status)}
            <span className="font-medium">{t(STATUS_LABELS[status])}</span>
          </div>
        )}
      </div>

      {percent !== null && (
        <div className="h-1 w-full bg-index-accent-soft">
          <div className="h-full bg-index-accent transition-all" style={{ width: `${percent}%` }} />
        </div>
      )}

      {(progress !== null && progress.total > 0 || logs.length > 0 || onCancel !== undefined) && (
        <div className="flex items-center gap-2 border-b border-index-line px-4 py-3 text-xs text-index-muted">
          {progress !== null && progress.total > 0 ? (
            <span data-testid="llm-log-progress" className="flex items-center gap-2">
              <span>{t(PHASE_LABELS[progress.phase])}</span>
              <span className="font-mono text-index-ink">{progress.done}/{progress.total}</span>
            </span>
          ) : (
            <span>{plural(logs.length, 'progressLogsTitleOne', 'progressLogsTitleOther', String(logs.length))}</span>
          )}
          {onCancel !== undefined && (
            <button
              type="button"
              className="ml-auto rounded-md border border-index-line-strong px-2 py-1 font-medium text-index-muted transition-colors hover:border-index-accent hover:bg-index-accent-soft hover:text-index-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-index-accent focus-visible:ring-offset-1 motion-reduce:transition-none"
              onClick={onCancel}
            >
              {t('progressCancel')}
            </button>
          )}
        </div>
      )}

      <div
        ref={logScrollArea}
        data-testid="llm-log-scroll"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        onScroll={handleLogScroll}
      >
        {logs.length > 0 ? (
          <ul className="space-y-2 text-xs leading-body-sm">
            {logs.map((line) => (
              <li key={line.id} className={`whitespace-pre-wrap break-words ${LEVEL_CLASS[line.level]}`}>
                <span className="mr-1 font-mono text-[0.6875rem] text-index-faint">[{t(PHASE_LABELS[line.phase])}]</span>
                {line.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex min-h-32 items-center justify-center text-center text-sm leading-body text-index-faint">
            {t('llmLogEmpty')}
          </p>
        )}
      </div>
    </aside>
  )
}
