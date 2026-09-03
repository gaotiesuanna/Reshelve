/**
 * 设置页「关于」区要显示的两样东西：仓库地址和版本号。
 *
 * 仓库地址也是商店审核动线的一部分——「隐私权」页的主机权限文案里附了指向
 * permissions.ts 的链接，审核员会点进去核对，扩展界面里再摆一处一致的地址不吃亏。
 */

/** 仓库简写，直接当链接文字显示——用户要的就是「看见这个地址」。 */
export const REPO_HANDLE = 'github.com/gaotiesuanna/Reshelve'

/** 点击目标。始终带 https，链接文字则只留简写。 */
export const REPO_URL = `https://${REPO_HANDLE}`

/**
 * 扩展版本号，取自运行时 manifest——那才是这份扩展真实的版本，
 * 比 package.json 里那个独立维护、容易漂的值可靠。
 *
 * 测试与非扩展环境没有 chrome.runtime，返回空串，调用方据此决定要不要渲染这一行。
 */
export function extensionVersion(): string {
  if (typeof chrome === 'undefined' || chrome.runtime?.getManifest === undefined) return ''
  return chrome.runtime.getManifest().version
}
