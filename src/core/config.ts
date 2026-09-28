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
