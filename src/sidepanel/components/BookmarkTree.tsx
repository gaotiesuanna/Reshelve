import { useEffect, useId, useRef, useState, type DragEvent, type HTMLAttributes, type MouseEvent as ReactMouseEvent } from 'react'
import type { BookmarkNode } from '@/core/ports'
import { sanitizeUrl } from '@/core/sanitize'
import { isImmutableFolder } from '@/engine/editNodes'
import { t } from '@/i18n'
import { LinkIcon } from './icons'

export interface TreeEditHandlers {
  onCreateFolder: (parentId: string) => Promise<string | null>
  onRename: (id: string, title: string) => Promise<boolean>
  onEditBookmark: (id: string, title: string, url: string) => Promise<boolean>
  onDelete: (node: BookmarkNode) => Promise<boolean>
  /** 取消「新建子文件夹」后的命名：无确认直接删掉刚建的空夹。 */
  onDiscardNewFolder: (id: string) => Promise<boolean>
  onEnsureExpanded: (id: string) => void
}
export interface TreeMoveHandlers {
  nodeIds: string[]
  disabled: boolean
  canDrop: (nodeIds: string[], folderId: string) => boolean
  onMove: (nodeIds: string[], folderId: string) => void
}
interface Props {
  nodes: BookmarkNode[]
  checkedIds: Set<string>
  onToggle: (id: string) => void
  selectedBookmarkIds?: Set<string>
  onToggleBookmark?: (id: string) => void
  expandedIds: Set<string>
  onToggleExpand: (id: string) => void
  showBookmarks?: boolean
  /** 浏览书签页打开右键菜单与行内编辑；范围勾选树不传。 */
  edit?: TreeEditHandlers
  move?: TreeMoveHandlers
}

type MenuState = {
  x: number
  y: number
  node: BookmarkNode
}

type EditState =
  | { id: string; mode: 'rename'; title: string; created?: boolean }
  | { id: string; mode: 'bookmark'; title: string; url: string }

function countBookmarks(node: BookmarkNode): number {
  return (node.children ?? []).reduce(
    (sum, child) => sum + (child.url !== undefined ? 1 : countBookmarks(child)),
    0,
  )
}

/** Chrome 的根节点 id='0' 且标题为空，跳过它直接展示「书签栏」「其他书签」。 */
export function topLevelNodes(nodes: BookmarkNode[]): BookmarkNode[] {
  return nodes.flatMap((node) => (node.title === '' ? (node.children ?? []) : [node]))
}

export interface BookmarkTreeFilter {
  nodes: BookmarkNode[]
  expandedIds: Set<string>
  hasMatches: boolean
}

export function filterBookmarkTree(nodes: BookmarkNode[], query: string): BookmarkTreeFilter {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === '') return { nodes, expandedIds: new Set(), hasMatches: false }

  const expandedIds = new Set<string>()

  function visit(node: BookmarkNode): BookmarkNode | null {
    const selfMatches = node.url !== undefined
      ? node.title.toLocaleLowerCase().includes(normalized)
        || node.url.toLocaleLowerCase().includes(normalized)
      : node.title.toLocaleLowerCase().includes(normalized)
    const children = (node.children ?? []).map(visit).filter((child): child is BookmarkNode => child !== null)
    if (!selfMatches && children.length === 0) return null
    if (node.url === undefined && children.length > 0) expandedIds.add(node.id)
    return node.url === undefined ? { ...node, children } : node
  }

  const filtered = nodes.map(visit).filter((node): node is BookmarkNode => node !== null)
  return { nodes: filtered, expandedIds, hasMatches: filtered.length > 0 }
}

type RowShared = {
  depth: number
  checkedIds: Set<string>
  onToggle: (id: string) => void
  selectedBookmarkIds?: Set<string>
  onToggleBookmark?: (id: string) => void
  expandedIds: Set<string>
  onToggleExpand: (id: string) => void
  showBookmarks: boolean
  edit?: TreeEditHandlers
  editing: EditState | null
  setEditing: (next: EditState | null) => void
  openMenu: (event: ReactMouseEvent, node: BookmarkNode) => void
  commitEdit: (state: EditState) => Promise<void>
  cancelEdit: (state: EditState) => Promise<void>
  move?: TreeMoveHandlers
  dropTargetId: string | null
  dragProps: (node: BookmarkNode, selected: boolean, isEditing: boolean) => HTMLAttributes<HTMLDivElement>
}

function InlineRename({
  value,
  ariaLabel,
  showCancel,
  onCommit,
  onCancel,
}: {
  value: string
  ariaLabel: string
  showCancel?: boolean
  onCommit: (next: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  function commit(next: string): void {
    if (done.current) return
    done.current = true
    onCommit(next)
  }

  function cancel(): void {
    if (done.current) return
    done.current = true
    onCancel()
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <input
        ref={ref}
        aria-label={ariaLabel}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit(draft)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
          }
        }}
        onBlur={() => commit(draft)}
        onClick={(event) => event.stopPropagation()}
        className="min-w-0 flex-1 rounded border border-index-accent bg-index-surface px-1.5 py-0.5 text-base leading-body text-index-ink outline-none ring-1 ring-index-accent"
      />
      {showCancel === true && (
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded-index px-2 py-0.5 text-xs leading-caption text-index-muted hover:bg-index-surface-muted hover:text-index-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-index-accent"
          onMouseDown={(event) => {
            event.preventDefault()
            cancel()
          }}
        >
          {t('treeEditCancel')}
        </button>
      )}
    </div>
  )
}

function BookmarkEditForm({
  title,
  url,
  onCommit,
  onCancel,
}: {
  title: string
  url: string
  onCommit: (next: { title: string; url: string }) => void
  onCancel: () => void
}) {
  const [draftTitle, setDraftTitle] = useState(title)
  const [draftUrl, setDraftUrl] = useState(url)
  const formRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    titleRef.current?.focus()
    titleRef.current?.select()
  }, [])

  function submit(): void {
    if (done.current) return
    done.current = true
    onCommit({ title: draftTitle, url: draftUrl })
  }

  function cancel(): void {
    if (done.current) return
    done.current = true
    onCancel()
  }

  return (
    <div
      ref={formRef}
      className="flex min-w-0 flex-1 flex-col gap-1 py-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null
        if (next !== null && formRef.current?.contains(next)) return
        // 点到表单外：保存退出，避免卡在「名称」焦点上出不去
        submit()
      }}
    >
      <label className="flex min-w-0 items-center gap-2">
        <span className="w-10 shrink-0 text-xs text-index-muted">{t('treeEditTitleLabel')}</span>
        <input
          ref={titleRef}
          aria-label={t('treeEditTitleLabel')}
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
          className="min-w-0 flex-1 rounded border border-index-accent bg-index-surface px-1.5 py-0.5 text-base leading-body outline-none ring-1 ring-index-accent"
        />
      </label>
      <label className="flex min-w-0 items-center gap-2">
        <span className="w-10 shrink-0 text-xs text-index-muted">{t('treeEditUrlLabel')}</span>
        <input
          aria-label={t('treeEditUrlLabel')}
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
          className="min-w-0 flex-1 rounded border border-index-line bg-index-surface px-1.5 py-0.5 text-sm leading-caption outline-none focus:border-index-accent focus:ring-1 focus:ring-index-accent"
        />
      </label>
      <div className="flex items-center justify-end gap-2 pl-12">
        <button
          type="button"
          className="cursor-pointer rounded-index px-2 py-0.5 text-xs leading-caption text-index-muted hover:bg-index-surface-muted hover:text-index-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-index-accent"
          onMouseDown={(event) => {
            event.preventDefault()
            cancel()
          }}
        >
          {t('treeEditCancel')}
        </button>
        <button
          type="button"
          className="cursor-pointer rounded-index bg-index-ink px-2 py-0.5 text-xs leading-caption font-medium text-index-canvas hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-index-accent"
          onMouseDown={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          {t('treeEditSave')}
        </button>
      </div>
    </div>
  )
}


function Row({
  node,
  depth,
  checkedIds,
  onToggle,
  selectedBookmarkIds,
  onToggleBookmark,
  expandedIds,
  onToggleExpand,
  showBookmarks,
  edit,
  editing,
  setEditing,
  openMenu,
  commitEdit,
  cancelEdit,
  move,
  dropTargetId,
  dragProps,
}: { node: BookmarkNode } & RowShared) {
  const contextProps = edit === undefined
    ? {}
    : {
        onContextMenu: (event: ReactMouseEvent) => openMenu(event, node),
      }

  if (node.url !== undefined) {
    if (!showBookmarks) return null
    const safeUrl = sanitizeUrl(node.url) !== null
    const selected = selectedBookmarkIds?.has(node.id) ?? false
    const selectable = onToggleBookmark !== undefined
    const isEditing = editing?.id === node.id && editing.mode === 'bookmark'

    return (
      <div
        data-bookmark-row={node.id}
        {...dragProps(node, selected, isEditing)}
        className={[
          'flex min-w-0 items-center rounded py-0.5 pr-2 text-neutral-600 transition-colors',
          selectable && !isEditing ? (selected && move !== undefined && !move.disabled ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer') : '',
          selected ? 'bg-index-accent-soft' : 'hover:bg-neutral-100',
        ].filter(Boolean).join(' ')}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={selectable && !isEditing ? () => onToggleBookmark(node.id) : undefined}
        {...contextProps}
      >
        <span className="h-5 w-5 shrink-0" />
        {isEditing ? (
          <BookmarkEditForm
            title={editing.title}
            url={editing.url}
            onCommit={(next) => void commitEdit({ id: node.id, mode: 'bookmark', ...next })}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {selectable ? (
              <input
                type="checkbox"
                aria-label={t('treeSelectBookmark', node.title)}
                checked={selected}
                onChange={() => onToggleBookmark(node.id)}
                onClick={(event) => event.stopPropagation()}
                className="h-3.5 w-3.5 shrink-0 appearance-none rounded-full border border-index-line-strong bg-index-surface checked:border-index-accent checked:bg-index-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-index-accent"
              />
            ) : null}
            <LinkIcon className="h-3 w-3 shrink-0 text-neutral-300" />
            <span
              title={node.title}
              className="min-w-[6ch] flex-1 basis-[6ch] truncate text-neutral-700"
            >
              {node.title}
            </span>
            {safeUrl ? (
              <a
                draggable={move === undefined ? undefined : false}
                href={node.url}
                target="_blank"
                rel="noreferrer"
                title={node.url}
                onClick={(event) => event.stopPropagation()}
                className="ml-auto min-w-0 flex-1 truncate text-sm leading-caption text-neutral-400 hover:text-index-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-index-accent"
              >
                {node.url}
              </a>
            ) : (
              <span title={node.url} className="ml-auto min-w-0 flex-1 truncate text-sm leading-caption text-neutral-400">
                {node.url}
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  const children = (node.children ?? []).filter((child) => showBookmarks || child.url === undefined)
  const expanded = expandedIds.has(node.id)
  const isEditing = editing?.id === node.id && editing.mode === 'rename'

  return (
    <div>
      <div
        data-bookmark-row={node.id}
        data-drop-target={dropTargetId === node.id ? 'true' : undefined}
        {...dragProps(node, checkedIds.has(node.id), isEditing)}
        className={[
          'flex items-center rounded transition-colors',
          dropTargetId === node.id ? 'bg-index-accent-soft ring-2 ring-inset ring-index-accent' : 'hover:bg-neutral-100',
        ].join(' ')}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        {...contextProps}
      >
        {children.length > 0 ? (
          <button
            className="h-5 w-5 shrink-0 text-sm leading-caption text-neutral-400 hover:text-neutral-700"
            aria-label={expanded ? t('treeCollapse', node.title) : t('treeExpand', node.title)}
            aria-expanded={expanded}
            onClick={() => onToggleExpand(node.id)}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}
        {isEditing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2">
            <span className="h-3.5 w-3.5 shrink-0" />
            <InlineRename
              value={editing.title}
              ariaLabel={t('treeMenuRename')}
              showCancel={editing.created === true}
              onCommit={(title) => void commitEdit({
                id: node.id,
                mode: 'rename',
                title,
                created: editing.created,
              })}
              onCancel={() => void cancelEdit({
                id: node.id,
                mode: 'rename',
                title: editing.title,
                created: editing.created,
              })}
            />
          </div>
        ) : (
          <label className={`flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 ${checkedIds.has(node.id) && move !== undefined && !move.disabled && !isImmutableFolder(node) ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              aria-label={node.title}
              checked={checkedIds.has(node.id)}
              onChange={() => onToggle(node.id)}
              className="h-3.5 w-3.5 shrink-0"
            />
            <span className="truncate">{node.title}</span>
            {dropTargetId === node.id && <span className="ml-auto shrink-0 text-xs font-medium text-index-accent">{t('moveDropHere')}</span>}
            <span className="ml-auto shrink-0 text-sm leading-caption text-neutral-400">{countBookmarks(node)}</span>
          </label>
        )}
      </div>
      {expanded && children.map((child) => (
        <Row
          key={child.id}
          node={child}
          depth={depth + 1}
          checkedIds={checkedIds}
          onToggle={onToggle}
          selectedBookmarkIds={selectedBookmarkIds}
          onToggleBookmark={onToggleBookmark}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
          showBookmarks={showBookmarks}
          edit={edit}
          editing={editing}
          setEditing={setEditing}
          openMenu={openMenu}
          commitEdit={commitEdit}
          cancelEdit={cancelEdit}
          move={move}
          dropTargetId={dropTargetId}
          dragProps={dragProps}
        />
      ))}
    </div>
  )
}

function ContextMenu({
  menu,
  onClose,
  onAction,
}: {
  menu: MenuState
  onClose: () => void
  onAction: (action: 'new-folder' | 'rename' | 'edit' | 'delete') => void
}) {
  const menuId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const isFolder = menu.node.url === undefined
  const immutable = isFolder && isImmutableFolder(menu.node)

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    function onPointer(event: MouseEvent): void {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [onClose])

  const itemClass =
    'flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-sm leading-caption text-index-ink hover:bg-index-accent-soft disabled:cursor-not-allowed disabled:text-index-faint disabled:hover:bg-transparent'

  return (
    <div
      ref={ref}
      id={menuId}
      role="menu"
      data-testid="bookmark-tree-menu"
      className="fixed z-50 min-w-40 rounded-index border border-index-line bg-index-surface py-1 shadow-[var(--index-shadow-soft)]"
      style={{ left: menu.x, top: menu.y }}
    >
      {isFolder && (
        <button type="button" role="menuitem" className={itemClass} onClick={() => onAction('new-folder')}>
          {t('treeMenuNewFolder')}
        </button>
      )}
      {isFolder ? (
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          disabled={immutable}
          onClick={() => onAction('rename')}
        >
          {t('treeMenuRename')}
        </button>
      ) : (
        <button type="button" role="menuitem" className={itemClass} onClick={() => onAction('edit')}>
          {t('treeMenuEdit')}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={`${itemClass} text-red-700 hover:bg-red-50 disabled:text-index-faint`}
        disabled={immutable}
        onClick={() => onAction('delete')}
      >
        {t('treeMenuDelete')}
      </button>
    </div>
  )
}

export function BookmarkTree({
  nodes,
  checkedIds,
  onToggle,
  selectedBookmarkIds,
  onToggleBookmark,
  expandedIds,
  onToggleExpand,
  showBookmarks = false,
  edit,
  move,
}: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [draggingIds, setDraggingIds] = useState<string[] | null>(null)
  const dragSession = useRef<string[] | null>(null)
  const hoverTarget = useRef<string | null>(null)
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragPreview = useRef<HTMLDivElement | null>(null)

  function clearHover(): void {
    if (expandTimer.current !== null) clearTimeout(expandTimer.current)
    expandTimer.current = null
    hoverTarget.current = null
    setDropTargetId(null)
  }

  function clearDrag(): void {
    clearHover()
    dragSession.current = null
    setDraggingIds(null)
    dragPreview.current?.remove()
    dragPreview.current = null
  }

  useEffect(() => {
    if (move === undefined || move.disabled || editing !== null) clearDrag()
  }, [move?.disabled, move === undefined, editing])

  useEffect(() => () => {
    if (expandTimer.current !== null) clearTimeout(expandTimer.current)
    dragPreview.current?.remove()
  }, [])

  function dragProps(node: BookmarkNode, selected: boolean, isEditing: boolean): HTMLAttributes<HTMLDivElement> {
    const draggable = move !== undefined && !move.disabled && selected
      && !isEditing && editing === null && !isImmutableFolder(node)
    const validTarget = (): boolean => move !== undefined && !move.disabled && editing === null
      && dragSession.current !== null && node.url === undefined
      && move.canDrop(dragSession.current, node.id)
    return {
      draggable,
      onDragStart: (event) => {
        if (!draggable || move === undefined) {
          event.preventDefault()
          return
        }
        event.stopPropagation()
        clearDrag()
        setMenu(null)
        const ids = [...move.nodeIds]
        dragSession.current = ids
        setDraggingIds(ids)
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-reshelve-bookmark-ids', JSON.stringify(ids))
        const preview = document.createElement('div')
        preview.textContent = t('moveDragCount', String(ids.length))
        preview.className = 'fixed -left-[10000px] top-0 rounded-index border border-index-accent bg-index-accent-soft px-3 py-2 text-sm font-semibold text-index-ink shadow-lg'
        document.body.appendChild(preview)
        dragPreview.current = preview
        event.dataTransfer.setDragImage(preview, 12, 12)
      },
      onDragOver: (event) => {
        event.stopPropagation()
        scrollWhileDragging(event)
        if (!validTarget()) {
          event.dataTransfer.dropEffect = 'none'
          clearHover()
          return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        if (hoverTarget.current === node.id) return
        clearHover()
        hoverTarget.current = node.id
        setDropTargetId(node.id)
        if (!expandedIds.has(node.id) && (node.children?.length ?? 0) > 0) {
          expandTimer.current = setTimeout(() => {
            expandTimer.current = null
            if (hoverTarget.current === node.id) onToggleExpand(node.id)
          }, 650)
        }
      },
      onDragLeave: (event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        if (hoverTarget.current === node.id) clearHover()
      },
      onDrop: (event) => {
        event.stopPropagation()
        if (!validTarget()) {
          clearDrag()
          return
        }
        event.preventDefault()
        const ids = dragSession.current!
        clearDrag()
        move!.onMove(ids, node.id)
      },
      onDragEnd: clearDrag,
    }
  }

  function scrollWhileDragging(event: DragEvent<HTMLDivElement>): void {
    if (dragSession.current === null) return
    const viewport = event.currentTarget.closest<HTMLElement>('[data-testid="bookmark-workspace-viewport"]')
    if (viewport === null) return
    const { top, bottom } = viewport.getBoundingClientRect()
    if (bottom <= top) return
    if (event.clientY < top + 32) viewport.scrollTop -= 16
    else if (event.clientY > bottom - 32) viewport.scrollTop += 16
  }

  function openMenu(event: ReactMouseEvent, node: BookmarkNode): void {
    if (edit === undefined) return
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, node })
  }

  async function cancelEdit(state: EditState): Promise<void> {
    if (edit === undefined) return
    setEditing(null)
    if (state.mode === 'rename' && state.created === true) {
      await edit.onDiscardNewFolder(state.id)
    }
  }

  async function commitEdit(state: EditState): Promise<void> {
    if (edit === undefined) return
    if (state.mode === 'rename') {
      const title = state.title.trim()
      if (title === '') {
        await cancelEdit(state)
        return
      }
      const node = findNode(nodes, state.id)
      if (node !== null && node.title === title) {
        setEditing(null)
        return
      }
      const ok = await edit.onRename(state.id, title)
      if (ok) setEditing(null)
      return
    }
    const title = state.title.trim()
    const url = state.url.trim()
    if (title === '' || url === '') {
      setEditing(null)
      return
    }
    const node = findNode(nodes, state.id)
    if (node !== null && node.title === title && node.url === url) {
      setEditing(null)
      return
    }
    const ok = await edit.onEditBookmark(state.id, title, url)
    if (ok) setEditing(null)
  }

  async function runMenuAction(action: 'new-folder' | 'rename' | 'edit' | 'delete'): Promise<void> {
    if (edit === undefined || menu === null) return
    const { node } = menu
    setMenu(null)
    if (action === 'new-folder') {
      edit.onEnsureExpanded(node.id)
      const createdId = await edit.onCreateFolder(node.id)
      if (createdId !== null) {
        edit.onEnsureExpanded(node.id)
        setEditing({
          id: createdId,
          mode: 'rename',
          title: t('treeNewFolderDefault'),
          created: true,
        })
      }
      return
    }
    if (action === 'rename') {
      setEditing({ id: node.id, mode: 'rename', title: node.title })
      return
    }
    if (action === 'edit') {
      setEditing({ id: node.id, mode: 'bookmark', title: node.title, url: node.url ?? '' })
      return
    }
    await edit.onDelete(node)
    setEditing((current) => (current?.id === node.id ? null : current))
  }

  const shared: Omit<RowShared, 'depth'> = {
    checkedIds,
    onToggle,
    selectedBookmarkIds,
    onToggleBookmark,
    expandedIds,
    onToggleExpand,
    showBookmarks,
    edit,
    editing,
    setEditing,
    openMenu,
    commitEdit,
    cancelEdit,
    move,
    dropTargetId,
    dragProps,
  }


  return (
    <div className="text-base leading-body">
      <span className="sr-only" role="status">{draggingIds === null ? '' : t('moveDragCount', String(draggingIds.length))}</span>
      {topLevelNodes(nodes).map((node) => (
        <Row key={node.id} node={node} depth={0} {...shared} />
      ))}
      {menu !== null && edit !== undefined && (
        <ContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onAction={(action) => void runMenuAction(action)}
        />
      )}
    </div>
  )
}

function findNode(nodes: BookmarkNode[], id: string): BookmarkNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const hit = findNode(node.children ?? [], id)
    if (hit !== null) return hit
  }
  return null
}
