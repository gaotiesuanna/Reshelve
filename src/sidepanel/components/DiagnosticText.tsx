import { t } from '@/i18n'

const INLINE_LIMIT = 220

function splitDiagnostic(message: string): { summary: string; detail: string | null } {
  const separator = message.includes('原因：')
    ? '原因：'
    : message.includes('Reason: ')
      ? 'Reason: '
      : null

  if (separator !== null) {
    const at = message.indexOf(separator)
    const detail = message.slice(at + separator.length).trim()
    if (detail.length > 0) {
      return { summary: message.slice(0, at + separator.length).trimEnd(), detail }
    }
  }

  if (message.length <= INLINE_LIMIT) return { summary: message, detail: null }
  return {
    summary: `${message.slice(0, INLINE_LIMIT).trimEnd()}…`,
    detail: message,
  }
}

export function DiagnosticText({ message }: { message: string }): React.JSX.Element {
  const { summary, detail } = splitDiagnostic(message)
  if (detail === null) return <span>{summary}</span>

  return (
    <div className="min-w-0">
      <div className="break-words">{summary}</div>
      <details className="mt-2 border-t border-current/15 pt-2">
        <summary className="cursor-pointer text-xs font-medium underline decoration-dotted underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current">
          {t('diagnosticShowDetails')}
        </summary>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/5 p-2 font-mono text-[0.6875rem] leading-body-sm">
          {message}
        </pre>
      </details>
    </div>
  )
}
