import type { ProgressEvent, TaskRecord } from './events'

/**
 * 「当前任务」在 chrome.storage.session 里的落盘层。
 *
 * 为什么是 session 而不是 local：任务的生命周期就是「这一次浏览器会话」——
 * 浏览器退出后恢复一个几小时前的整理没有意义，还会让用户在不知情的状态下
 * 被旧方案绊一脚。session 区随浏览器退出清空，正好把这条边界画在产品语义上。
 *
 * 为什么任务要落盘而不是活在内存单槽：内存单槽有两个已经真实发生过的故障形态——
 * 1. SW 被浏览器回收后重启，内存归零，但「锁还被谁占着」这件事无人知晓，
 *    于是新任务认领被一张已经没人持有的旧锁挡住（线上复现过的卡死）；
 * 2. 侧栏关掉重开，进度与结果再也无法接回来。
 * 落盘之后，冷启动读一次 journal 就能把两者都自愈掉。
 */

/** storage.session 的最小切片，测试里好伪造。 */
export interface TaskStorage {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}

export const TASK_KEY = 'reshelve:task'

/**
 * journal 里保留的事件上限。与侧栏的 MAX_LOGS 同一个量级：足够把一场几分钟的
 * 分析的近期日志接回来，又不至于让每次落盘都拖着一大包。
 */
export const MAX_TASK_EVENTS = 200

/** 纯函数：把一条事件追加进环形缓冲，超出上限时丢掉最旧的。 */
export function appendEvent(record: TaskRecord, event: ProgressEvent): TaskRecord {
  const events = [...record.events, event]
  return { ...record, events: events.length > MAX_TASK_EVENTS ? events.slice(events.length - MAX_TASK_EVENTS) : events }
}

export async function readTask(storage: TaskStorage): Promise<TaskRecord | null> {
  return await storage.get<TaskRecord>(TASK_KEY)
}

/**
 * 落盘。配额不够时先砍事件缓冲再试一次：storage.session 全扩展共享 10MB，
 * 真被别的写入挤爆时，丢日志不能跟着把终态（result/error）一起丢——
 * 那两样才是重开侧栏的人最需要的。
 */
export async function writeTask(storage: TaskStorage, record: TaskRecord): Promise<void> {
  try {
    await storage.set(TASK_KEY, record)
  } catch {
    await storage.set(TASK_KEY, { ...record, events: record.events.slice(-20) })
  }
}

export async function clearTask(storage: TaskStorage): Promise<void> {
  await storage.remove(TASK_KEY)
}

/**
 * SW 冷启动自愈：内存里的「当前任务」归零了，journal 里若还躺着 running/cancelling，
 * 说明持锁的进程已经死了、在途请求必断——补写 interrupted 终态。
 *
 * 这一步把曾经的锁卡死变成了不可能事件：锁的持有者不再是内存单槽，
 * 任何一次重启都会把没人认的锁当场销掉。
 *
 * 返回自愈后的记录（没病时返回原记录或 null），调用方只需拿它更新内存。
 */
export async function healTask(storage: TaskStorage): Promise<TaskRecord | null> {
  const record = await readTask(storage)
  if (record === null) return null
  if (record.status !== 'running' && record.status !== 'cancelling') return record
  const healed: TaskRecord = { ...record, status: 'interrupted', finishedAt: Date.now() }
  await writeTask(storage, healed)
  return healed
}
