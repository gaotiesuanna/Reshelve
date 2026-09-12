import { useMemo } from 'react'
import { buildStructureView, validateStructureEdits, type StructureNode } from '@/core/structure'
import { currentLocale, plural, t } from '@/i18n'
import { joinTitles } from '../lib/listText'
import { useStore } from '../store'
import { InlineStatus } from '../components/InlineStatus'
import { PrimaryButton, SecondaryButton, StickyActionBar } from '../components/IndexControls'
import { fieldClass, focusRing } from '../components/buttonStyles'
import { FolderIcon } from '../components/icons'

const mergeSelectClass = 'w-[8.5rem] max-w-full min-w-[5.5rem] rounded-index border border-index-line bg-index-canvas px-1 py-1 text-xs text-index-ink'
const titleFieldClass = [
  'min-w-0 w-full truncate rounded-index border border-transparent bg-transparent px-0.5 py-0.5',
  'text-sm leading-caption text-index-ink',
  'hover:border-index-line',
  'focus:border-index-line focus:bg-index-canvas',
  focusRing,
].join(' ')

function StructureRow({
  node,
  index,
  siblings,
  renameNode,
  removeNode,
  mergeNode,
  titleFor,
  errorsByNode,
  disabled,
}: {
  node: StructureNode
  index: string
  siblings: StructureNode[]
  renameNode: (id: string, title: string) => void
  removeNode: (id: string) => void
  mergeNode: (id: string, into: string) => void
  titleFor: (node: StructureNode) => string
  errorsByNode: Map<string, string[]>
  disabled: boolean
}) {
  const displayedTitle = titleFor(node)
  const errors = errorsByNode.get(node.id) ?? []
  return (
    <li data-index={index}>
      <div className="group grid min-h-index-row grid-cols-[minmax(2.75rem,max-content)_1rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-index-line px-2 py-2 text-sm leading-caption">
        <span aria-hidden className="whitespace-nowrap font-mono text-xs text-neutral-400">{index}.</span>
        <FolderIcon className="h-3.5 w-3.5 shrink-0 text-index-faint" />
        {node.removable ? (
          <input
            aria-label={displayedTitle || node.title}
            title={displayedTitle || node.title}
            className={titleFieldClass}
            value={displayedTitle}
            disabled={disabled}
            onChange={(e) => renameNode(node.id, e.target.value)}
          />
        ) : (
          <span className="min-w-0 truncate text-index-muted" title={node.title}>{node.title}</span>
        )}
        <span className="flex min-w-0 items-center justify-end gap-1">
          {node.removable && (
            <span className="pointer-events-none flex min-w-0 items-center gap-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
              <select
                aria-label={t('structureMergeInto', displayedTitle || node.title)}
                className={mergeSelectClass}
                defaultValue=""
                disabled={disabled}
                onChange={(e) => {
                  if (e.target.value !== '') mergeNode(node.id, e.target.value)
                }}
              >
                <option value="">{t('structureMergePlaceholder')}</option>
                {siblings
                  .filter((sibling) => sibling.id !== node.id)
                  .map((sibling) => (
                    <option key={sibling.id} value={sibling.id}>{titleFor(sibling)}</option>
                  ))}
              </select>
              <SecondaryButton
                aria-label={t('structureDelete', displayedTitle || node.title)}
                className="shrink-0"
                size="sm"
                disabled={disabled}
                onClick={() => removeNode(node.id)}
              >
                ✕
              </SecondaryButton>
            </span>
          )}
          <span className="shrink-0 font-mono text-xs tabular-nums text-index-muted" title={t('structureIncoming', String(node.count))}>
            {node.count}
          </span>
        </span>
      </div>
      {errors.map((message) => (
        <p key={message} role="alert" className="border-b border-index-line px-2 py-1 text-xs text-red-700">
          {message}
        </p>
      ))}
      {node.children.length > 0 && (
        <ol className="ml-5 border-l border-index-line pl-2">
          {node.children.map((child, childIndex) => (
            <StructureRow
              key={child.id}
              node={child}
              index={`${index}.${String(childIndex + 1).padStart(2, '0')}`}
              siblings={node.children}
              renameNode={renameNode}
              removeNode={removeNode}
              mergeNode={mergeNode}
              titleFor={titleFor}
              errorsByNode={errorsByNode}
              disabled={disabled}
            />
          ))}
        </ol>
      )}
    </li>
  )
}

export function StructureStep() {
  const {
    structureDraft, structureEdits, busy,
    renameNode, removeNode, mergeNode, addStructureNode, confirmStructure, backToPreferences,
  } = useStore()
  const { nodes, validation } = useMemo(() => {
    if (structureDraft === null) {
      return { nodes: [], validation: { errors: [], warnings: [] } }
    }
    return {
      nodes: buildStructureView(structureDraft, structureEdits, structureDraft.locale),
      validation: validateStructureEdits(structureDraft, structureEdits, structureDraft.locale),
    }
  }, [structureDraft, structureEdits])
  if (structureDraft === null) return null

  const titleFor = (node: StructureNode): string => {
    const renamed = structureEdits.renames[node.id]
    if (renamed !== undefined) return renamed
    const added = structureEdits.added.find((candidate) => candidate.temporaryId === node.id)
    return added?.title ?? node.title
  }
  const errorsByNode = new Map<string, string[]>()
  for (const error of validation.errors) {
    if (error.nodeId === null) continue
    const messages = errorsByNode.get(error.nodeId) ?? []
    messages.push(error.message)
    errorsByNode.set(error.nodeId, messages)
  }
  const visibleIds = new Set(nodes.flatMap((node) => [node.id, ...node.children.map((child) => child.id)]))
  if (structureDraft.mergeRoot !== null) visibleIds.add(structureDraft.mergeRoot.temporaryId)
  const globalErrors = validation.errors.filter((error) =>
    error.nodeId === null || !visibleIds.has(error.nodeId))

  const total = nodes.reduce((sum, node) => sum + node.count, 0)
  const description = plural(
    nodes.length, 'structureIntroOne', 'structureIntroOther', String(nodes.length), String(total),
  )

  return (
    <div>
      <p className="text-sm leading-body text-index-muted">{description}</p>
      <p className="mt-1 text-xs leading-body text-index-muted">{t('structureEstimateHint')}</p>
      <p className="mt-1 text-xs leading-body text-index-muted">{t('structureHint')}</p>

      {/* 合并根是容器不是分类，不进下面那份两层列表；它不可删除，也不带计数 */}
      {structureDraft.mergeRoot !== null && (
        <div className="mt-3">
          <InlineStatus tone="warning" title={t('structureMergeLabel')}>
            <label className="block">
              <span className="sr-only">{t('structureMergeLabel')}</span>
            <input
                className={`mt-1 ${fieldClass}`}
              value={structureEdits.renames[structureDraft.mergeRoot.temporaryId] ?? structureDraft.mergeRoot.title}
              disabled={busy !== null}
              onChange={(e) => renameNode(structureDraft.mergeRoot!.temporaryId, e.target.value)}
            />
            {(errorsByNode.get(structureDraft.mergeRoot.temporaryId) ?? []).map((message) => (
              <p key={message} role="alert" className="mt-1 text-xs text-red-700">{message}</p>
            ))}
            </label>
          {/* 上面那行说的是东西去哪儿，没说什么会没掉。合并会把这些源目录清空后删除，
             而在这之前，整条动线没有任何一处讲过这件事——偏好页那段「范围根目录不会被删除」
             讲的还是非合并模式。第一次听说不能是结果页，那时已经删完了。
             点名到具体标题，不说「源文件夹」这种对不上号的话；删除吓人，撤销才是让人敢按的那句。 */}
            <p className="mt-2 text-xs leading-body">
            {t('structureMergeNotice', joinTitles(structureDraft.mergeRoot.sourceTitles, currentLocale()))}
          </p>
          </InlineStatus>
        </div>
      )}

      {/* 标题不重复顶上的步骤条（那里已经写着「确认结构」），目标目录数在开头那句里也说了 */}
      <div data-testid="structure-section">
        <ol className="border-y border-index-line">
          {nodes.map((node, index) => (
            <StructureRow
              key={node.id}
              node={node}
              index={String(index + 1).padStart(2, '0')}
              siblings={nodes}
              renameNode={renameNode}
              removeNode={removeNode}
              mergeNode={mergeNode}
              titleFor={titleFor}
              errorsByNode={errorsByNode}
              disabled={busy !== null}
            />
          ))}
        </ol>
      </div>

      <div className="mt-3">
        <SecondaryButton size="sm" disabled={busy !== null} onClick={addStructureNode}>
          {t('structureAddType')}
        </SecondaryButton>
      </div>

      <div className="mt-3">
        <InlineStatus tone="neutral">{t('structureFallback')}</InlineStatus>
      </div>

      {validation.warnings.map((warning) => (
        <div key={warning} className="mt-3">
          <InlineStatus tone="warning">{warning}</InlineStatus>
        </div>
      ))}
      {globalErrors.length > 0 && (
        <div className="mt-3">
          <InlineStatus tone="error" title={t('structureInvalid')} live="assertive">
            <ul className="list-disc pl-4">
              {globalErrors.map((error) => <li key={`${error.nodeId ?? 'global'}:${error.code}`}>{error.message}</li>)}
            </ul>
          </InlineStatus>
        </div>
      )}

      <StickyActionBar>
        <div className="flex gap-2">
          <SecondaryButton disabled={busy !== null} onClick={backToPreferences}>{t('structureBack')}</SecondaryButton>
          <PrimaryButton
            className="flex-1"
            aria-label={t('structureConfirmAndClassify')}
            disabled={busy !== null || validation.errors.length > 0}
            onClick={() => { void confirmStructure() }}
          >
          {busy === null ? t('structureConfirmAndClassify') : t('structureClassifying')}
          </PrimaryButton>
        </div>
      </StickyActionBar>
    </div>
  )
}
