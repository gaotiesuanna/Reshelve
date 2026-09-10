/**
 * 仓库地址。设置页头部的 GitHub 图标指向它；它也是商店审核动线的一部分——
 * 「隐私权」页的主机权限文案里附了指向 permissions.ts 的链接，
 * 审核员会点进去核对，扩展界面里再摆一处一致的地址不吃亏。
 *
 * manifest 的 homepage_url 必须与这里一致，tests/manifest.test.ts 在守。
 */
const REPO_HANDLE = 'github.com/gaotiesuanna/Reshelve'

/** 点击目标。始终带 https。 */
export const REPO_URL = `https://${REPO_HANDLE}`
