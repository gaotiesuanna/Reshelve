import { describe, it, expect } from 'vitest'
import {
  applyStructureEditsToDraft,
  bookmarkFingerprint,
  buildStructureView,
  estimateAssignments,
  sameBookmarkFingerprint,
  validateStructureEdits,
} from '@/core/structure'
import type { StructureDraft, StructureEdits } from '@/core/structure'

describe('structure draft helpers', () => {
  it('fingerprint ignores scan order but detects URL changes', () => {
    const a = bookmarkFingerprint([
      { id: 'b2', url: 'https://two.test' },
      { id: 'b1', url: 'https://one.test' },
    ])
    expect(a).toEqual([
      { id: 'b1', url: 'https://one.test' },
      { id: 'b2', url: 'https://two.test' },
    ])
    expect(sameBookmarkFingerprint(a, [...a].reverse())).toBe(true)
    expect(sameBookmarkFingerprint(a, [{ id: 'b1', url: 'https://changed.test' }, a[1]!])).toBe(false)
  })

  it('estimates only a unique normalized candidate path', () => {
    expect(estimateAssignments(
      [{ bookmarkId: 'b1', primaryTopic: '代码', secondaryTopic: 'React' }],
      [{ id: 'c1', path: ['01 代码', '01 React'] }],
    )).toEqual([{ bookmarkId: 'b1', targetCategoryId: 'c1' }])
  })

  it('does not estimate ambiguous or missing candidate paths', () => {
    expect(estimateAssignments(
      [
        { bookmarkId: 'ambiguous', primaryTopic: 'Code', secondaryTopic: null },
        { bookmarkId: 'missing', primaryTopic: 'Research', secondaryTopic: null },
      ],
      [
        { id: 'c1', path: ['01 Code'] },
        { id: 'c2', path: ['02 code'] },
      ],
    )).toEqual([
      { bookmarkId: 'ambiguous', targetCategoryId: null },
      { bookmarkId: 'missing', targetCategoryId: null },
    ])
  })
})
function makeStructureDraft(overrides: Partial<StructureDraft> = {}): StructureDraft {
  return {
    id: 'draft-1',
    createdAt: 1,
    scopeRootIds: ['scope'],
    destinationRootId: 'destination',
    locale: 'en',
    llm: { baseUrl: 'https://llm.test', model: 'test-model' },
    totalBookmarks: 2,
    bookmarkFingerprint: [
      { id: 'a', url: 'https://a.test' },
      { id: 'b', url: 'https://b.test' },
    ],
    candidates: [
      { id: 'topA', path: ['01 Code'] },
      { id: 'childA', path: ['01 Code', '01 React'] },
      { id: 'topB', path: ['02 Reading'] },
      { id: 'fallback', path: ['03 Other'] },
    ],
    newFolders: [
      { temporaryId: 'topA', parentId: 'destination', parentTemporaryId: null, title: '01 Code' },
      { temporaryId: 'childA', parentId: null, parentTemporaryId: 'topA', title: '01 React' },
      { temporaryId: 'topB', parentId: 'destination', parentTemporaryId: null, title: '02 Reading' },
      { temporaryId: 'fallback', parentId: 'destination', parentTemporaryId: null, title: '03 Other' },
    ],
    renameFolders: [],
    folderMoves: [],
    mergeRoot: null,
    tags: [
      { bookmarkId: 'a', primaryTopic: 'Code', secondaryTopic: null },
      { bookmarkId: 'b', primaryTopic: 'Reading', secondaryTopic: null },
    ],
    sourceTags: [
      { bookmarkId: 'a', primaryTopic: 'Code', secondaryTopic: null },
      { bookmarkId: 'b', primaryTopic: 'Reading', secondaryTopic: null },
    ],
    estimatedAssignments: [
      { bookmarkId: 'a', targetCategoryId: 'topA' },
      { bookmarkId: 'b', targetCategoryId: 'topB' },
    ],
    rootLevel: 0,
    deepenCap: 2,
    warnings: [],
    rewriteGithubTitles: false,
    ...overrides,
  }
}

const editsWith = (overrides: Partial<StructureEdits>): StructureEdits => ({
  renames: {}, removed: [], mergedInto: {}, added: [], ...overrides,
})

describe('applyStructureEditsToDraft', () => {
  it('compiles rename, subtree removal, same-parent merge, and a user top-level node', () => {
    const draft = makeStructureDraft()
    const original = structuredClone(draft)
    const result = applyStructureEditsToDraft(draft, {
      renames: { topA: 'Engineering' },
      removed: ['childA', 'topB'],
      mergedInto: { topB: 'fallback' },
      added: [{ temporaryId: 'tmp:user:123', parentCategoryId: null, title: 'Research' }],
    }, 'en')

    expect(result.validation.errors).toEqual([])
    expect(result.candidates.map((candidate) => candidate.path)).toEqual([
      ['01 Engineering'],
      ['02 Research'],
      ['03 Other'],
    ])
    expect(result.estimatedAssignments).toEqual([
      { bookmarkId: 'a', targetCategoryId: 'topA' },
      { bookmarkId: 'b', targetCategoryId: 'fallback' },
    ])
    expect(result.newFolders).toEqual([
      { temporaryId: 'topA', parentId: 'destination', parentTemporaryId: null, title: '01 Engineering' },
      { temporaryId: 'tmp:user:123', parentId: 'destination', parentTemporaryId: null, title: '02 Research' },
      { temporaryId: 'fallback', parentId: 'destination', parentTemporaryId: null, title: '03 Other' },
    ])
    expect(draft).toEqual(original)
  })

  it('resolves merge chains before removing their sources', () => {
    const draft = makeStructureDraft({
      candidates: [
        { id: 'a', path: ['01 A'] },
        { id: 'b', path: ['02 B'] },
        { id: 'c', path: ['03 C'] },
      ],
      newFolders: [],
      estimatedAssignments: [{ bookmarkId: 'bookmark', targetCategoryId: 'a' }],
    })
    const result = applyStructureEditsToDraft(draft, editsWith({
      removed: ['a', 'b'],
      mergedInto: { a: 'b', b: 'c' },
    }), 'en')

    expect(result.validation.errors).toEqual([])
    expect(result.candidates).toEqual([{ id: 'c', path: ['01 C'] }])
    expect(result.estimatedAssignments).toEqual([
      { bookmarkId: 'bookmark', targetCategoryId: 'c' },
    ])
  })

  it('synchronizes parent and child renames with folder specs and merge-root metadata', () => {
    const draft = makeStructureDraft({
      mergeRoot: {
        temporaryId: 'tmp:root', title: 'Workspace',
        sourceRootIds: ['source'], sourceTitles: ['Source'],
      },
      newFolders: [
        { temporaryId: 'tmp:root', parentId: 'destination', parentTemporaryId: null, title: 'Workspace' },
        { temporaryId: 'topA', parentId: null, parentTemporaryId: 'tmp:root', title: '01 Code' },
        { temporaryId: 'childA', parentId: null, parentTemporaryId: 'topA', title: '01 React' },
        { temporaryId: 'topB', parentId: null, parentTemporaryId: 'tmp:root', title: '02 Reading' },
        { temporaryId: 'fallback', parentId: null, parentTemporaryId: 'tmp:root', title: '03 Other' },
      ],
      renameFolders: [
        { folderId: 'topA', oldTitle: 'Code', newTitle: '01 Code' },
        { folderId: 'childA', oldTitle: 'React', newTitle: '01 React' },
      ],
    })
    const result = applyStructureEditsToDraft(draft, editsWith({
      renames: { 'tmp:root': 'Library', topA: 'Engineering', childA: 'Frontend' },
      added: [{ temporaryId: 'tmp:user:research', parentCategoryId: null, title: 'Research' }],
    }), 'en')

    expect(result.mergeRoot).toEqual({
      temporaryId: 'tmp:root', title: 'Library',
      sourceRootIds: ['source'], sourceTitles: ['Source'],
    })
    expect(result.candidates.slice(0, 2)).toEqual([
      { id: 'topA', path: ['01 Engineering'] },
      { id: 'childA', path: ['01 Engineering', '01 Frontend'] },
    ])
    expect(result.newFolders[0]).toEqual({
      temporaryId: 'tmp:root', parentId: 'destination', parentTemporaryId: null, title: 'Library',
    })
    expect(result.newFolders.filter((folder) => ['topA', 'childA'].includes(folder.temporaryId))).toEqual([
      { temporaryId: 'topA', parentId: null, parentTemporaryId: 'tmp:root', title: '01 Engineering' },
      { temporaryId: 'childA', parentId: null, parentTemporaryId: 'topA', title: '01 Frontend' },
    ])
    expect(result.renameFolders).toEqual([
      { folderId: 'topA', oldTitle: 'Code', newTitle: '01 Engineering' },
      { folderId: 'childA', oldTitle: 'React', newTitle: '01 Frontend' },
    ])
    expect(result.newFolders.find((folder) => folder.temporaryId === 'tmp:user:research'))
      .toEqual({
        temporaryId: 'tmp:user:research', parentId: null,
        parentTemporaryId: 'tmp:root', title: '03 Research',
      })
  })

  it('maps estimates in a plainly deleted subtree to null', () => {
    const draft = makeStructureDraft({
      estimatedAssignments: [{ bookmarkId: 'a', targetCategoryId: 'childA' }],
    })
    const result = applyStructureEditsToDraft(draft, editsWith({ removed: ['topA'] }), 'en')

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['topB', 'fallback'])
    expect(result.estimatedAssignments).toEqual([
      { bookmarkId: 'a', targetCategoryId: null },
    ])
  })

  it('inserts additions before fallback and compacts top-level and child prefixes', () => {
    const draft = makeStructureDraft({
      candidates: [
        { id: 'topA', path: ['04 Code'] },
        { id: 'childA', path: ['04 Code', '03 React'] },
        { id: 'childB', path: ['04 Code', '08 TypeScript'] },
        { id: 'topB', path: ['09 Reading'] },
        { id: 'fallback', path: ['12 Other'] },
      ],
      newFolders: [],
    })
    const result = applyStructureEditsToDraft(draft, editsWith({
      removed: ['childA'],
      added: [
        { temporaryId: 'tmp:user:research', parentCategoryId: null, title: 'Research' },
      ],
    }), 'en')

    expect(result.candidates).toEqual([
      { id: 'topA', path: ['01 Code'] },
      { id: 'childB', path: ['01 Code', '01 TypeScript'] },
      { id: 'topB', path: ['02 Reading'] },
      { id: 'tmp:user:research', path: ['03 Research'] },
      { id: 'fallback', path: ['04 Other'] },
    ])
  })

  it('deleting a newly added folder removes it from candidates and folder specs', () => {
    const result = applyStructureEditsToDraft(makeStructureDraft(), editsWith({
      added: [{ temporaryId: 'tmp:user:gone', parentCategoryId: null, title: 'Gone' }],
      removed: ['tmp:user:gone'],
    }), 'en')

    expect(result.validation.errors).toEqual([])
    expect(result.candidates.some((candidate) => candidate.id === 'tmp:user:gone')).toBe(false)
    expect(result.newFolders.some((folder) => folder.temporaryId === 'tmp:user:gone')).toBe(false)
  })

  it('allows merging an original folder into a newly added folder', () => {
    const result = applyStructureEditsToDraft(makeStructureDraft(), editsWith({
      added: [{ temporaryId: 'tmp:user:target', parentCategoryId: null, title: 'Research' }],
      removed: ['topA'],
      mergedInto: { topA: 'tmp:user:target' },
    }), 'en')

    expect(result.validation.errors).toEqual([])
    expect(result.candidates.map((candidate) => candidate.id)).toContain('tmp:user:target')
    expect(result.candidates.map((candidate) => candidate.id)).not.toContain('topA')
    expect(result.estimatedAssignments.find((assignment) => assignment.bookmarkId === 'a'))
      .toEqual({ bookmarkId: 'a', targetCategoryId: 'tmp:user:target' })
  })

  it('emits a rename operation for a user rename of a reused folder', () => {
    const draft = makeStructureDraft({
      candidates: [{ id: 'existing', path: ['01 Code'] }],
      newFolders: [],
      renameFolders: [],
      estimatedAssignments: [],
    })
    const result = applyStructureEditsToDraft(draft, editsWith({
      renames: { existing: 'Engineering' },
    }), 'en')

    expect(result.renameFolders).toEqual([{
      folderId: 'existing', oldTitle: 'Code', newTitle: '01 Engineering',
    }])
  })

  it('builds draft view counts from compiled estimated assignments', () => {
    const view = buildStructureView(makeStructureDraft(), editsWith({}), 'en')

    expect(view.map((node) => ({ id: node.id, count: node.count }))).toEqual([
      { id: 'topA', count: 1 },
      { id: 'topB', count: 1 },
      { id: 'fallback', count: 0 },
    ])
    expect(view[0]!.children).toEqual([
      { id: 'childA', title: 'React', count: 0, removable: true, children: [] },
    ])
  })
})

describe('validateStructureEdits', () => {
  function errorCodes(edits: StructureEdits, draft = makeStructureDraft()): string[] {
    return validateStructureEdits(draft, edits, 'en').errors.map((error) => error.code)
  }

  it('rejects blank names', () => {
    expect(errorCodes(editsWith({ renames: { topA: '   ' } }))).toContain('blank_name')
    expect(errorCodes(editsWith({
      added: [{ temporaryId: 'tmp:user:blank', parentCategoryId: null, title: '' }],
    }))).toContain('blank_name')
  })

  it('ignores a blank rename for a node that is removed', () => {
    expect(errorCodes(editsWith({ renames: { topA: '   ' }, removed: ['topA'] })))
      .not.toContain('blank_name')
  })

  it('rejects normalized sibling duplicates', () => {
    expect(errorCodes(editsWith({ renames: { topB: '  code ' } })))
      .toContain('duplicate_sibling_name')
  })

  it('rejects additions using the reserved fallback name', () => {
    expect(errorCodes(editsWith({
      added: [{ temporaryId: 'tmp:user:other', parentCategoryId: null, title: '01 other' }],
    }))).toContain('reserved_fallback_name')
  })

  it('rejects unknown merge endpoints', () => {
    expect(errorCodes(editsWith({ mergedInto: { missing: 'fallback' } })))
      .toContain('unknown_merge_source')
    expect(errorCodes(editsWith({ mergedInto: { topA: 'missing' } })))
      .toContain('unknown_merge_destination')
  })

  it('rejects cross-parent merges', () => {
    expect(errorCodes(editsWith({ mergedInto: { childA: 'topB' } })))
      .toContain('cross_parent_merge')
  })

  it('rejects cyclic merges', () => {
    expect(errorCodes(editsWith({ mergedInto: { topA: 'topB', topB: 'topA' } })))
      .toContain('merge_cycle')
  })

  it('rejects removing every candidate', () => {
    expect(errorCodes(editsWith({ removed: ['topA', 'topB', 'fallback'] })))
      .toContain('empty_structure')
  })

  it('rejects malformed user temporary ids', () => {
    expect(errorCodes(editsWith({
      added: [{ temporaryId: 'tmp:user:', parentCategoryId: null, title: 'Research' }],
    }))).toContain('invalid_temporary_id')
  })

  it('rejects nested additions', () => {
    expect(errorCodes(editsWith({
      added: [{
        temporaryId: 'tmp:user:nested', parentCategoryId: 'topA' as never, title: 'Nested',
      }],
    }))).toContain('nested_addition')
  })
})
