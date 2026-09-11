# 分类前结构确认

日期：2026-09-11

状态：设计待用户复核

## 一、背景

Reshelve 的重建模式目前把以下工作塞在同一个 `analyze` 后台任务里：

```text
扫描 → 抽标签 → 设计目录 → 逐条分类 → 结构自检 → buildPlan
```

侧栏虽然已有“确认结构”页，但它位于整轮分析完成之后。此时逐条分类已经发生，页面上的目录数量来自真实分类结果；用户改名、删除或合并目录，只是在已经生成的 `plan` 上重写路径和回落目标。

这带来三个产品缺口：

1. 用户在最昂贵的逐条分类发生前看不到目录设计，也无法决定模型将面对哪些候选目录。
2. 改名不会改变模型的分类依据；添加新类型则完全无法表达，因为分类 schema 的候选 id 已经固定。
3. 用户确认后，现有分类后剪枝、下切、提升逻辑仍可能继续改变结构，“确认”不构成真正的边界。

本设计把重建模式拆成两轮独立后台任务，在两轮之间建立可恢复、可编辑的结构检查点。

本设计仅推翻 `2026-08-03-structure-confirm-and-domain-grouping-design.md` 中“结构确认页放在整条管线跑完之后”的决定；该文档的其余历史背景不自动恢复，也不重新引入已经删除的域名聚合设置。

## 二、目标

- 重建模式在目录设计完成后停止，先让用户确认目录集合，再进行逐条分类。
- 用户改过的目录名必须进入分类 prompt 与分类缓存 key。
- 用户可以在分类前新增一个一级类型；模型能把书签实际分入该类型。
- 删除或合并目录后，被删除的目录不再出现在分类候选中。
- 结构确认页关闭后重新打开仍能恢复；分类任务中断后能够回到同一份草案重试。
- 用户确认后，AI 不再自动新增、删除、改名或改层级；分类后的结构检查只报告问题。
- 非重建模式、标题统一、复核、应用和撤销的既有语义保持不变。

## 三、非目标

- 不给 additive 模式增加结构确认页。它使用用户已有目录，没有一棵新设计的树需要确认。
- 不支持添加二级目录、拖拽换层级或任意移动节点。第一版只在一级列表末尾添加类型；已有二级目录仍可改名、删除和同层合并。
- 不创建实际占用为 0 的空目录。用户新增的类型若分类后无人进入，应用时照旧不创建。
- 不保存为长期分类模板；草案只在当前浏览器会话有效，不进入 `Settings`。
- 不修改 `tidymark:*` 历史存储键、导出格式兼容前缀或项目命名遗留。
- 不改变分类模型输出结构、URL 折叠、批次并发、重试、拆批或分类缓存格式。
- 不增加第二个结构确认页。逐条分类之后仍只进入现有复核页。

## 四、方案选择

考虑过三种方案：

1. **分类完成后编辑，再把所有书签重分一次。** 实现可以复用现有 plan，但第一次分类仍然花在未确认的目录上，编辑后又产生第二笔同等成本，不采用。
2. **让同一个后台任务暂停等待用户。** 这会长期占住全局独占锁，并与 MV3 service worker 回收、自愈和取消语义冲突，不采用。
3. **两轮任务，中间保存结构检查点。** 第一轮只负责设计，第二轮读取用户确认后的候选目录做分类；等待期间没有锁，关闭面板也可恢复。采用此方案。

入口仍保留现有 `analyze` 请求，因为最终采用 rebuild 还是 additive 必须由后台基于最新扫描结果决定。只有后台实际选择 rebuild 时，`analyze` 才返回结构草案；additive 和 title-only 仍返回最终 plan。

## 五、用户流程

```text
选择范围
  ↓
偏好设置
  ↓
analyze
  ├─ additive / title-only → 最终 plan → 复核
  └─ rebuild
       ↓
     第一轮：抽标签 + 设计 + 预分类结构自检
       ↓
     结构确认页
       ↓ 改名 / 删除 / 同层合并 / 新增一级类型
     第二轮：按确认后的候选目录逐条分类
       ↓
     最终 plan → 复核 → 应用 → 结果
```

结构页主按钮改为“确认结构并开始分类”。点击后停留在当前步骤，由全局进度面板显示分类进度；成功后进入复核页，失败或取消则保留草案与编辑，用户可重试。

返回偏好页表示放弃当前草案：清空结构检查点和结构编辑。再次开始分析会重新抽标签并重新设计。

## 六、消息契约

### 6.1 初始分析响应

`Request` 中现有 `analyze` 不变；成功响应改为可辨别联合类型：

```ts
type AnalyzeResponse =
  | { ok: true; kind: 'analyze'; outcome: 'plan'; plan: OrganizePlan }
  | { ok: true; kind: 'analyze'; outcome: 'structure'; draft: StructureDraft }
```

- additive 与 title-only 返回 `outcome: 'plan'`。
- rebuild 完成第一轮后返回 `outcome: 'structure'`。
- 不允许通过“`plan.rows` 是否为空”猜阶段；空 plan 本来就是合法结果。

### 6.2 确认后分类

新增请求与响应：

```ts
type ClassifyStructureRequest = {
  kind: 'classify_structure'
  draft: StructureDraft
  edits: StructureEdits
}

type ClassifyStructureResponse = {
  ok: true
  kind: 'classify_structure'
  plan: OrganizePlan
}
```

`classify_structure` 是独占、可取消任务，与 `analyze` 使用同一套 keepalive、进度广播和 LLM 取消信号。它写分类缓存，因此必须进入 `EXCLUSIVE`。

## 七、结构草案数据模型

新增独立类型，不用“缺少 rows 的 `OrganizePlan`”冒充草案：

```ts
interface StructureDraft {
  id: string
  createdAt: number
  scopeRootIds: string[]
  /** 新建一级目录实际挂载的范围根；不能从级联勾选的 scopeRootIds[0] 猜。 */
  destinationRootId: string
  locale: Locale
  llm: { baseUrl: string; model: string } // 不含 apiKey
  totalBookmarks: number
  bookmarkFingerprint: Array<{ id: string; url: string }>

  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  renameFolders: RenameFolderSpec[]
  folderMoves: FolderMoveSpec[]
  mergeRoot: OrganizePlan['mergeRoot']

  /** designTagFolders 写回目录名后的标签。 */
  tags: TagResult[]
  /** extractTags 的原始结果，供确认前的超载下切使用。 */
  sourceTags: TagResult[]
  /** 只用于结构页预计数量和确认前结构自检，不作为最终分类结果。 */
  estimatedAssignments: Array<{
    bookmarkId: string
    targetCategoryId: string | null
  }>

  rootLevel: number
  deepenCap: number
  warnings: string[]
  rewriteGithubTitles: boolean
}
```

数组而不是 `Map` 用于跨 `chrome.runtime` 和 `chrome.storage.session` 序列化。

`StructureDraft` 与 `StructureEdits` 定义在 `src/core/structure.ts`；该模块已经拥有结构编辑语义，也能直接复用 `core/plan.ts` 的目录规格类型，避免让通用 `core/types.ts` 反向依赖 plan。

草案固定第一轮使用的 locale、base URL 和 model，保持原来“一轮 analyze 使用同一配置”的语义。第二轮从当前设置中查找同一 base URL，并使用此刻保存的 API key；若端点或模型已被删除，提示用户返回偏好页重新生成结构。API key 永不进入草案、任务记录或导出数据。

## 八、第一轮：设计与确认前自检

重建分支在现有 `classifyBookmarks` 调用之前截断。它负责：

1. 重新读取书签树并确定实际模式。
2. `extractTags` 得到 `sourceTags`。
3. `designTagFolders` 得到写回目录路径的 `tags`。
4. 命名合并容器并执行 `buildCategoryTree`。
5. 用 `tags` 与候选路径生成 `estimatedAssignments`。
6. 基于预计归属执行会改变结构的自检。
7. 返回并保存 `StructureDraft`，不调用逐条 `classifyBookmarks`，不生成最终 `OrganizePlan`。

### 8.1 预计归属

新增纯函数，将每条设计后标签映射到唯一候选 id。匹配使用去编号后的规范化路径；找不到或不唯一时记为 `null`。它只服务于预计数量和确认前自检，不写分类缓存，不产生置信度或分类理由。

结构页中：

- 一级数量包含自身与所有子目录预计数量。
- 二级数量只显示自身预计数量。
- 用户新增类型初始显示“预计 0 条”。
- 页面明确说明实际数量要等逐条分类完成后才能确定。

### 8.2 会改变结构的自检全部前移

用户确认以后结构必须冻结，因此以下 rebuild 结构变更移到返回草案之前，并改用预计归属：

- 小目录剪枝；
- 同名穿透层塌陷；
- 超载目录下切；
- 下切后的再次剪枝；
- `其他` 子目录提升。

确认前的下切仍可调用 `designFolders`，因为它属于目录设计成本，不是逐条分类成本。小目录被剪掉后不再单独执行“rehome 分类”：第二轮逐条分类会直接面对剪枝后的完整候选集合。

既有 `prune` / `audit` 函数目前直接读写完整 `Classification`。实现时抽出只依赖 `{ bookmarkId, targetCategoryId }` 的目标重映射原语：预计归属和最终分类分别用薄包装接入，目录计数、删节点、改目标和提升规则只保留一份。确认前自检产生的 `folderMoves` 与候选、新建目录规格一起写进草案，供最终 `buildPlan` 使用。

第一轮产出的就是用户将看到的最终语义结构。编号仍是展示和落地层行为，不属于语义结构。

## 九、结构编辑语义

`StructureEdits` 扩充为：

```ts
interface StructureEdits {
  renames: Record<string, string>
  removed: string[]
  mergedInto: Record<string, string>
  added: Array<{
    temporaryId: string       // tmp:user:<uuid>
    parentCategoryId: null    // 第一版只允许一级，因此固定为 null
    title: string
  }>
}
```

新增 `applyStructureEditsToDraft(draft, edits, locale)` 纯函数，返回确认后的候选目录与建目录规格。它不读 `rows` 或 `move_bookmark` 操作。

规则如下：

- **改名**：同步修改 candidate path、`create_folder.title`、`rename_folder.newTitle` 和子目录路径。分类模型看到新名字。
- **删除**：从 candidates、新建/改名规格和预计归属中移除；分类模型看不到该目录。删除一级时连同子目录一起移除；涉及被删现有目录的 `folderMoves` 同步移除。
- **合并**：只允许同层；删除来源节点，预计数量并入目标节点。分类阶段只看到目标节点，不做分类后的强制改投。
- **新增**：插入到一级列表的兜底目录之前，追加 candidate 与 `NewFolderSpec`；合并模式下挂到合并容器，否则挂到 `destinationRootId`。它会进入分类 schema 与 prompt。
- **合并根改名**：同步更新容器规格与最终 plan 路径前缀，但合并根不是分类候选。
- **其他 / Other**：继续不可改名、不可删除；可以作为同层合并的接收方。

确认前校验：

- 标题 trim 后不能为空；
- 同父目录下，剥编号并规范化后的名称不得重复；
- 新增类型不得使用 locale 对应的保留兜底名；
- `mergedInto` 不得指向不存在、不同层或已删除的节点，不得成环；
- 草案必须至少保留一个候选目录。

输入过程中可以暂时为空，主按钮禁用并显示行内错误；只有合法结构才能发起分类。

第一版只新增一级类型，是有意的范围限制。新增二级、拖拽换层级和跨层合并需要重新设计 parent 选择与移动交互，留给后续需求。

用户显式新增的一级类型不受自动设计预算硬拦截；超出同层建议数量时，结构页显示非阻断警告。用户已经在确认页做出的选择优先于自动形状预算。

结构编译在分类前统一重新编号：所有一级、二级候选按当前显示顺序生成连续编号，合并容器仍不编号。即使没有编辑，传给分类器的路径也与第一轮原设计保持同一编号规则；删除、合并或新增后则得到新的连续编号。UI 始终只编辑裸名字，编号不进入 `StructureEdits`。

## 十、第二轮：按确认结构分类

`classify_structure` 收到草案和编辑后：

1. 校验草案形状、候选引用和结构编辑，不能信任侧栏传来的对象。
2. 按草案 `scopeRootIds` 重新扫描书签树。
3. 校验书签指纹。
4. 解析草案绑定的模型配置。
5. 用 `applyStructureEditsToDraft` 得到冻结且连续编号的候选结构。
6. 对当前扫描出的书签调用现有 `classifyBookmarks`。
7. 保存已完成批次的分类缓存。
8. 只做结构测量和警告，不再改变候选结构。
9. 生成标题改名建议并调用 `buildPlan`。

`classifyBookmarks` 的批次、并发、同 URL 折叠、规则优先、缓存、网络重试和截断拆批全部复用。`includeTopicRule` 仍为 `false`，因为确认后的 rebuild 候选集合就是完整答案空间。

### 10.1 确认后的“结构冻结”

第二轮禁止调用任何会改变目录集合或层级的 rebuild 修复：

- 不再剪枝；
- 不再新增兜底或新主题目录；
- 不再下切；
- 不再提升目录；
- 不再塌陷或自动改名。

逐条分类后仍测量实际占用、一级数量、超载目录和兜底占比，并把越线结果写入 `plan.warnings`。这是信息，不是第三次设计。

“冻结”指 AI 不再改变用户确认的语义节点。以下既有行为不算违反冻结：

- 实际无人进入的新建目录不会在 apply 时创建；
- 用户在复核页取消全部相关移动时，该目录不会创建；
- `renumberPlan` 会按实际落地目录压缩编号；
- 用户仍可在复核页逐条改投或重新分类。

用户手工新增但最终为 0 条的类型也不创建空目录，保持 Reshelve 现有“没有书签就不建目录”的原则。

## 十一、书签变化与过期草案

两轮之间用户可能在书签管理器、同步设备或另一个窗口修改书签。

第二轮比较按 `id` 排序的 `{id, url}` 指纹：

- 新增、删除、URL 改变或范围根失效：拒绝分类，保留草案并提示“书签范围已变化，请重新生成结构”。
- 仅标题、父目录、路径或 index 改变：允许继续，分类和 `buildPlan` 使用第二轮重新扫描出的最新值。

这样既避免把新书签塞进用户没见过的结构统计，也不会因为一次普通改名或移动强迫用户重做设计。

## 十二、持久化与恢复

现有 `TaskRecord` 只保存“当前一轮任务”；新任务开始会覆盖上一轮记录。结构确认是跨任务工作流，不能只依赖这个单槽。

在 `task-journal.ts` 相邻位置增加 session 级检查点：

```ts
const STRUCTURE_CHECKPOINT_KEY = 'reshelve:structure-checkpoint'

interface StructureCheckpoint {
  draft: StructureDraft
  edits: StructureEdits
  state: 'awaiting_confirmation' | 'classifying'
  updatedAt: number
}
```

行为：

- 第一轮成功后，service worker 先 `await` checkpoint 写入，再结束任务并回复侧栏，避免响应到达而恢复点尚未落盘。
- 每次改名、删除、合并、新增后，store 都立即异步发送完整 checkpoint，不做 debounce，也不等待写入完成；确认请求始终携带 store 中最新 edits，因此分类正确性不依赖最后一次持久化是否已经完成。
- 第二轮开始时写 `state: 'classifying'`。
- 第二轮失败、取消或 SW 中断时保留 checkpoint，并恢复到结构页。
- 第二轮成功后，以 task journal 中的最终 plan 为恢复优先；确认侧栏已采纳 plan 后清除 checkpoint。
- 返回偏好页、reset、开始新的 rebuild 分析时清除旧 checkpoint。
- 浏览器退出后 `chrome.storage.session` 自动清除，不做跨会话恢复。

新增 `get_structure_checkpoint`、`save_structure_checkpoint`、`clear_structure_checkpoint` 控制消息，由 service worker 管理 session storage。检查点与独占任务锁彼此独立，因此用户在等待确认时不会占锁；其他模式的任务也不会覆盖它。

初始化恢复优先级：

1. 当前 task 正在运行：接回进度；若是 `classify_structure`，同时保留 checkpoint。
2. 当前 task 已完成且带最终 plan：进入复核或结果页，忽略并清除旧 checkpoint。
3. 没有可采纳的最终任务，但有 checkpoint：进入结构页。
4. 两者都没有：走现有初始状态。

## 十三、进度、取消与错误

- 第一轮沿用 `scan → tags → tree` 阶段；结束时进入结构页，不显示虚假的 classify 进度。
- 第二轮以 `classify` 阶段开始；确认前自检已完成，进度不回跳到 tree。
- `classify_structure` 加入 `BUSY_KIND_BY_TASK`、`BUSY_LABEL_BY_TASK`、`EXCLUSIVE` 和 `CANCELLABLE`。
- 第二轮取消不是错误：回到结构页，保留 edits。
- 第二轮网络失败：回到结构页，保留 edits 和可重试入口；已完成批次仍写缓存。
- 指纹过期或模型配置失效不是盲目重试错误：提示返回偏好页重新生成。
- 全军分类失败沿用现有错误判断，不生成空 plan。

## 十四、界面调整

`StructureStep` 继续复用现有两层树和同层合并交互，修改以下内容：

- 开头文案说明这是按主题标签得出的预计结构，确认后才逐条分类。
- 数量 tooltip 从“将移入”改为“预计 N 条”；不呈现为精确承诺。
- 一级列表末尾增加“添加类型”按钮；点击后插入一个聚焦的空标题输入框。
- 新增节点可改名、删除、合并；初始预计数为 0。
- 主按钮改为“确认结构并开始分类”。
- 非法名称就地提示并禁用主按钮。
- 分类进行中，所有结构输入和返回按钮禁用；取消入口仍在进度面板。
- 分类失败或取消后恢复可编辑状态，不丢失用户输入。

步骤条仍是 `范围 → 偏好 → 结构 → 复核 → 完成`，不增加新步骤。“正在分类”是结构与复核之间的后台状态，不是一个需要用户操作的新页面。

## 十五、与现有功能的关系

### Additive

继续在一次 `analyze` 中完成分类、新主题命名、兜底和 plan 生成，直接进入复核。现有“只分类散落书签”保持不变。

### Title-only

继续返回 `outcome: 'plan'`，不创建结构草案，不调用模型。

### 合并模式

第一轮仍负责命名合并容器。结构页继续点名将被清空删除的源目录；用户可在分类前修改容器名。第二轮只生成一个最终 plan，apply 仍一次性执行，不触碰现有“合并 plan 不可部分应用”的保护。

### 复核页

无需第二个结构编辑入口。逐条改投、标记重新分类、部分应用和导出最终 plan 保持现状。分类后实际数量与预计数量不同，只通过最终分组和 warnings 体现。

### 缓存

分类缓存 key 已包含候选路径集合、locale 和 model。第二轮把编辑后的 candidates 传入现有 `classifyBookmarks` 后，改名、新增、删除和合并会自然产生正确的缓存命中或失效，不改缓存存储格式。

## 十六、代码边界

主要改动：

- `src/background/handlers.ts`：拆分 rebuild 的设计阶段与分类阶段；分类后结构改动改为只测量。
- `src/background/messages.ts`：联合 analyze 响应、新增 `classify_structure` 和 checkpoint 控制消息。
- `src/background/service-worker.ts`：新任务独占/取消接线、checkpoint 生命周期。
- `src/background/events.ts`、`sessions.ts`、`task-journal.ts`：任务类型与 session 检查点恢复。
- `src/core/structure.ts`：`StructureDraft`、预计视图、编辑校验、草案编译和新增一级类型。
- `src/core/audit.ts`、`prune.ts`：抽出可同时服务预计归属和最终分类的目标重映射原语，不复制算法。
- `src/sidepanel/store.ts`：分别收场 analyze 的两种 outcome、异步确认结构、checkpoint 恢复。
- `src/sidepanel/steps/StructureStep.tsx`：预计数量、添加类型、校验和分类中状态。
- 中英文 locale：新增阶段、错误、预计数量和添加类型文案。

`src/llm/classify.ts` 与 `src/engine/apply.ts` 保持算法不变；`src/core/plan.ts` 只接受确认前已经算好的目录规格和 `folderMoves`。两阶段编排只存在于 background handler 与 sidepanel store。

## 十七、测试

### Core

- 设计后标签能稳定映射为预计 candidate id；未知和歧义路径返回 null。
- 改名同步父子路径和新建/改名规格。
- 删除一级连带删除子级；删除节点不进入最终候选。
- 同层合并累计预计数量，非法跨层和成环被拒绝。
- 新增一级类型在普通模式挂范围根、合并模式挂容器。
- 空名、规范化重名、保留兜底名和不存在引用校验。
- 确认前剪枝、塌陷、下切、提升在预计归属上运行；确认后的测量函数不改输入。

### Background

- rebuild 的 `analyze` 只调用标签和目录设计，不调用逐条分类，返回 structure outcome。
- additive/title-only 返回 plan outcome，调用序列保持现状。
- 第二轮 prompt 和 schema 使用用户改名后的路径，并包含新增类型、不包含删除/合并来源。
- 第二轮继续命中 URL 折叠、缓存、重试和拆批路径。
- 实际占用越线只产生 warnings，不改变 candidates/newFolders。
- 书签指纹变化、模型配置缺失、全军分类失败和取消的收场。
- 合并容器改名贯穿最终 row path 与 create operation。

### Session / service worker

- 第一轮结果写 checkpoint；任务结束后不占独占锁。
- 面板关闭重开恢复结构页。
- 分类中 SW 中断后保留草案和 edits。
- 其他独占任务不会覆盖结构 checkpoint。
- 最终 plan 优先于旧 checkpoint，采纳后清理。
- reset/back 清理 checkpoint。

### Sidepanel

- analyze 的 structure/plan 两种 outcome 分别进入正确页面。
- 结构确认启动第二轮，而不是同步进入 review。
- 预计数量文案、新增类型、输入校验、禁用状态和取消恢复。
- 第二轮成功默认全选最终 rows 并进入 review。
- 第二轮失败保留用户编辑并提供正确重试。
- 中英文界面全部覆盖。

### 回归

- 现有 `core/structure`、handlers、store、StructureStep、service-worker 和 sessions 测试按新阶段语义更新。
- `npm test` 全量通过。
- `npm run build` 通过，包括 `tsc --noEmit`。

## 十八、验收标准

1. rebuild 模式的第一轮网络记录中没有逐条分类请求；用户先看到目录结构。
2. 用户把“其他”之外的目录改名后，第二轮分类 prompt 使用新名字，旧名字不再出现于候选目录。
3. 用户新增一级类型后，该类型进入分类 schema；至少一条模型结果可以合法指向它并出现在复核页对应分组。
4. 用户删除或合并的来源目录不再进入第二轮候选。
5. 第二轮无论实际分布如何，都不会静默改变用户确认的目录集合和层级；越线只告警。
6. 结构页关闭重开可恢复；分类中断后可从同一草案和编辑重试。
7. 两轮之间书签集合或 URL 改变时不会套用过期草案。
8. additive、title-only、复核、应用、撤销和旧缓存格式无行为回归。
9. 没有实际书签进入的新增目录不会被创建；实际落地目录编号连续。
10. 全量测试与构建通过。
