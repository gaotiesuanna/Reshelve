/**
 * offscreen 保活文档的全部逻辑：每 20 秒给 service worker 发一条消息。
 *
 * MV3 的 SW 空闲 30 秒就被浏览器回收，而保活 ping 原本只由侧栏发——侧栏一关，
 * 长任务就没人撑腰了（docs/specs/background-tasks.md §5）。这个不可见文档存在的
 * 唯一意义，就是在没有任何侧栏开着的时候继续把消息送进 SW：收到消息本身就会
 * 重置空闲计时，内容无所谓，SW 侧也不需要回应。
 *
 * 生命周期由后台管：任务开始时创建本文档，收尾时关闭——平时它不存在，
 * 不白占一份内存，也不给商店审核多留一个「为什么常驻」的问题。
 */
const KEEPALIVE_INTERVAL_MS = 20_000

setInterval(() => {
  void chrome.runtime.sendMessage({ type: 'keepalive' }).catch(() => {
    // SW 正在被回收/重启的窗口期可能送不到，下一轮再来；无须处理
  })
}, KEEPALIVE_INTERVAL_MS)

export {}
