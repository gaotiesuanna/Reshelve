import type { AppMode, Step } from '../store'
import { send } from './send'

const VIEW_PARAM = 'view'
const MODE_PARAM = 'mode'
const STEP_PARAM = 'step'
const IDS_PARAM = 'ids'
const TAB_VIEW = 'tab'

const MODES: readonly AppMode[] = ['organize', 'cleanup', 'transfer', 'dashboard']
const STEPS: readonly Step[] = ['scope', 'preferences', 'structure', 'review', 'result']

/**
 * 当前是不是「完整标签页」形态。识别靠 open_app_tab 打在 URL 上的
 * view=tab——没有别的可靠办法区分侧栏文档和标签页文档。
 */
export function isTabView(): boolean {
  return new URLSearchParams(window.location.search).get(VIEW_PARAM) === TAB_VIEW
}

/**
 * 从标签页形态的 URL 上读要落在哪个模式。只认白名单里的取值，
 * 乱写的参数一律当没带（调用方保持 store 默认的 organize）。
 */
export function modeFromLocation(): AppMode | null {
  const raw = new URLSearchParams(window.location.search).get(MODE_PARAM)
  return MODES.find((mode) => mode === raw) ?? null
}

/**
 * 从标签页形态的 URL 上读要落在整理流程的哪一步。
 * 只认白名单：乱写的参数一律当没带，调用方保持 store 默认的 scope。
 */
export function stepFromLocation(): Step | null {
  const raw = new URLSearchParams(window.location.search).get(STEP_PARAM)
  return STEPS.find((step) => step === raw) ?? null
}

/**
 * 从标签页形态的 URL 上读勾选的目录 id。参数缺席返回 null（没带，不是空选）。
 */
export function checkedIdsFromLocation(): Set<string> | null {
  const raw = new URLSearchParams(window.location.search).get(IDS_PARAM)
  if (raw === null) return null
  return new Set(raw.length === 0 ? [] : raw.split(',').filter((id) => id.length > 0))
}

/**
 * 把侧栏换成完整标签页。必须让后台代办（open_app_tab）：侧栏没有 close API，
 * 唯一关法是 enabled 先关后开，而面板一关本页就被卸载——在侧栏里自己做，
 * 「再启用」那一步永远轮不到执行，扩展图标从此点了没反应。
 *
 * step / checkedIds 跟 mode 一样只作透传：新页面要停在侧栏正看着的那一步，
 * 而不是重新打开后掉回范围页。
 */
export async function openAppInTab(input: {
  mode: AppMode
  step: Step
  checkedIds: readonly string[]
}): Promise<void> {
  await send({
    kind: 'open_app_tab',
    mode: input.mode,
    step: input.step,
    checkedIds: [...input.checkedIds],
  })
}
