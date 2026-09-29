import { describe, it, expect } from 'vitest'
import { pruneSmallFolders, pruneReason } from '@/core/prune'
import type { NewFolderSpec } from '@/core/plan'
import type { EstimatedAssignment } from '@/core/structure'
import type { CategoryCandidate, Classification } from '@/core/types'

const rootId = '1'

function cand(id: string, ...path: string[]): CategoryCandidate {
  return { id, path }
}

/** 挂在范围根下的新目录。 */
function top(temporaryId: string, title: string): NewFolderSpec {
  return { temporaryId, parentId: rootId, parentTemporaryId: null, title }
}

/** 挂在同批新建目录下的新目录。 */
function child(temporaryId: string, parentTemporaryId: string, title: string): NewFolderSpec {
  return { temporaryId, parentId: null, parentTemporaryId, title }
}

/** n 个书签全部分到同一个目录，id 前缀避免跨目录撞号。 */
function into(targetCategoryId: string | null, n: number): Classification[] {
  return Array.from({ length: n }, (_, i) => ({
    bookmarkId: `${targetCategoryId}#${i}`,
    targetCategoryId,
    confidence: 0.9,
    reason: '模型判断',
    source: 'llm' as const,
  }))
}

function prune(
  input: {
    candidates: CategoryCandidate[]
    newFolders: NewFolderSpec[]
    classifications: Classification[]
    minFolderSize: number
    mergeRootTemporaryId?: string | null
  },
) {
  return pruneSmallFolders({ ...input, locale: 'zh_CN' })
}

const titles = (folders: NewFolderSpec[]): string[] => folders.map((f) => f.title)
const targetOf = (result: { classifications: Classification[] }, bookmarkId: string): string | null =>
  result.classifications.find((c) => c.bookmarkId === bookmarkId)!.targetCategoryId

describe('pruneSmallFolders', () => {
  it('用预估归属剪掉小目录时只改目标，不要求或补写分类字段', () => {
    const classifications: EstimatedAssignment[] = [
      { bookmarkId: 'a', targetCategoryId: 't1' },
      { bookmarkId: 'z1', targetCategoryId: 't9' },
      { bookmarkId: 'z2', targetCategoryId: 't9' },
      { bookmarkId: 'z3', targetCategoryId: 't9' },
    ]

    const result = pruneSmallFolders({
      candidates: [cand('t1', '01 独苗'), cand('t9', '02 其他')],
      newFolders: [top('t1', '01 独苗'), top('t9', '02 其他')],
      classifications,
      minFolderSize: 3,
      locale: 'zh_CN',
    })

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['t9'])
    expect(result.classifications).toEqual([
      { bookmarkId: 'a', targetCategoryId: 't9' },
      { bookmarkId: 'z1', targetCategoryId: 't9' },
      { bookmarkId: 'z2', targetCategoryId: 't9' },
      { bookmarkId: 'z3', targetCategoryId: 't9' },
    ])
  })

  it('分到的书签不足下限的子目录整个撤掉，书签并进父目录', () => {
    const result = prune({
      candidates: [cand('t1', '01 前端'), cand('t2', '01 前端', '01 Svelte'), cand('t3', '02 其他')],
      newFolders: [top('t1', '01 前端'), child('t2', 't1', '01 Svelte'), top('t3', '02 其他')],
      classifications: [...into('t1', 4), ...into('t2', 1), ...into('t3', 3)],
      minFolderSize: 3,
    })
    expect(titles(result.newFolders)).toEqual(['01 前端', '02 其他'])
    expect(result.candidates.map((c) => c.id)).toEqual(['t1', 't3'])
    expect(targetOf(result, 't2#0')).toBe('t1')
    expect(result.prunedTitles).toEqual(['01 Svelte'])
  })

  it('不足下限的一级目录撤掉后书签进「其他」', () => {
    const result = prune({
      candidates: [cand('t1', '01 独苗'), cand('t3', '02 其他')],
      newFolders: [top('t1', '01 独苗'), top('t3', '02 其他')],
      classifications: [...into('t1', 1), ...into('t3', 3)],
      minFolderSize: 3,
    })
    expect(titles(result.newFolders)).toEqual(['02 其他'])
    expect(targetOf(result, 't1#0')).toBe('t3')
  })

  // 子目录先撤、父目录后判，父目录吸收了子目录的书签才够数。反过来先撤父目录，
  // 子目录就没了爹，书签会掉进「其他」——同一批书签，两种结果
  it('撤掉子目录后父目录靠吸收来的书签够数，于是留下', () => {
    const result = prune({
      candidates: [cand('t1', '01 前端'), cand('t2', '01 前端', '01 Svelte'), cand('t3', '02 其他')],
      newFolders: [top('t1', '01 前端'), child('t2', 't1', '01 Svelte'), top('t3', '02 其他')],
      classifications: [...into('t1', 2), ...into('t2', 2), ...into('t3', 3)],
      minFolderSize: 3,
    })
    expect(titles(result.newFolders)).toEqual(['01 前端', '02 其他'])
    expect(targetOf(result, 't2#0')).toBe('t1')
  })

  // 撤掉它，底下那个活得好好的子目录就没有父目录可挂了
  it('还有存活子目录的父目录不撤，哪怕它自己直接收到的书签不够', () => {
    const result = prune({
      candidates: [cand('t1', '01 前端'), cand('t2', '01 前端', '01 React'), cand('t3', '02 其他')],
      newFolders: [top('t1', '01 前端'), child('t2', 't1', '01 React'), top('t3', '02 其他')],
      classifications: [...into('t2', 5), ...into('t3', 3)],
      minFolderSize: 3,
    })
    expect(titles(result.newFolders)).toEqual(['01 前端', '01 React', '02 其他'])
  })

  // 用户自己建的目录里只有一个书签是他的事，整理不该顺手把它拆了
  it('不在本批新建名单里的已有目录一律不撤', () => {
    const result = prune({
      candidates: [cand('99', '我的收藏'), cand('t3', '02 其他')],
      newFolders: [top('t3', '02 其他')],
      classifications: [...into('99', 1), ...into('t3', 3)],
      minFolderSize: 3,
    })
    expect(result.candidates.map((c) => c.id)).toEqual(['99', 't3'])
    expect(targetOf(result, '99#0')).toBe('99')
    expect(result.prunedTitles).toEqual([])
  })

  // 合并模式的容器目录是容器不是分类，它收不到书签是正常的
  it('合并模式的容器目录豁免', () => {
    const result = prune({
      candidates: [cand('t1', '01 前端'), cand('t3', '02 其他')],
      newFolders: [
        { temporaryId: 't0', parentId: rootId, parentTemporaryId: null, title: 'NiceG + b_llm' },
        { temporaryId: 't1', parentId: null, parentTemporaryId: 't0', title: '01 前端' },
        { temporaryId: 't3', parentId: null, parentTemporaryId: 't0', title: '02 其他' },
      ],
      classifications: [...into('t1', 4), ...into('t3', 3)],
      minFolderSize: 3,
      mergeRootTemporaryId: 't0',
    })
    expect(titles(result.newFolders)).toContain('NiceG + b_llm')
    expect(result.prunedTitles).toEqual([])
  })

  // 「其他」是最后的去处，它自己都不够数时没有下一站了
  it('「其他」自己不足下限时也撤掉，里面的书签保持原位', () => {
    const result = prune({
      candidates: [cand('t3', '01 其他')],
      newFolders: [top('t3', '01 其他')],
      classifications: into('t3', 1),
      minFolderSize: 3,
      })
    expect(result.newFolders).toEqual([])
    expect(targetOf(result, 't3#0')).toBeNull()
  })

  // 「其他」要最后判：先判它就会在别的目录把书签并进来之前被误撤
  it('别的目录并进来之后「其他」才够数，于是留下', () => {
    const result = prune({
      candidates: [cand('t1', '01 独苗'), cand('t2', '02 另一个独苗'), cand('t3', '03 其他')],
      newFolders: [top('t1', '01 独苗'), top('t2', '02 另一个独苗'), top('t3', '03 其他')],
      classifications: [...into('t1', 1), ...into('t2', 1), ...into('t3', 1)],
      minFolderSize: 3,
    })
    expect(titles(result.newFolders)).toEqual(['03 其他'])
    expect(targetOf(result, 't1#0')).toBe('t3')
    expect(targetOf(result, 't2#0')).toBe('t3')
  })

  it('minFolderSize 为 1 时原样返回，等于没开这个开关', () => {
    const input = {
      candidates: [cand('t1', '01 独苗'), cand('t3', '02 其他')],
      newFolders: [top('t1', '01 独苗'), top('t3', '02 其他')],
      classifications: [...into('t1', 1), ...into('t3', 1)],
      minFolderSize: 1,
    }
    const result = prune(input)
    expect(result.candidates).toEqual(input.candidates)
    expect(result.newFolders).toEqual(input.newFolders)
    expect(result.classifications).toEqual(input.classifications)
  })

  // 结果页会把 reason 原样显示给用户，留着「模型判断」会让人以为模型选了「其他」
  it('被改判的书签重写理由，说明是目录太小并入的', () => {
    const result = prune({
      candidates: [cand('t1', '01 语音合成'), cand('t3', '02 其他')],
      newFolders: [top('t1', '01 语音合成'), top('t3', '02 其他')],
      classifications: [...into('t1', 1), ...into('t3', 3)],
      minFolderSize: 3,
    })
    const reason = result.classifications.find((c) => c.bookmarkId === 't1#0')!.reason
    expect(reason).toContain('语音合成')
    expect(reason).toContain('3')
    expect(reason).not.toContain('模型判断')
    // 编号是建树阶段的内部产物，讲给用户听时不必带上
    expect(reason).not.toContain('01 ')
  })

  it('没被改判的书签理由不动', () => {
    const result = prune({
      candidates: [cand('t1', '01 前端'), cand('t3', '02 其他')],
      newFolders: [top('t1', '01 前端'), top('t3', '02 其他')],
      classifications: [...into('t1', 4), ...into('t3', 3)],
      minFolderSize: 3,
    })
    expect(result.classifications.find((c) => c.bookmarkId === 't1#0')!.reason).toBe('模型判断')
  })

  it('英文分支的理由是英文', () => {
    const result = pruneSmallFolders({
      candidates: [cand('t1', '01 TTS'), cand('t3', '02 Other')],
      newFolders: [top('t1', '01 TTS'), top('t3', '02 Other')],
      classifications: [...into('t1', 1), ...into('t3', 3)],
      minFolderSize: 3,
      locale: 'en',
    })
    const reason = result.classifications.find((c) => c.bookmarkId === 't1#0')!.reason
    expect(reason).toMatch(/only 1 of the required 3/i)
    expect(reason).not.toMatch(/[一-鿿]/)
  })

  // 一个都没分到的目录本来就不会被创建（见 core/plan.ts 的 filterAccepted），
  // 但它留在 candidates 里会让「其他」的兜底判断多绕一层，一并清掉更干净
  it('一个书签都没分到的新目录也撤掉', () => {
    const result = prune({
      candidates: [cand('t1', '01 空目录'), cand('t3', '02 其他')],
      newFolders: [top('t1', '01 空目录'), top('t3', '02 其他')],
      classifications: into('t3', 3),
      minFolderSize: 3,
    })
    expect(titles(result.newFolders)).toEqual(['02 其他'])
  })

  it('子目录撤进「其他」后「其他」自己也不够数，级联撤掉，书签退回原位', () => {
    const candidates = [
      { id: 't1', path: ['01 语音识别'] },
      { id: 't9', path: ['其他'] },
    ]
    const newFolders = [top('t1', '01 语音识别'), top('t9', '其他')]
    const classifications = [
      { bookmarkId: 'a', targetCategoryId: 't1', confidence: 0.9, reason: 'r', source: 'llm' as const },
      { bookmarkId: 'b', targetCategoryId: 't1', confidence: 0.9, reason: 'r', source: 'llm' as const },
    ]
    const result = pruneSmallFolders({
      candidates, newFolders, classifications, minFolderSize: 3, locale: 'zh_CN',
    })

    expect(result.newFolders).toEqual([])
    expect(targetOf(result, 'a')).toBeNull()
    expect(targetOf(result, 'b')).toBeNull()
  })
})

describe('pruneReason 已导出', () => {
  it('并入某处与不再建这个目录，两种说法都双语', () => {
    expect(pruneReason('zh_CN', '语音识别', 2, 3, '语音识别与声纹')).toContain('已并入「语音识别与声纹」')
    expect(pruneReason('zh_CN', '语音识别', 2, 3, null)).toContain('不再建这个目录')
    expect(/[一-鿿]/.test(pruneReason('en', 'ASR', 2, 3, 'Speech'))).toBe(false)
  })
})
