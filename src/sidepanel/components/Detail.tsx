import { useState, type ReactNode } from 'react'
import { t } from '@/i18n'

/**
 * 一段默认收起的说明文字。
 *
 * 偏好页的说明默认收起，避免每个整理方式都把长正文摊在开始按钮前；需要时沿用
 * ProgressPanel 的 ▸/▾ 惯例展开，不另造一种折叠样式：同一个侧栏里两种折叠
 * 长得不一样，用户要认两次。
 *
 * `flush` 供「本身已经在一张描边卡片里」的位置用：卡片自己用 divide-y 画行间线，
 * 这里再画一条自己的上下边，两条会挨在一起变成双线；行内边距也跟着卡片的 px-3 走，
 * 否则同一张卡里复选框和 ▸ 会差 4px，一眼能看出没对齐。
 */
export function Detail({
  label,
  flush = false,
  defaultOpen = false,
  wide = false,
  inline = false,
  children,
}: {
  label: string
  flush?: boolean
  defaultOpen?: boolean
  /**
   * 标题长过「说明」时取消 5rem 左列：按钮通栏，展开内容跟在下面。
   * 「N 个散落书签」中英都塞不进那一列。
   */
  wide?: boolean
  /**
   * 作为选项第一行右侧的紧凑说明按钮。调用方提供外层 dl 的两列网格，
   * 这里返回 dt/dd 兄弟节点，让展开内容可以跨满整行。
   */
  inline?: boolean
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const pad = flush ? 'px-3' : 'px-2'
  const toggle = (
    <button
      type="button"
      className={`flex min-h-8 items-center gap-1 ${inline ? 'px-2' : `${pad} w-full`} text-left font-medium text-index-muted transition-colors duration-150 hover:text-index-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-index-blue motion-reduce:transition-none`}
      aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}
    >
      <span aria-hidden className="shrink-0">{expanded ? '▾' : '▸'}</span>
      <span>{label}</span>
    </button>
  )

  if (inline) {
    return (
      <>
        <dt className="justify-self-end">{toggle}</dt>
        {expanded && (
          <dd className="col-span-2 min-w-0 border-t border-index-line px-3 py-2 text-index-muted">
            {children}
          </dd>
        )}
      </>
    )
  }

  return (
    <dl className={`${flush ? '' : 'border-t border-index-line'} text-xs leading-body`}>
      <div className={`${wide ? '' : 'grid grid-cols-[5rem_minmax(0,1fr)]'} ${flush ? '' : 'border-b border-index-line'}`}>
        <dt>{toggle}</dt>
        {expanded && (
          <dd className={`min-w-0 border-l border-index-line py-2 ${pad} text-index-muted`}>
            {children}
          </dd>
        )}
      </div>
    </dl>
  )
}

/** 折叠说明的默认标题，三处共用一句，不必各写各的。 */
export function detailLabel(): string {
  return t('prefsDetailToggle')
}
