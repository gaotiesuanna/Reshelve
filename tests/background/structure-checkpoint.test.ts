import { describe, expect, it, vi } from 'vitest'
import type { StructureCheckpoint } from '@/core/structure'
import { createFakeStorage } from '../fakes/fake-storage'
import {
  STRUCTURE_CHECKPOINT_KEY,
  clearStructureCheckpoint,
  readStructureCheckpoint,
  writeStructureCheckpoint,
} from '@/background/structure-checkpoint'
import type { TaskStorage } from '@/background/task-journal'

const checkpoint = {
  draft: { id: 'draft-1' },
  edits: {
    renames: { categoryA: 'Reading' },
    removed: ['categoryB'],
    mergedInto: { categoryB: 'categoryA' },
    added: [{ temporaryId: 'tmp:user:1', parentCategoryId: null, title: 'Tools' }],
  },
  state: 'awaiting_confirmation',
  updatedAt: 1_725_974_400_000,
} as unknown as StructureCheckpoint

describe('structure checkpoint storage', () => {
  it('round-trips and clears the complete checkpoint under the session key', async () => {
    const storage = createFakeStorage()

    expect(STRUCTURE_CHECKPOINT_KEY).toBe('reshelve:structure-checkpoint')

    await writeStructureCheckpoint(storage, checkpoint)
    expect(await readStructureCheckpoint(storage)).toEqual(checkpoint)

    await clearStructureCheckpoint(storage)
    expect(await readStructureCheckpoint(storage)).toBeNull()
  })

  it('does not retry a failed write with a lossy checkpoint', async () => {
    const failure = new Error('session quota exceeded')
    const set = vi.fn(async () => { throw failure })
    const storage: TaskStorage = {
      get: async () => null,
      set,
      remove: async () => {},
    }

    await expect(writeStructureCheckpoint(storage, checkpoint)).rejects.toBe(failure)
    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith(STRUCTURE_CHECKPOINT_KEY, checkpoint)
  })
})
