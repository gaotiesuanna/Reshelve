/** 叶子目录目标容量。落成后超过它就该下切。 */
export const SWEET_LEAF = 12

/** 落成后单夹上限（判准 A1）。等于甜点，不单独填。 */
export const MAX_LEAF = SWEET_LEAF

/** 预测阶段允许叶子撑到哪。必须大于 MAX_LEAF。只有 deriveShape 用。 */
export const STRETCH_LEAF = 20

/** 同一层目录数判准（A3）。deriveShape 默认 topCap。 */
export const SHAPE_MAX_SIBLINGS = 15

/** 建树最后兜底。必须大于 SHAPE_MAX_SIBLINGS。非推翻模式也用。 */
export const MAX_SIBLINGS = 17

/** 「其他」整个子树占范围内书签总数的比例红线（A5）。 */
export const FALLBACK_SHARE_LIMIT = 0.1

/** 目录树最深切到第几层（范围根下第一级算 1）。三层已经点不到底，一级下再分一次就停。 */
export const MAX_AUDIT_LEVEL = 2

/**
 * 一个目录至少要装下几个书签才值得单独建立。
 *
 * 两条书签摆在一个目录里，展开比直接扫两行还费事，从第三条起才开始省浏览成本。
 * 再往上能活下来的目录太少，结果会退化成一个巨大的「其他」。
 * 与 MIN_NEW_FOLDER_SIZE 不合并：那个只管归入现有模式里新建目录的簇大小。
 */
export const MIN_FOLDER_BOOKMARKS = 3

/**
 * 留守判据的下限：少于这么多条就别再问模型了。
 *
 * 取 2 × MIN_FOLDER_BOOKMARKS 不是拍的——再切一次要站得住，至少得切出两个不会被
 * pruneSmallFolders 撤掉的子目录。低于它触发相对判据，只是白花一次付费调用。
 */
export const MIN_LEFTOVER_TO_SPLIT = MIN_FOLDER_BOOKMARKS * 2

/**
 * 归入现有模式里，同一主题攒够几条才值得开一个新目录。
 *
 * 曾经是 3（issues/08-settings-tradeoffs.md）。攒不够就原地不动，等于一条散落书签永远没有归宿
 * （issues/42-loose-bookmark-always-lands-somewhere.md）。改成 1 之后，能问到独立主题名的书签都单独开目录；
 * MAX_SIBLINGS 已经把一次新建的目录数封了顶。问不出主题名的落到「其他」。
 *
 * 与 MIN_FOLDER_BOOKMARKS 不合并：那个管推翻模式下装不满就撤掉，是另一条规则。
 */
export const MIN_NEW_FOLDER_SIZE = 1

/**
 * 下切调用次数的下限。叶子少时也不要把预算压到不够用。
 * 叶子多过它时，预算跟着叶子走，见 deepenBudget。
 */
export const MIN_DEEPEN_CALLS = 20
