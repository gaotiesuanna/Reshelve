/**
 * 目录的形状（几个、几层）由这次要整理的书签总数推导，而不是由用户拨旋钮。
 *
 * 判准（见 issues/01-good-tree-criteria.md）里叶子容量的**下限**是 8、甜点是 12。
 * 方案 D 建立在「甜点只是甜点」这一点上：先按甜点算需要几个叶子；目录数顶到同层上限之后
 * **让叶子往上长**；长过 STRETCH_LEAF 才加一层。四个方案的对跑见
 * issues/10-shape-from-count.md 与 tools/shape.mjs，另外三个都在某处产生
 * 「多分一层、而那层几乎不承载区分度」的失败。
 *
 * 全程只有两处深度跳变：N=301 进两层、N=2701 进三层。而且悬崖没那么可怕——
 * 周期性整理走的是非推翻模式、根本不重新设计，形状推导只在首次整理跑一次。
 *
 * **容量上限（判准 A1）不在这里生效。**它由 core/audit.ts 的 findOversizedFolders
 * 对**落成后的实际占用**验算，用的是 MAX_LEAF；这里预测用的是 STRETCH_LEAF。
 * 两个数分家的理由见 core/config.ts 与 issues/38-source-vs-topic.md 的 D2。
 */

import { SWEET_LEAF, STRETCH_LEAF, SHAPE_MAX_SIBLINGS } from './config'


export interface FolderShape {
  /** 叶子目录总数（一层时就是 top，两层时是所有二级目录之和）。 */
  leaves: number
  /** 目录树的层数。0 表示没有书签可整理。 */
  depth: number
  /** 一级目录数。 */
  top: number
  /** 平均每个叶子装多少条。 */
  perLeaf: number
}

/**
 * @param n      这次要整理的书签总数
 * @param topCap 一级目录数上限。默认 SHAPE_MAX_SIBLINGS，目前没有调用点收紧它——
 *   曾经有一个（depthGuard，给聚合组让出一级位子），随 issues/38 的 D4
 *   取消域名聚合一起退休。参数保留是因为 topCap 收紧确实参与
 *   「一层撑不撑得下」的判断（cap 越紧，一层能吸收的书签越少，可能被顶去两层），
 *   将来若再有别的东西要占一级位子，这个口子是现成的。
 */
export function deriveShape(n: number, topCap: number = SHAPE_MAX_SIBLINGS): FolderShape {
  if (n <= 0) return { leaves: 0, depth: 0, top: 0, perLeaf: 0 }

  const wanted = Math.ceil(n / SWEET_LEAF)

  // 一层：目录数最多 topCap，装不下就让每个叶子多装点——判准给的是区间不是定值
  const top1 = Math.min(wanted, topCap)
  if (n / top1 <= STRETCH_LEAF) return { leaves: top1, depth: 1, top: top1, perLeaf: n / top1 }

  // 两层：叶子回到甜点，只是它们不再都挂在一级
  const leaves = wanted
  // 两层布局的容量 = 一级数 × 每个一级下的二级数。一级被 topCap 收紧时容量跟着变小，
  // 于是更早需要三层——写死上限的话，紧预算下两层塞不下也不会分层（N > 2700 才走得到
  // 默认预算下的这条分支；三层的分配暂不细化，
  // 硬编一套没验证过的规则不如留空——到时按同样的思路再递归一层）。
  if (leaves > topCap * SHAPE_MAX_SIBLINGS) {
    return { leaves, depth: 3, top: 0, perLeaf: n / leaves }
  }
  // branch 就是一级目录数，必须服从 topCap。
  //
  // 还要不少于一层刚撑破时的一级数（top1）。N=300 一层 15 个目录；N=301 进两层
  // 若只取 floor(√leaves) 会掉到 5 个主题——模型只能挑 5 个最显眼的簇，其余全进
  // 「其他」。两层是加孩子，不是把一级主题砍掉。
  const branch = Math.min(
    topCap,
    Math.max(
      top1,
      Math.floor(Math.sqrt(leaves)),
      Math.ceil(leaves / SHAPE_MAX_SIBLINGS),
      3,
    ),
  )
  return { leaves, depth: 2, top: branch, perLeaf: n / leaves }
}
