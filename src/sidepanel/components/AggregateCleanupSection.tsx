import { useEffect, useMemo, useState } from 'react'
import { bookmarksMatchingContent } from '@/core/cleanup'
import { plural, t } from '@/i18n'
import { CheckCircleIcon, ChevronDownIcon } from './icons'
import { useStore } from '../store'

export function AggregateCleanupSection() {
  const { cleanupScan, busy, undoAvailable, runAggregate } = useStore()
  const [query, setQuery] = useState('')
  const [folderTitle, setFolderTitle] = useState('')
  const [parentId, setParentId] = useState<string | null>(cleanupScan?.scopeRootIds[0] ?? null)
  const [parentText, setParentText] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [parentPickerOpen, setParentPickerOpen] = useState(false)
  const [parentQuery, setParentQuery] = useState('')
  const [activeParentIndex, setActiveParentIndex] = useState<number | null>(null)

  const matches = useMemo(
    () => bookmarksMatchingContent(cleanupScan?.items ?? [], query),
    [cleanupScan, query],
  )
  const matchKey = matches.map((item) => item.id).join('\u0000')
  const folders = useMemo(
    () => (cleanupScan?.folders ?? []).filter((folder) => folder.title.trim() !== ''),
    [cleanupScan],
  )
  const folderOptions = useMemo(
    () => folders.map((folder) => ({
      folder,
      label: [...folder.path, folder.title].filter((part) => part !== '').join(' / '),
    })),
    [folders],
  )
  const filteredFolderOptions = useMemo(() => {
    const needle = parentQuery.trim().toLocaleLowerCase()
    if (needle === '') return folderOptions
    return folderOptions.filter((option) => option.label.toLocaleLowerCase().includes(needle))
  }, [folderOptions, parentQuery])
  const selectedParentLabel = parentId === null
    ? parentText
    : folderOptions.find((option) => option.folder.id === parentId)?.label ?? parentText

  const openParentPicker = (): void => {
    if (parentPickerOpen) return
    setParentQuery('')
    setActiveParentIndex(null)
    setParentPickerOpen(true)
  }

  const chooseParent = (id: string): void => {
    const option = folderOptions.find((entry) => entry.folder.id === id)
    if (option === undefined) return
    setParentId(id)
    setParentText(option.label)
    setParentPickerOpen(false)
    setParentQuery('')
    setActiveParentIndex(null)
  }

  const commitParentInput = (value: string): void => {
    const text = value.trim()
    if (text !== '') {
      const exact = folderOptions.find((option) => option.label === text)
      if (exact !== undefined) {
        chooseParent(exact.folder.id)
        return
      }
      setParentId(null)
      setParentText(text)
    }
    setParentPickerOpen(false)
    setParentQuery('')
    setActiveParentIndex(null)
  }

  useEffect(() => {
    setSelected(new Set(matches.map((item) => item.id)))
  }, [matchKey])

  useEffect(() => {
    if (parentId === null) return
    const option = folderOptions.find((entry) => entry.folder.id === parentId)
    if (option !== undefined) {
      setParentText(option.label)
      return
    }
    const fallback = folderOptions.find((entry) =>
      cleanupScan?.scopeRootIds.includes(entry.folder.id)) ?? folderOptions[0]
    setParentId(fallback?.folder.id ?? null)
    setParentText(fallback?.label ?? '')
  }, [cleanupScan, folderOptions, parentId])

  if (cleanupScan === null) return null

  const selectedCount = selected.size
  const manualPath = parentId === null
    ? parentText.split('/').map((part) => part.trim()).filter((part) => part !== '')
    : []
  const canRun = selectedCount > 0
    && (parentId !== null || manualPath.length > 0)
    && folderTitle.trim() !== ''
    && busy === null

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-neutral-500">{t('cleanupAggregateExplain')}</p>

      <label className="block space-y-1 text-xs font-medium text-neutral-700">
        <span>{t('cleanupAggregateQueryLabel')}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('cleanupAggregateQueryPlaceholder')}
          className="w-full rounded-md border border-neutral-300 px-2.5 py-2 text-sm font-normal text-neutral-800 outline-none transition-colors duration-150 placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-1 focus:ring-neutral-300 motion-reduce:transition-none"
        />
      </label>

      {query.trim() !== '' && matches.length === 0 && (
        <p className="rounded-md bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-500">
          {t('cleanupAggregateNoMatches')}
        </p>
      )}


      {matches.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-500">
              {t('cleanupAggregateMatchCount', String(matches.length), String(selectedCount))}
            </p>
            <button
              type="button"
              className="cursor-pointer rounded px-1.5 py-1 text-xs font-medium text-neutral-600 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 motion-reduce:transition-none"
              onClick={() => setSelected(
                selectedCount === matches.length
                  ? new Set()
                  : new Set(matches.map((item) => item.id)),
              )}
            >
              {selectedCount === matches.length ? t('cleanupAggregateClearAll') : t('cleanupAggregateSelectAll')}
            </button>
          </div>

          <ul aria-label={t('cleanupAggregateMatchListLabel')} className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-1">
            {matches.map((item) => (
              <li key={item.id} className="rounded px-2 py-1.5 hover:bg-neutral-50">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    checked={selected.has(item.id)}
                    aria-label={t('cleanupAggregateSelectItem', item.title.trim() === '' ? item.url : item.title)}
                    onChange={() => {
                      const next = new Set(selected)
                      if (next.has(item.id)) next.delete(item.id)
                      else next.add(item.id)
                      setSelected(next)
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-neutral-700">
                      {item.title.trim() === '' ? item.url : item.title}
                    </span>
                    <span className="block break-all text-xs leading-snug text-neutral-400">{item.url}</span>
                    <span className="block truncate text-xs text-neutral-400">/{item.currentPath.join('/')}/</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="grid gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <label className="block space-y-1 text-xs font-medium text-neutral-700">
              <span>{t('cleanupAggregateFolderLabel')}</span>
              <input
                value={folderTitle}
                onChange={(event) => setFolderTitle(event.target.value)}
                placeholder={t('cleanupAggregateFolderPlaceholder')}
                className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-2 text-sm font-normal text-neutral-800 outline-none transition-colors duration-150 placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-1 focus:ring-neutral-300 motion-reduce:transition-none"
              />
            </label>

            <label className="block space-y-1 text-xs font-medium text-neutral-700">
              <span>{t('cleanupAggregateParentLabel')}</span>
              <div className="relative">
                <input
                  role="combobox"
                  aria-label={t('cleanupAggregateParentLabel')}
                  aria-autocomplete="list"
                  aria-expanded={parentPickerOpen}
                  aria-controls="cleanup-aggregate-parent-listbox"
                  {...(parentPickerOpen && activeParentIndex !== null
                    && filteredFolderOptions[activeParentIndex] !== undefined
                    ? { 'aria-activedescendant': `cleanup-aggregate-parent-option-${activeParentIndex}` }
                    : {})}
                  autoComplete="off"
                  value={parentPickerOpen ? parentQuery : selectedParentLabel}
                  placeholder={t('cleanupAggregateParentSearchPlaceholder')}
                  onFocus={openParentPicker}
                  onClick={openParentPicker}
                  onBlur={() => commitParentInput(parentQuery)}
                  onChange={(event) => {
                    if (!parentPickerOpen) openParentPicker()
                    setParentQuery(event.target.value)
                    setActiveParentIndex(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      if (!parentPickerOpen) openParentPicker()
                      else setActiveParentIndex((index) =>
                        Math.min((index ?? -1) + 1, Math.max(filteredFolderOptions.length - 1, 0)))
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setActiveParentIndex((index) =>
                        index === null
                          ? Math.max(filteredFolderOptions.length - 1, 0)
                          : Math.max(index - 1, 0))
                    } else if (event.key === 'Enter' && parentPickerOpen) {
                      event.preventDefault()
                      const option = activeParentIndex === null
                        ? undefined
                        : filteredFolderOptions[activeParentIndex]
                      if (option !== undefined) chooseParent(option.folder.id)
                      else commitParentInput(parentQuery)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setParentPickerOpen(false)
                      setParentQuery('')
                      setActiveParentIndex(null)
                    }
                  }}
                  className="w-full rounded-md border border-neutral-300 bg-white py-2 pl-2.5 pr-8 text-sm font-normal text-neutral-800 outline-none transition-colors duration-150 placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-1 focus:ring-neutral-300 motion-reduce:transition-none"
                />
                <ChevronDownIcon
                  className={`pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-neutral-400 transition-transform duration-150 motion-reduce:transition-none ${parentPickerOpen ? 'rotate-180' : ''}`}
                />
                {parentPickerOpen && (
                  <ul
                    id="cleanup-aggregate-parent-listbox"
                    role="listbox"
                    className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white p-1 shadow-lg"
                  >
                    {filteredFolderOptions.length === 0 ? (
                      <li
                        role="option"
                        aria-disabled="true"
                        className="px-2 py-1.5 text-xs font-normal text-neutral-500"
                      >
                        {parentQuery.trim() === ''
                          ? t('cleanupAggregateParentNoMatches')
                          : t('cleanupAggregateParentUseTyped')}
                      </li>
                    ) : filteredFolderOptions.map((option, index) => {
                      const chosen = option.folder.id === parentId
                      const active = index === activeParentIndex
                      return (
                        <li
                          key={option.folder.id}
                          id={`cleanup-aggregate-parent-option-${index}`}
                          role="option"
                          aria-selected={chosen}
                          className={[
                            'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-normal',
                            active ? 'bg-blue-50 text-neutral-900' : 'text-neutral-700 hover:bg-neutral-50',
                          ].join(' ')}
                          onMouseEnter={() => setActiveParentIndex(index)}
                          onMouseDown={(event) => {
                            event.preventDefault()
                            chooseParent(option.folder.id)
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{option.label}</span>
                          {chosen && <CheckCircleIcon className="h-3.5 w-3.5 shrink-0 text-blue-600" />}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
              <span className="block text-xs font-normal leading-relaxed text-neutral-500">
                {t('cleanupAggregateParentHint')}
              </span>
            </label>
          </div>
        </>
      )}

      {matches.length > 0 && (
        <div className="sticky -bottom-4 -mx-4 -mb-4 space-y-2 border-t border-neutral-200 bg-white px-4 pb-4 pt-3">
          {undoAvailable && (
            <p className="text-xs leading-relaxed text-amber-700">{t('cleanupOverwriteUndoWarning')}</p>
          )}
          <button
            type="button"
            className="w-full cursor-pointer rounded-md bg-neutral-800 py-2 text-base leading-body font-medium text-white transition-colors duration-150 hover:enabled:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
            disabled={!canRun}
            onClick={() => void runAggregate({
              bookmarkIds: [...selected],
              destination: parentId === null
                ? { kind: 'path', segments: manualPath }
                : { kind: 'existing', folderId: parentId },
              folderTitle: folderTitle.trim(),
            })}
          >
            {plural(selectedCount, 'cleanupAggregateRunOne', 'cleanupAggregateRunOther', String(selectedCount))}
          </button>
        </div>
      )}
    </div>
  )
}
