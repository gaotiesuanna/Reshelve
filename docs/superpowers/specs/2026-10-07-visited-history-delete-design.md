# 统计页「访问」删除浏览记录

日期：2026-10-07

## 问题

访问排行能看见哪些站、哪些页占了浏览记录，但不能清掉它们。要在 **Visited** 上做两件事：

1. 域名行 hover 时，箭头右边出现删除按钮，删掉这一行对应的浏览记录。
2. 展开后可以勾选页面（含同标题夹），多选后删除。

Bookmarked 不加重删除，也不加勾选。

## 决定

删的是这台电脑上的浏览记录，不是书签。即使用户勾的是「In bookmarks」里的页面，书签树不动。

调用 `chrome.history.deleteUrl({ url })`，只在侧栏里调。不给后台加 `history` 口子。`tests/background/chrome-ports.test.ts` 守着后台只有书签和存储；这条边界不动。

`history` 已是可选权限，能看见访问排行就说明已经授过。删除不再弹权限窗。删除前若 `hasHistoryPermission()` 为假，不调用 `deleteUrl`，界面退回现有的「需要授权」说明。

Chrome 没有「只删这个时间窗里的若干次访问」的接口。`deleteUrl` 会把该 URL 的全部访问从历史里抹掉，包括当前时间窗以外的。`deleteRange` / `deleteAll` 不能按站点或页面过滤，不用。确认文案必须把「时间窗以外也会删掉、不能撤销」说出来。

没有撤销。确认是唯一的拦截，用现有的 `window.confirm`，不新做对话框。

## 删哪些 URL

排行数据是当前时间窗加载到的 `WeightedUrl[]`（`chrome.history.search` 最多 10000 条；限窗后再用 `getVisits` 数窗内次数）。删除只覆盖这份已加载集合里的 URL。同一主机上、这次结果里没有的地址不动——没在这个窗里出现过的，或被 10000 条上限截掉的，都不在范围内。

展示层会把 query/hash 不同、路径相同的记录并成一行（`mergeVisitPages`）。一行可能对应多条历史 URL。勾选或删除这一行时，必须删掉并进来的每一条原始 URL，不能只删去掉 query 之后的那条展示地址。因此合并结果要带上 `sourceUrls: string[]`。`SavedVisit` 同样带上。展示用的 `url` / `id` 仍是去掉 query/hash 的地址，选择 key 用展示 id，删除时展开成 `sourceUrls`。

域名行删除：当前已加载集合里，host（含端口）等于该行 `domain` 的全部原始 URL。

多选删除：已勾选展示行的 `sourceUrls` 并集。夹、路径文件夹的勾选等于勾选其下全部页面行（含未展开的子孙）。

确认框里的个数是将要交给 `deleteUrl` 的历史 URL 数，不是访问次数，也不是圆点旁边那个权重。`Past month` 上显示 411，确认里可能是 18 个页面。

## 界面

只在 `visits` 存在的域名行上出现。Bookmarked 的 `DomainRow` 结构不变。

域名行今天是一颗包住整行的 `<button>`。删除按钮不能套在里面。拆成一行容器：左侧仍是展开/收起按钮，箭头右边是删除按钮。

删除按钮：

- 用已有的 `TrashIcon`。
- 位置在箭头右侧，不挤进计数和圆点中间。
- 默认不占视觉：`opacity-0`。`hover`、`focus-within`、以及该行已展开时可见。没有 hover 的触屏靠展开后看见按钮；键盘靠焦点看见。
- `aria-label` 带站点名（有 `siteName` 用站点名，否则用 domain）。
- 点删除不触发展开/收起。

展开后的勾选，在内容展开时就出现，不靠 hover：

- 「In bookmarks」每一页一行一个 checkbox。
- 「Not bookmarked」的路径文件夹、同标题夹、页面行各有一个 checkbox。
- 夹或文件夹：全选子孙为 checked，部分为 indeterminate，没有为 unchecked。点 checkbox 不切换展开。
- 页面行的 checkbox 在链接左边。勾选不打开链接。

勾选只活在当前展开的那一个域名里。收起、换时间窗、切到 Bookmarked 时清空。部分删除成功只去掉已删页面的勾选，失败的保持勾选。该域名被删光、或走的是行尾整站删除时，勾选随行消失。一次只展开一个域名，这是现有行为，保持。

行尾删除忽略当前勾选，始终按「该主机已加载的全部 URL」确认并删除。

有勾选时，展开区顶部出现一条操作：`Delete N`（N 为历史 URL 数）和清除勾选。没有勾选时不出现这条，避免和域名行的删除抢入口。不另做「全选此域名」——整站删除就是行尾那个按钮。

## 确认文案

两套文案，英/中都要有。都写明：删的是这台电脑的浏览记录，书签不动，当前时间范围以外的访问也删，不能撤销。

域名行，例：

> Remove browsing history for “DengBridge Dashboard”? This deletes 18 pages from history on this computer, including visits outside Past month. Bookmarks are not deleted. This cannot be undone.

多选，例：

> Remove browsing history for 3 pages? This includes visits outside Past month. Bookmarks are not deleted. This cannot be undone.

时间窗名称用当前选中的那一档（All time / Past month / …）。All time 不说「以外」，只说删除这些页面的全部历史。取消则不调用 `deleteUrl`。

## 执行与失败

同一时间只跑一次删除。进行中，行尾删除和展开区的 `Delete N` 都禁用。

按现有 `visitUrls` 的并发上限（24）逐条 `deleteUrl`。一条失败不影响其他条。

成功的 URL 从**每一个**时间窗缓存和当前 `visits` 里去掉，再重新排行。URL 已经从历史里消失，切到别的时间窗不能再从旧缓存里冒出来。没加载过的时间窗不用预热，下次加载时 search 自然不会再带回它们。

一个域名的 URL 被删光，该行消失；若它正展开，收起。只删掉一部分，行留着，权重改成剩余 URL 的权重之和，已删页面从勾选和列表里消失。Top N 之后的域名可以因此进入列表——排行本来就是对完整已加载集合 `rankDomains`，不是只握着当前 15 行。

失败的 URL 留在列表里。错误始终写在该域名行下方、展开区之上：多少条没删掉。不弹第二层权限窗，不用 toast。下次在这一行成功删完、或收起该行时，清掉这行错误。全部失败则列表不变。

## 不做

- 不删书签，不改书签树。
- 不在 Bookmarked 上提供删除或勾选。
- 不跨域名勾选。
- 不按时间窗裁剪单条 URL 的访问次数。
- 不提高 10000 条 search 上限，也不为了删得更全再发一次不限窗的 search。
- 不做撤销。
- 不把 `history` 加进后台端口。

## 测试

- Bookmarked 行没有删除按钮，展开书签分布也没有 checkbox。
- Visited 行尾删除按钮是展开按钮的兄弟，不在其内部。未 hover、未聚焦、未展开时不可见；hover 或展开后可见。
- 点删除弹出确认。取消不调用 `deleteUrl`。
- 确认域名删除：对当前加载集合里该 host 的每条原始 URL 调用 `deleteUrl`，该行消失。
- 展开后勾选夹，其下页面行变为选中；再取消其中一页，夹变为 indeterminate。
- 多选删除只把选中行的 `sourceUrls` 交给 `deleteUrl`。query 不同、被并成一行的 URL 全部删除，而不只是展示用的无 query 地址。
- 勾选「In bookmarks」里的页面并删除后，历史 URL 被删，书签树不变。
- 部分 `deleteUrl` 失败时，成功的从列表消失，失败的还在，并出现失败条数。
- 删除后切换到已缓存的另一时间窗，被删 URL 不再出现。
- 确认文案含「书签不会删除」和「不能撤销」（或英文对应句）。
