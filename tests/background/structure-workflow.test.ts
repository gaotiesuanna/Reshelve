import { describe, expect, it, vi } from 'vitest'
import { createFakeStorage } from '../fakes/fake-storage'
import { createStructureWorkflow } from '@/background/structure-workflow'
import { EMPTY_EDITS, type StructureDraft, type StructureEdits } from '@/core/structure'
import type { TaskRecord } from '@/background/events'

const draft = { id: 'draft-1' } as unknown as StructureDraft
const newerDraft = { id: 'draft-2' } as unknown as StructureDraft
const edits = {
  renames: { categoryA: 'Reading' },
  removed: ['categoryB'],
  mergedInto: { categoryB: 'categoryA' },
  added: [{ temporaryId: 'tmp:user:1', parentCategoryId: null, title: 'Tools' }],
} as unknown as StructureEdits

function record(partial: Partial<TaskRecord>): TaskRecord {
  return { id: 'task-1', kind: 'analyze', startedAt: 0, cancellable: true, events: [], ...partial } as TaskRecord
}

/** done 且成功的 analyze-structure 终态（与 task.end 存下的 Response 同形）。 */
const structureResult = (d: StructureDraft) => ({
  ok: true, kind: 'analyze', outcome: 'structure', draft: d,
}) as TaskRecord['result']

describe('structure workflow 的状态迁移', () => {
  it('recordDesign 落下 awaiting_confirmation：设计刚产出、用户还没确认', async () => {
    const workflow = createStructureWorkflow(createFakeStorage())
    await workflow.recordDesign(draft)
    await expect(workflow.restore(null)).resolves.toEqual({
      state: 'awaiting_confirmation', draft, edits: EMPTY_EDITS,
    })
  })

  it('saveEdits 只更新 edits，状态停在 awaiting_confirmation', async () => {
    const workflow = createStructureWorkflow(createFakeStorage())
    await workflow.recordDesign(draft)
    await workflow.saveEdits(draft, edits)
    await expect(workflow.restore(null)).resolves.toEqual({
      state: 'awaiting_confirmation', draft, edits,
    })
  })

  it('startClassifying 翻到 classifying：分类开跑前必须先落盘，SW 回收才不至于丢用户编辑', async () => {
    const workflow = createStructureWorkflow(createFakeStorage())
    await workflow.recordDesign(draft)
    await workflow.saveEdits(draft, edits)
    await workflow.startClassifying(draft, edits)
    await expect(workflow.restore(null)).resolves.toEqual({ state: 'classifying', draft, edits })
  })

  it('clear 之后 restore 答 idle', async () => {
    const workflow = createStructureWorkflow(createFakeStorage())
    await workflow.recordDesign(draft)
    await workflow.clear()
    await expect(workflow.restore(null)).resolves.toEqual({ state: 'idle' })
  })
})

describe('structure workflow 的 restore 对账（restore 拿着任务记录核对新鲜度）', () => {
  it('没有 checkpoint 就答 idle，任务记录无关紧要', async () => {
    const workflow = createStructureWorkflow(createFakeStorage())
    await expect(workflow.restore(record({ status: 'done', result: structureResult(draft) })))
      .resolves.toEqual({ state: 'idle' })
  })

  it('classifying 的 checkpoint 原样接回：分类中断也要把草稿和编辑还回来', async () => {
    const workflow = createStructureWorkflow(createFakeStorage())
    await workflow.startClassifying(draft, edits)
    const interrupted = record({ status: 'interrupted', kind: 'classify_structure', result: { ok: false, error: 'recycled' } as TaskRecord['result'] })
    await expect(workflow.restore(interrupted)).resolves.toEqual({ state: 'classifying', draft, edits })
  })

  it('awaiting_confirmation 且终态就是同一份结构设计：原样保留（preserve）', async () => {
    const workflow = createStructureWorkflow(createFakeStorage())
    await workflow.recordDesign(draft)
    const done = record({ status: 'done', result: structureResult(draft) })
    await expect(workflow.restore(done)).resolves.toEqual({
      state: 'awaiting_confirmation', draft, edits: EMPTY_EDITS,
    })
  })

  it('awaiting_confirmation 但终态是**另一份**结构设计：旧 checkpoint 已过期，清掉、答 idle', async () => {
    const storage = createFakeStorage()
    const workflow = createStructureWorkflow(storage)
    await workflow.recordDesign(draft)
    const done = record({ status: 'done', result: structureResult(newerDraft) })
    await expect(workflow.restore(done)).resolves.toEqual({ state: 'idle' })
    expect(await storage.get('reshelve:structure-checkpoint')).toBeNull()
  })

  it('awaiting_confirmation 但终态是别的操作（apply 等）：工作流已被消费，清掉、答 idle', async () => {
    const storage = createFakeStorage()
    const workflow = createStructureWorkflow(storage)
    await workflow.recordDesign(draft)
    const done = record({ status: 'done', kind: 'apply', result: { ok: true, kind: 'apply', result: {} } as TaskRecord['result'] })
    await expect(workflow.restore(done)).resolves.toEqual({ state: 'idle' })
    expect(await storage.get('reshelve:structure-checkpoint')).toBeNull()
  })

  it('awaiting_confirmation 而任务失败或中断：草稿还活着，保留', async () => {
    const workflow = createStructureWorkflow(createFakeStorage())
    await workflow.recordDesign(draft)
    const failed = record({ status: 'error', result: { ok: false, error: 'boom' } as TaskRecord['result'] })
    await expect(workflow.restore(failed)).resolves.toEqual({
      state: 'awaiting_confirmation', draft, edits: EMPTY_EDITS,
    })
  })

  it('失败的写不重试：半份 checkpoint 比没有更危险', async () => {
    const set = vi.fn(async () => { throw new Error('session quota exceeded') })
    const workflow = createStructureWorkflow({
      get: async () => null,
      set,
      remove: async () => {},
    })
    await expect(workflow.recordDesign(draft)).rejects.toThrow('session quota exceeded')
    expect(set).toHaveBeenCalledTimes(1)
  })
})
