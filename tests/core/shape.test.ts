import { describe, it, expect } from 'vitest'
import { MAX_LEAF, STRETCH_LEAF, SWEET_LEAF, SHAPE_MAX_SIBLINGS } from '@/core/config'
import { deriveShape } from '@/core/shape'

describe('deriveShape', () => {
  it('书签少时一层就够，目录数按甜点 12 算', () => {
    // 123 条：按甜点 ceil(123/12)=11 个叶子、一层，每个叶子 ≈11.2 条
    const shape = deriveShape(123)
    expect(shape.depth).toBe(1)
    expect(shape.top).toBe(11)
    expect(shape.leaves).toBe(11)
    expect(shape.perLeaf).toBeCloseTo(123 / 11, 1)
  })

  it('目录数顶到同层上限后先撑大叶子，不急着分层', () => {
    // 240 条：按甜点要 20 个，超了上限 15 → 15 个叶子各装 16 条，仍在 20 以内
    const shape = deriveShape(240)
    expect(shape.depth).toBe(1)
    expect(shape.top).toBe(SHAPE_MAX_SIBLINGS)
    expect(shape.perLeaf).toBeLessThanOrEqual(STRETCH_LEAF)
  })

  it('叶子撑过 20 才加一层——深度跳变只发生在 N=301', () => {
    expect(deriveShape(300).depth).toBe(1)
    expect(deriveShape(301).depth).toBe(2)
  })

  it('两层时一级目录数不少于一层刚撑破时的数量', () => {
    const shape = deriveShape(600)
    expect(shape.depth).toBe(2)
    expect(shape.leaves).toBe(50)
    // 一层顶格是 15；floor(√50)=7、ceil(50/15)=4 都更小，取 15
    expect(shape.top).toBe(SHAPE_MAX_SIBLINGS)
  })

  it('跨过 N=301 进两层时，一级主题数不得比一层时更少', () => {
    expect(deriveShape(300)).toMatchObject({ depth: 1, top: SHAPE_MAX_SIBLINGS })
    expect(deriveShape(301)).toMatchObject({ depth: 2, top: SHAPE_MAX_SIBLINGS })
    expect(deriveShape(400)).toMatchObject({ depth: 2, top: SHAPE_MAX_SIBLINGS })
  })

  it('深度必须单调——L=91 附近曾经会「两层→三层→两层」', () => {
    // 只取 floor(√L) 时 L=91 算出 10.1 个二级、超上限退回三层，而 L=100 又回到两层。
    // 这个坑票 10 踩过一次，钉住它
    let previous = deriveShape(20).depth
    for (let n = 20; n <= 2800; n++) {
      const depth = deriveShape(n).depth
      expect(depth, `N=${n} 的深度比 N=${n - 1} 还浅`).toBeGreaterThanOrEqual(previous)
      previous = depth
    }
  })

  it('第二处跳变在 N=2701 进三层', () => {
    expect(deriveShape(2700).depth).toBe(2)
    expect(deriveShape(2701).depth).toBe(3)
  })

  it('三层的分配留空——top === 0 是调用方必须兜底的占位符，不是「零个一级目录」', () => {
    // N > 2700 才走得到这条分支（15×15=225 个叶子）。2701 条：
    // leaves = ceil(2701/12) = 226 > 225，落进三层。
    // top 留 0 是有意的占位——调用方必须把它兜底成 SHAPE_MAX_SIBLINGS，
    // 不能直接拿去当「一级目录数」用（那会让提示词写「一级目录不超过 -1 个」）。
    const shape = deriveShape(2701)
    expect(shape).toEqual({ leaves: 226, depth: 3, top: 0, perLeaf: 2701 / 226 })
  })

  it('topCap 收紧时，一层可能装不下——深度会被顶上去', () => {
    // 123 条按甜点要 11 个叶子；cap 收到 6 时 123/6 = 20.5 > 20，一层撑不下。
    // 两层的一级数不少于一层时的 top1=6，再被 cap 夹住仍是 6。
    expect(deriveShape(123, 6)).toMatchObject({ depth: 2, top: 6, leaves: 11 })
  })

  it('topCap 宽到装得下时，它只封顶一级目录数，不改变深度', () => {
    // 60 条：甜点要 5 个，cap 8 不咬合；cap 3 时 60/3 = 20，正好不超上限，仍是一层
    expect(deriveShape(60, 8)).toMatchObject({ depth: 1, top: 5 })
    expect(deriveShape(60, 3)).toMatchObject({ depth: 1, top: 3 })
  })

  it('两层布局的一级目录数必须服从 topCap，不能悄悄超发', () => {
    expect(deriveShape(600)).toMatchObject({ depth: 2, top: SHAPE_MAX_SIBLINGS })
    expect(deriveShape(600, 5)).toMatchObject({ depth: 2, top: 5 })
  })

  it('topCap 收紧时，两层的容量跟着变小，三层阈值也要提前', () => {
    // 600 条：leaves=50。默认预算下 50 ≤ 15×15=225，两层装得下。
    // cap 收到 3 时，两层的容量只剩 3×15=45，50 > 45 装不下，必须提前分三层——
    // 写死用 SHAPE_MAX_SIBLINGS 算容量的话，这里会错误地仍然吐出两层。
    expect(deriveShape(600).depth).toBe(2)
    expect(deriveShape(600, 3).depth).toBe(3)
  })

  it('零和负数不炸，返回空形状', () => {
    expect(deriveShape(0)).toEqual({ leaves: 0, depth: 0, top: 0, perLeaf: 0 })
    expect(deriveShape(-5).depth).toBe(0)
  })
})

describe('MAX_LEAF 与 STRETCH_LEAF 分家', () => {
  // 两个数一旦被合回一个，issues/38 的 D2 就白做了。这三条各钉住一个理由。
  it('验算的上限比预测的宽松线紧', () => {
    expect(MAX_LEAF).toBeLessThan(STRETCH_LEAF)
  })

  it('验算的上限就是甜点：超过甜点就该往下分', () => {
    expect(MAX_LEAF).toBe(SWEET_LEAF)
  })

  it('deriveShape 认的是 STRETCH_LEAF，不是 MAX_LEAF', () => {
    // 200 条：15 个叶子各 ≈13.3 条，已经超过 MAX_LEAF(12) 却没超 STRETCH_LEAF(20)，
    // 所以预测阶段仍是一层——「绝不因为预测就多分一层」（issues/10）。
    const shape = deriveShape(200)
    expect(shape.depth).toBe(1)
    expect(shape.perLeaf).toBeGreaterThan(MAX_LEAF)
    expect(shape.perLeaf).toBeLessThanOrEqual(STRETCH_LEAF)
  })

  it('把预测线也收到 12 会让深度跳变从 N=301 提前到 N=181', () => {
    // 这条钉的是「为什么不能只改一个数」。用 topCap 模拟不了，直接算：
    // n=181 时 wanted=16、top1=15、perLeaf≈12.07——只要预测线是 12 就会被顶去两层。
    expect(deriveShape(181)).toMatchObject({ depth: 1, top: SHAPE_MAX_SIBLINGS })
    expect(deriveShape(181).perLeaf).toBeGreaterThan(MAX_LEAF)
    expect(deriveShape(301)).toMatchObject({ depth: 2 })
  })
})
