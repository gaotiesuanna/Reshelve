import type { AppMode } from '../store'
import { send } from './send'

const VIEW_PARAM = 'view'
const MODE_PARAM = 'mode'
const TAB_VIEW = 'tab'

const MODES: readonly AppMode[] = ['organize', 'cleanup', 'transfer', 'dashboard']

/**
 * 当前是不是「完整标签页」形态。识别靠 open_app_tab 打在 URL 上的
 * view=tab——没有别的可靠办法区分侧栏文档和标签页文档。
 */
export function isTabView(): boolean {
  return new URLSearchParams(window.location.search).get(VIEW_PARAM) === TAB_VIEW
}

/**
 * 从标签页形态的 URL 上读要落在哪个模式。只认白名单里的取值，
 * 乱写的参数一律退回默认的 organize。
 */
export function modeFromLocation(): AppMode | null {
  const raw = new URLSearchParams(window.location.search).get(MODE_PARAM)
  return MODES.find((mode) => mode === raw) ?? null
}

/**
 * 把侧栏换成完整标签页。必须让后台代办（open_app_tab）：侧栏没有 close API，
 * 唯一关法是 enabled 先关后开，而面板一关本页就被卸载——在侧栏里自己做，
 * 「再启用」那一步永远轮不到执行，扩展图标从此点了没反应。
 */
export async function openAppInTab(mode: AppMode): Promise<void> {
  await send({ kind: 'open_app_tab', mode })
}
