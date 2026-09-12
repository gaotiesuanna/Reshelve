import {
  EMPTY_EDITS,
  type StructureCheckpoint,
  type StructureDraft,
  type StructureEdits,
  type StructureWorkflowState,
} from '@/core/structure'
import type { TaskRecord } from './events'
import type { TaskStorage } from './task-journal'

/**
 * 结构工作流的全部状态迁移与对账，只此一家。
 *
 * 以前协议摊在四处：worker 在两个点手写 checkpoint JSON（classify_structure 开跑前、
 * analyze 产出结构后）、侧栏在编辑时自己拼 JSON 存回来、init() 再拿任务记录与
 * checkpoint 的 draft.id 互相对账。顺序规则只活在注释与接线测试里——漏一步的代价是
 * 真实数据：classify 开跑前没落盘，SW 一回收，用户的编辑就没了（编辑只存在于
 * checkpoint 里）。
 *
 * 收进来之后：面板只见意图（save/clear/get 一次对账后的答案），checkpoint JSON、
 * state 字段、updatedAt、「跟最新终态比是不是过期」全是这里的实现细节。
 */
const STRUCTURE_CHECKPOINT_KEY = 'reshelve:structure-checkpoint'

/**
 * 终态是否已把工作流消费掉：done 且成功的**任何**产物都算——apply 落了地、
 * 另一份结构设计产出了新方案，都说明这个 checkpoint 不再是「等着用户确认的那份」。
 * 唯一的例外是终态恰好是同一份结构设计（面板在确认页关掉后重开，preserve）。
 */
function consumedFreshDesign(record: TaskRecord | null, checkpoint: StructureCheckpoint): boolean {
  if (record === null || record.status !== 'done') return false
  const result = record.result
  if (result === undefined || !result.ok) return false
  return !(result.kind === 'analyze' && result.outcome === 'structure' && result.draft.id === checkpoint.draft.id)
}

export function createStructureWorkflow(storage: TaskStorage) {
  async function write(checkpoint: StructureCheckpoint): Promise<void> {
    await storage.set(STRUCTURE_CHECKPOINT_KEY, checkpoint)
  }

  async function read(): Promise<StructureCheckpoint | null> {
    return await storage.get<StructureCheckpoint>(STRUCTURE_CHECKPOINT_KEY)
  }

  return {
    /** analyze 产出了结构设计：等待确认，编辑尚空。 */
    async recordDesign(draft: StructureDraft): Promise<void> {
      await write({ draft, edits: EMPTY_EDITS, state: 'awaiting_confirmation', updatedAt: Date.now() })
    },

    /** 用户在结构页继续编辑：状态不变，编辑随写随存。 */
    async saveEdits(draft: StructureDraft, edits: StructureEdits): Promise<void> {
      await write({ draft, edits, state: 'awaiting_confirmation', updatedAt: Date.now() })
    },

    /**
     * 用户确认了结构、分类要开跑：**必须**在 handle 之前落盘。
     * 这条顺序是本模块存在的理由——分类途中 SW 被回收时，用户的编辑只存在这里。
     */
    async startClassifying(draft: StructureDraft, edits: StructureEdits): Promise<void> {
      await write({ draft, edits, state: 'classifying', updatedAt: Date.now() })
    },

    async clear(): Promise<void> {
      await storage.remove(STRUCTURE_CHECKPOINT_KEY)
    },

    /**
     * 「结构工作流现在走到哪了」——拿着最新任务记录核对新鲜度后的答案。
     *
     * awaiting_confirmation 的 checkpoint 只有在没人消费过它时才作数：终态是
     * done 且成功的别的产物（apply、另一份结构设计……），工作流已被消费，
     * 顺手清掉过期checkpoint、答 idle。失败的分类不清——草稿还活着，用户重开
     * 面板该回到结构页重按确认。
     */
    async restore(record: TaskRecord | null): Promise<StructureWorkflowState> {
      const checkpoint = await read()
      if (checkpoint === null) return { state: 'idle' }
      if (checkpoint.state === 'classifying') {
        return { state: 'classifying', draft: checkpoint.draft, edits: checkpoint.edits }
      }
      if (consumedFreshDesign(record, checkpoint)) {
        await this.clear()
        return { state: 'idle' }
      }
      return { state: 'awaiting_confirmation', draft: checkpoint.draft, edits: checkpoint.edits }
    },
  }
}

export type StructureWorkflow = ReturnType<typeof createStructureWorkflow>
