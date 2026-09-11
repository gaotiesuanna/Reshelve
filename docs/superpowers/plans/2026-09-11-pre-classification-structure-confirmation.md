# Pre-Classification Structure Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split rebuild-mode organization into a recoverable structure-design task and a user-confirmed classification task so the edited folder names and added top-level types are the exact candidates seen by the classifier.

**Architecture:** Keep `analyze` as the mode-detecting entry point, but return a serializable `StructureDraft` before per-bookmark classification when rebuild mode is selected. Compile and validate edits with pure functions in `core/structure.ts`; persist the draft independently of the task journal; then run `classify_structure` against a fresh scan and a frozen compiled candidate tree. Additive and title-only analysis continue to return a final `OrganizePlan` directly.

**Tech Stack:** TypeScript 5, React 19, Zustand, Chrome MV3 service worker APIs, Vitest, Testing Library, Vite.

**Spec:** `docs/superpowers/specs/2026-09-11-pre-classification-structure-confirmation-design.md`

## Global Constraints

- Do not rename historical `tidymark:*` storage keys or compatibility export prefixes.
- Additive mode and title-only mode must still finish in one `analyze` request and return a final plan.
- Rebuild mode must not call `classifyBookmarks` until the user confirms a valid structure.
- Confirmed candidate names, additions, removals, and merges must be compiled before classification and must therefore affect the classifier prompt and existing cache key.
- The user may add top-level types only; added IDs use `tmp:user:<uuid>`, and the fallback name is reserved.
- After confirmation, classification may measure and warn but must not add, remove, rename, collapse, deepen, promote, or otherwise mutate semantic structure.
- A second-stage scan must reject added/removed bookmarks, URL changes, and missing scope roots; title, parent, path, and index changes remain valid.
- API keys must never be serialized into drafts, checkpoints, task records, or exports.
- The structure checkpoint uses `chrome.storage.session`, survives sidepanel and service-worker lifecycle changes within the browser session, and is independent of the single-slot task journal.
- Classification batching, concurrency, URL folding, rules, cache format, retry, truncation splitting, review, apply, undo, and no-empty-folder apply behavior remain unchanged.
- Every production change follows RED-GREEN-REFACTOR: write a behavior test, run it and observe the intended failure, then implement the minimum behavior and rerun the focused test.
- Each task ends with its focused tests plus `npm run build`; the final controller runs the complete suite once after all tasks.
- Per the user’s execution instruction, do not dispatch task reviewers or a final code-review subagent; the user will perform the final human review.

---

### Task 1: Serializable Structure Draft and Pure Edit Compiler

**Files:**
- Modify: `src/core/structure.ts`
- Modify: `tests/core/structure.test.ts`

**Interfaces:**
- Consumes: `Locale`, `CategoryCandidate`, `TagResult`, `NewFolderSpec`, `RenameFolderSpec`, `FolderMoveSpec`, and `OrganizePlan['mergeRoot']`.
- Produces: `StructureDraft`, `StructureCheckpoint`, `EstimatedAssignment`, `AddedStructureNode`, `CompiledStructure`, `StructureValidation`, `EMPTY_EDITS`, `bookmarkFingerprint`, `sameBookmarkFingerprint`, `estimateAssignments`, `validateStructureEdits`, `applyStructureEditsToDraft`, and `buildStructureView(draft, edits, locale)`.
- Compatibility: retain the existing `applyStructureEdits(plan, edits, locale)` export through Task 5 so the current store compiles while the new flow is introduced.

- [ ] **Step 1: Add failing tests for draft fingerprints and estimated assignments**

Add literal fixtures and tests that prove ordering does not affect fingerprints, URL changes do, normalized unnumbered paths map to one candidate, and ambiguous or missing paths map to `null`:

```ts
it('fingerprint ignores scan order but detects URL changes', () => {
  const a = bookmarkFingerprint([
    { id: 'b2', url: 'https://two.test' },
    { id: 'b1', url: 'https://one.test' },
  ])
  expect(a).toEqual([
    { id: 'b1', url: 'https://one.test' },
    { id: 'b2', url: 'https://two.test' },
  ])
  expect(sameBookmarkFingerprint(a, [...a].reverse())).toBe(true)
  expect(sameBookmarkFingerprint(a, [{ id: 'b1', url: 'https://changed.test' }, a[1]!])).toBe(false)
})

it('estimates only a unique normalized candidate path', () => {
  expect(estimateAssignments(
    [{ bookmarkId: 'b1', primaryTopic: '代码', secondaryTopic: 'React' }],
    [{ id: 'c1', path: ['01 代码', '01 React'] }],
  )).toEqual([{ bookmarkId: 'b1', targetCategoryId: 'c1' }])
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- tests/core/structure.test.ts`

Expected: FAIL because the draft and fingerprint/estimation exports do not exist.

- [ ] **Step 3: Add the serializable model and helper signatures**

Define the exact public shapes in `src/core/structure.ts`:

```ts
export interface EstimatedAssignment {
  bookmarkId: string
  targetCategoryId: string | null
}

export interface AddedStructureNode {
  temporaryId: string
  parentCategoryId: null
  title: string
}

export interface StructureEdits {
  renames: Record<string, string>
  removed: string[]
  mergedInto: Record<string, string>
  added: AddedStructureNode[]
}

export interface StructureDraft {
  id: string
  createdAt: number
  scopeRootIds: string[]
  destinationRootId: string
  locale: Locale
  llm: { baseUrl: string; model: string }
  totalBookmarks: number
  bookmarkFingerprint: Array<{ id: string; url: string }>
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  renameFolders: RenameFolderSpec[]
  folderMoves: FolderMoveSpec[]
  mergeRoot: OrganizePlan['mergeRoot']
  tags: TagResult[]
  sourceTags: TagResult[]
  estimatedAssignments: EstimatedAssignment[]
  rootLevel: number
  deepenCap: number
  warnings: string[]
  rewriteGithubTitles: boolean
}

export interface StructureCheckpoint {
  draft: StructureDraft
  edits: StructureEdits
  state: 'awaiting_confirmation' | 'classifying'
  updatedAt: number
}
```

Set `EMPTY_EDITS` to `{ renames: {}, removed: [], mergedInto: {}, added: [] }`. Implement sorted `{id,url}` fingerprints and estimated assignment matching with `normalizeName(stripNumberPrefix(segment))` on every path segment. A tag maps by `[primaryTopic]` when `secondaryTopic` is null and by `[primaryTopic, secondaryTopic]` otherwise; any match count other than one returns `null`.

- [ ] **Step 4: Add failing tests for validation and deterministic compilation**

Cover all observable edit semantics with hand-derived results:

```ts
it('compiles rename, subtree removal, same-parent merge, and a user top-level node', () => {
  const result = applyStructureEditsToDraft(draft, {
    renames: { topA: 'Engineering' },
    removed: ['childA', 'topB'],
    mergedInto: { topB: 'fallback' },
    added: [{ temporaryId: 'tmp:user:123', parentCategoryId: null, title: 'Research' }],
  }, 'en')

  expect(result.validation.errors).toEqual([])
  expect(result.candidates.map((candidate) => candidate.path)).toEqual([
    ['01 Engineering'],
    ['02 Research'],
    ['03 Other'],
  ])
  expect(result.estimatedAssignments).toEqual([
    { bookmarkId: 'a', targetCategoryId: 'topA' },
    { bookmarkId: 'b', targetCategoryId: 'fallback' },
  ])
})
```

Add separate failures for blank names, normalized sibling duplicates, reserved fallback additions, unknown/cross-parent/cyclic merges, removing every candidate, malformed `tmp:user:` IDs, and an added node with non-null parent. Assert that top-level user nodes are inserted immediately before fallback and that all level-one and level-two display prefixes are compact and continuous after edits.

- [ ] **Step 5: Run the focused tests and verify RED**

Run: `npm test -- tests/core/structure.test.ts`

Expected: FAIL because validation and draft compilation are absent.

- [ ] **Step 6: Implement validation, edit resolution, renumbering, and draft rendering**

Add these exact return contracts:

```ts
export interface StructureValidation {
  errors: Array<{ nodeId: string | null; code: string; message: string }>
  warnings: string[]
}

export interface CompiledStructure {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  renameFolders: RenameFolderSpec[]
  folderMoves: FolderMoveSpec[]
  mergeRoot: OrganizePlan['mergeRoot']
  estimatedAssignments: EstimatedAssignment[]
  validation: StructureValidation
}

export function validateStructureEdits(
  draft: StructureDraft,
  edits: StructureEdits,
  locale: Locale,
): StructureValidation

export function applyStructureEditsToDraft(
  draft: StructureDraft,
  edits: StructureEdits,
  locale: Locale,
): CompiledStructure
```

Resolve merge chains before removal, require source and destination to share a parent, reject cycles, and remap estimated targets from merged sources to their final receivers. Removing a top-level candidate removes descendants; plain deletion maps affected estimates to `null`. Synchronize renamed paths, `NewFolderSpec.title`, `RenameFolderSpec.newTitle`, merge-root title/prefixes, and descendants. Added top-level specs use `parentTemporaryId: draft.mergeRoot?.temporaryId ?? null` and `parentId: draft.mergeRoot === null ? draft.destinationRootId : null`. Preserve candidate display order, insert additions before fallback, then renumber each sibling list using the repository’s existing two-digit prefix convention. Build counts from compiled estimated assignments; a top-level `StructureNode.count` includes descendants, while a child count is direct only.

- [ ] **Step 7: Run focused tests and build**

Run: `npm test -- tests/core/structure.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/structure.ts tests/core/structure.test.ts
git commit -m "feat(structure): compile editable structure drafts"
```

---

### Task 2: Pre-Confirmation Structural Audit on Estimated Assignments

**Files:**
- Modify: `src/core/prune.ts`
- Modify: `src/core/audit.ts`
- Modify: `tests/core/prune.test.ts`
- Modify: `tests/core/audit.test.ts`

**Interfaces:**
- Consumes: `EstimatedAssignment` from Task 1 and the existing candidate/new-folder inputs.
- Produces: generic target-remapping audit primitives that accept records containing `{ bookmarkId: string; targetCategoryId: string | null }` without requiring confidence, reason, topic, or source.
- Compatibility: existing `Classification[]` callers and their reason-rewriting behavior must remain unchanged until Task 3 moves rebuild audit before classification.

- [ ] **Step 1: Add failing tests proving audit primitives accept estimates**

Add tests that pass plain estimated assignments into pruning, collapse, expansion target remapping, and fallback-child promotion. Assert literal candidate IDs and targets after each mutation. Include a test where a `Classification` retains its extra fields and existing prune reason, proving the generic path does not strip data.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- tests/core/prune.test.ts tests/core/audit.test.ts`

Expected: FAIL because current APIs require and rewrite full `Classification` objects.

- [ ] **Step 3: Extract the target-only contract and thin wrappers**

Use a structural generic rather than duplicating the algorithms:

```ts
export interface TargetAssignment {
  bookmarkId: string
  targetCategoryId: string | null
}

export function remapAssignmentTargets<T extends TargetAssignment>(
  assignments: readonly T[],
  targetMap: ReadonlyMap<string, string | null>,
): T[] {
  return assignments.map((assignment) => {
    if (!targetMap.has(assignment.targetCategoryId ?? '')) return { ...assignment }
    return { ...assignment, targetCategoryId: targetMap.get(assignment.targetCategoryId!) ?? null }
  })
}
```

Parameterize the structural count/removal/remap logic over `T extends TargetAssignment`. Keep classification-only reason text in a wrapper used by the legacy post-classification path. Do not maintain a second count/prune/promote algorithm for estimates.

- [ ] **Step 4: Run focused tests and build**

Run: `npm test -- tests/core/prune.test.ts tests/core/audit.test.ts && npm run build`

Expected: PASS with all legacy audit tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/core/prune.ts src/core/audit.ts tests/core/prune.test.ts tests/core/audit.test.ts
git commit -m "refactor(audit): support target-only assignments"
```

---

### Task 3: Rebuild Design Stage and Frozen Classification Stage

**Files:**
- Create: `src/background/rebuild.ts`
- Create: `tests/background/rebuild.test.ts`
- Modify: `src/background/handlers.ts`
- Modify: `tests/background/handlers.test.ts`

**Interfaces:**
- Consumes: Task 1 draft/compiler APIs, Task 2 target-only audit APIs, existing `extractTags`, `designTagFolders`, `designFolders`, `buildCategoryTree`, `classifyBookmarks`, `planTitleRewrites`, and `buildPlan`.
- Produces: `designRebuildDraft(input): Promise<StructureDraft>` and `classifyRebuildDraft(input): Promise<OrganizePlan>` in `src/background/rebuild.ts`; `handle()` dispatches them from `analyze` and `classify_structure`.
- The helper input carries resolved scan/roots/settings/client/progress/cancellation dependencies rather than reading Chrome globals.

- [ ] **Step 1: Add failing design-stage tests**

Create `tests/background/rebuild.test.ts` with injected fake LLM helpers. Prove that design returns a serializable draft containing locale/model metadata, both tag generations, estimates, structural warnings/moves, destination root, and fingerprint. Spy on classification and assert it is not called. Add a handler test asserting rebuild `analyze` returns:

```ts
{
  ok: true,
  kind: 'analyze',
  outcome: 'structure',
  draft: expect.objectContaining({ scopeRootIds: ['1'] }),
}
```

Keep additive and title-only expectations explicit as `outcome: 'plan'`.

- [ ] **Step 2: Run design tests and verify RED**

Run: `npm test -- tests/background/rebuild.test.ts tests/background/handlers.test.ts`

Expected: FAIL because rebuild analysis still classifies and returns a plan.

- [ ] **Step 3: Extract rebuild design through the pre-classification boundary**

Move only rebuild-specific orchestration from `handlers.ts` into `designRebuildDraft`. Preserve current shape derivation, merge-root naming, tag extraction/design, tree creation, collapse, prune, deepen, re-prune, and fallback promotion ordering. Replace those routines’ classification inputs with `estimatedAssignments`. Remove the prune-time LLM rehome call: after prune, remap estimates for preview/audit and let second-stage classification choose from the surviving complete candidate set. Return the post-audit candidates/specs/moves and all required scalar metadata in `StructureDraft` immediately before the current first `classifyBookmarks` call.

- [ ] **Step 4: Add failing second-stage tests**

Test all second-stage gates:

- edited/added compiled paths are the exact candidates passed to `classifyBookmarks`;
- removed candidates are absent;
- `includeTopicRule` remains `false`;
- matching `{id,url}` with changed title/path/index is accepted and fresh scan items reach `buildPlan`;
- added/removed bookmarks, URL changes, and missing roots reject with the localized stale-draft error;
- missing endpoint/model rejects without exposing an API key;
- actual occupancy produces warnings but leaves candidate IDs, paths, and hierarchy byte-for-byte equal to the compiled structure;
- title rewrites use the draft’s `rewriteGithubTitles` decision;
- classification cancellation returns the existing cancelled response shape.

- [ ] **Step 5: Run second-stage tests and verify RED**

Run: `npm test -- tests/background/rebuild.test.ts tests/background/handlers.test.ts`

Expected: FAIL because `classify_structure` and stale-draft validation do not exist.

- [ ] **Step 6: Implement frozen classification and handler outcomes**

Define helper contracts in `src/background/rebuild.ts`:

```ts
export interface DesignRebuildDraftInput {
  id: string
  createdAt: number
  scopeRootIds: string[]
  destinationRootId: string
  locale: Locale
  llm: { baseUrl: string; model: string }
  rewriteGithubTitles: boolean
  scan: ScanResult
  roots: FolderItem[]
  client: LlmClient
  concurrency: number
  batchSize?: number
  emit: EmitProgress
  isCancelled: () => boolean
}

export interface ClassifyRebuildDraftInput {
  draft: StructureDraft
  edits: StructureEdits
  locale: Locale
  scan: ScanResult
  roots: FolderItem[]
  client: LlmClient
  concurrency: number
  batchSize?: number
  emit: EmitProgress
  isCancelled: () => boolean
  cache: Record<string, CachedClassification>
}
```

The exact cache container type may follow `loadCache`’s existing return type, but no cache serialization format changes. In `classifyRebuildDraft`, call `applyStructureEditsToDraft`, reject any validation errors before LLM work, compare sorted fingerprints, classify once with the compiled candidates, then only call measurement functions (`measureTopSiblings`, `findOversizedFolders`, `measureFallbackShare`) to append warnings. Do not call prune/collapse/expand/promote/design after `classifyBookmarks`. Build the final plan with compiled specs, fresh scan items, draft tags, draft scope IDs, and a new `plan-${now()}` ID.

Update `handle()` so title-only/additive return `{ ok: true, kind: 'analyze', outcome: 'plan', plan }`, rebuild returns `{ ok: true, kind: 'analyze', outcome: 'structure', draft }`, and `classify_structure` rescans and resolves the draft-bound endpoint/model from current settings before calling the helper.

- [ ] **Step 7: Run focused tests and build**

Run: `npm test -- tests/background/rebuild.test.ts tests/background/handlers.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/background/rebuild.ts tests/background/rebuild.test.ts src/background/handlers.ts tests/background/handlers.test.ts
git commit -m "feat(background): split rebuild design from classification"
```

---

### Task 4: Message Contracts, Checkpoint Storage, and Service-Worker Lifecycle

**Files:**
- Modify: `src/background/messages.ts`
- Create: `src/background/structure-checkpoint.ts`
- Create: `tests/background/structure-checkpoint.test.ts`
- Modify: `src/background/service-worker.ts`
- Modify: `tests/background/service-worker.test.ts`
- Modify: `src/background/events.ts`

**Interfaces:**
- Consumes: `StructureDraft`, `StructureEdits`, and `StructureCheckpoint` from Task 1; handler behavior from Task 3.
- Produces: discriminated `AnalyzeResponse`, `classify_structure` request/response, `get_structure_checkpoint`, `save_structure_checkpoint`, `clear_structure_checkpoint`, and checkpoint storage functions.

- [ ] **Step 1: Add failing storage adapter tests**

Test the exact key and serialization behavior:

```ts
expect(STRUCTURE_CHECKPOINT_KEY).toBe('reshelve:structure-checkpoint')
await writeStructureCheckpoint(storage, checkpoint)
expect(await readStructureCheckpoint(storage)).toEqual(checkpoint)
await clearStructureCheckpoint(storage)
expect(await readStructureCheckpoint(storage)).toBeNull()
```

Also assert `writeStructureCheckpoint` retries no lossy rewrite: unlike task events, a structure draft has no discardable event buffer.

- [ ] **Step 2: Run checkpoint tests and verify RED**

Run: `npm test -- tests/background/structure-checkpoint.test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement checkpoint storage and message unions**

In `messages.ts`, add:

```ts
| { kind: 'classify_structure'; draft: StructureDraft; edits: StructureEdits }

type AnalyzeResponse =
  | { ok: true; kind: 'analyze'; outcome: 'plan'; plan: OrganizePlan }
  | { ok: true; kind: 'analyze'; outcome: 'structure'; draft: StructureDraft }
```

Add the three checkpoint requests to `ControlRequest` and corresponding responses to `Response`. Extend the task-kind type in `events.ts` so task records can represent `classify_structure`.

- [ ] **Step 4: Add failing service-worker lifecycle tests**

Prove these sequences with the fake `chrome.storage.session` used by existing tests:

1. A rebuild `analyze` response is checkpointed as `awaiting_confirmation` before `sendResponse` observes it.
2. `save_structure_checkpoint` replaces the whole edits object and updated timestamp.
3. `classify_structure` writes `classifying` before invoking `handle`.
4. Failure, cancellation, or rejected promise keeps the checkpoint.
5. Success returns the final plan and keeps the checkpoint until the panel explicitly clears it.
6. Checkpoint control messages do not claim the exclusive task lock.
7. `classify_structure` is exclusive and cancellable and uses keepalive.

- [ ] **Step 5: Run service-worker tests and verify RED**

Run: `npm test -- tests/background/service-worker.test.ts`

Expected: FAIL because the service worker does not manage structure checkpoints or classify tasks.

- [ ] **Step 6: Wire service-worker storage ordering and task policy**

Use the same `TaskStorage` adapter shape as `task-journal.ts`. Add `classify_structure` to `EXCLUSIVE` and `CANCELLABLE`. Handle checkpoint control requests before casting to `Request`. For successful rebuild `analyze`, `await writeStructureCheckpoint(...)` before `task.end(response)` and `sendResponse(response)`. Before second-stage handler execution, write `{ draft, edits, state: 'classifying', updatedAt: Date.now() }`. Never clear the checkpoint automatically in worker success/failure paths; the panel clears only after adopting the final plan.

- [ ] **Step 7: Run focused tests and build**

Run: `npm test -- tests/background/structure-checkpoint.test.ts tests/background/service-worker.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/background/messages.ts src/background/events.ts src/background/structure-checkpoint.ts tests/background/structure-checkpoint.test.ts src/background/service-worker.ts tests/background/service-worker.test.ts
git commit -m "feat(background): persist structure workflow checkpoints"
```

---

### Task 5: Sidepanel Store State Machine and Recovery

**Files:**
- Modify: `src/sidepanel/store.ts`
- Modify: `tests/sidepanel/store.test.ts`

**Interfaces:**
- Consumes: Task 4 message outcomes/control requests and Task 1 draft/compiler/validation APIs.
- Produces: store fields `structureDraft: StructureDraft | null`, `structureValidation: StructureValidation`, retry target `'classify_structure'`, and actions `addStructureNode()`, async `confirmStructure()`, and checkpoint-aware edit/recovery/reset behavior.
- Removes: the structure step’s dependence on a partial/final `plan`; final `plan` remains null until classification succeeds.

- [ ] **Step 1: Add failing analyze outcome and checkpoint recovery tests**

Update analyze mocks to include explicit outcomes. Add tests proving:

- `outcome: 'structure'` stores `draft`, resets edits, leaves `plan` null, and enters `structure`;
- `outcome: 'plan'` stores the plan and enters `review` for additive/title-only;
- init adopts a finished rebuild-design task as structure state;
- init with no usable task result restores `get_structure_checkpoint` into structure state;
- a finished `classify_structure` task wins over an older checkpoint, stores the plan, selects all rows, enters review, then sends `clear_structure_checkpoint`;
- an interrupted/failed/cancelled classify task restores draft and edits and exposes a classification retry without regenerating design.

- [ ] **Step 2: Run recovery tests and verify RED**

Run: `npm test -- tests/sidepanel/store.test.ts`

Expected: FAIL because the store only understands final analyze plans.

- [ ] **Step 3: Implement draft state and restore precedence**

Add state and action signatures:

```ts
structureDraft: StructureDraft | null
structureValidation: StructureValidation
retryable: 'scan' | 'analyze' | 'classify_structure' | null
addStructureNode(): void
confirmStructure(): Promise<void>
```

Adoption precedence is: a successful terminal task result first; otherwise a checkpoint; otherwise current normal initialization. A rebuild-design result enters structure with `EMPTY_EDITS`. A classify success sets the plan before awaiting checkpoint clear so UI correctness does not depend on storage cleanup.

- [ ] **Step 4: Add failing edit persistence and confirmation tests**

For rename/remove/merge/add, assert the updated full `{draft, edits, state:'awaiting_confirmation'}` is sent immediately through `save_structure_checkpoint`. Stub UUID generation with `vi.stubGlobal('crypto', { randomUUID: () => '1234' })` and expect `tmp:user:1234`. Assert invalid edits disable classification at the action layer: `confirmStructure()` makes no `classify_structure` call and leaves the validation error. Assert valid confirmation sends the exact current draft/edits, keeps the step on `structure` while busy, then moves to review only after a final plan response. Failure/cancel keeps draft and edits and sets `retryable: 'classify_structure'`.

- [ ] **Step 5: Run edit tests and verify RED**

Run: `npm test -- tests/sidepanel/store.test.ts`

Expected: FAIL because edits are local-only, add does not exist, and confirm rewrites an already-classified plan synchronously.

- [ ] **Step 6: Implement persistence, classify send, abandon, retry, and reset**

After each edit, compute the next edits object first, set it, and fire-and-forget:

```ts
void send({
  kind: 'save_structure_checkpoint',
  checkpoint: {
    draft,
    edits: nextEdits,
    state: 'awaiting_confirmation',
    updatedAt: Date.now(),
  },
})
```

`addStructureNode` inserts `{ temporaryId: `tmp:user:${crypto.randomUUID()}`, parentCategoryId: null, title: t('structureNewTypeDefault') }`. `confirmStructure` validates, sends `classify_structure`, preserves the draft and edits throughout the request, selects all final plan rows on success, and clears the checkpoint after adopting the plan. `retry()` dispatches `confirmStructure` for the classification retry case. `backToPreferences`, `reset`, and the beginning of a new analyze clear draft/edits and fire `clear_structure_checkpoint`; returning to preferences does not retain a stale design. Remove use of legacy `applyStructureEdits` from the store.

- [ ] **Step 7: Run focused tests and build**

Run: `npm test -- tests/sidepanel/store.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel/store.ts tests/sidepanel/store.test.ts
git commit -m "feat(sidepanel): orchestrate confirmed structure classification"
```

---

### Task 6: Editable Structure UI, Validation, and Bilingual Copy

**Files:**
- Modify: `src/sidepanel/steps/StructureStep.tsx`
- Modify: `tests/sidepanel/StructureStep.test.tsx`
- Modify: `src/i18n/messages.ts`
- Modify: `tests/i18n/messages.test.ts`
- Modify: `tests/sidepanel/english-ui.test.tsx`

**Interfaces:**
- Consumes: `structureDraft`, `structureEdits`, `structureValidation`, async `confirmStructure`, and `addStructureNode` from Task 5; `buildStructureView(draft, edits, locale)` from Task 1.
- Produces: a structure preview with estimated counts, add-top-level control, inline validation/warnings, and the primary action “确认结构并开始分类” / “Confirm structure and classify”.

- [ ] **Step 1: Add failing UI behavior tests**

Replace plan fixtures with `StructureDraft` fixtures. Assert:

- the explanatory copy says counts are estimates and actual totals are known after classification;
- top-level counts include descendants and child counts remain direct;
- “Add type” inserts a top-level editable row immediately before fallback;
- no add-child or drag/move affordance exists;
- fallback remains non-editable/non-removable and is still a merge receiver;
- blank, normalized duplicate, reserved fallback, and last-candidate errors appear inline and disable the primary button;
- suggested sibling-limit overflow appears as a warning but does not disable the button;
- clicking valid primary action awaits `confirmStructure` and stays on the structure screen while busy;
- the button label is the new classification action in both locales;
- merge-root warning and source-folder deletion notice remain visible.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npm test -- tests/sidepanel/StructureStep.test.tsx tests/sidepanel/english-ui.test.tsx tests/i18n/messages.test.ts`

Expected: FAIL because the component still renders a completed plan and offers only “view move list”.

- [ ] **Step 3: Implement the draft-based component**

Read `structureDraft` instead of `plan`. Derive nodes and validation with `useMemo`; keep row inputs controlled by edits. Render errors adjacent to their node when `nodeId` is known and render global errors/warnings above the sticky action bar. Add a secondary “新增类型” / “Add type” button below the top-level list and before the fallback explanation. Disable the primary button when `validation.errors.length > 0` or the store is busy, and invoke `void confirmStructure()` on click. Keep merge selectors limited to siblings and preserve the current hover/focus controls.

- [ ] **Step 4: Add exact bilingual message entries**

Add keys for these meanings, with natural Chinese and English equivalents:

```ts
structureEstimateHint: '以下数量为预计值，实际数量将在逐条分类完成后确定。'
structureAddType: '新增类型'
structureNewTypeDefault: '新类型'
structureConfirmAndClassify: '确认结构并开始分类'
structureClassifying: '正在按确认后的结构分类…'
structureStaleDraft: '书签范围已变化，请重新生成结构。'
structureInvalid: '请先修正目录结构中的问题。'
```

Use the existing `Messages` key typing and provide English strings for every new key. Tests should assert behavior or rendered copy, not grep source text.

- [ ] **Step 5: Run focused tests and build**

Run: `npm test -- tests/sidepanel/StructureStep.test.tsx tests/sidepanel/english-ui.test.tsx tests/i18n/messages.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/steps/StructureStep.tsx tests/sidepanel/StructureStep.test.tsx src/i18n/messages.ts tests/i18n/messages.test.ts tests/sidepanel/english-ui.test.tsx
git commit -m "feat(sidepanel): confirm structure before classification"
```

---

### Task 7: End-to-End Workflow Regression Coverage and Legacy Cleanup

**Files:**
- Modify: `tests/background/handlers.test.ts`
- Modify: `tests/background/service-worker.test.ts`
- Modify: `tests/sidepanel/store.test.ts`
- Modify: `tests/sidepanel/App.test.tsx`
- Modify: `tests/smoke.test.ts`
- Modify: `src/core/structure.ts`

**Interfaces:**
- Consumes: all previous task interfaces.
- Produces: one integrated regression harness for rebuild design → checkpoint → edit → classify → review, and removes the legacy post-classification `applyStructureEdits` path once no production caller remains.

- [ ] **Step 1: Add the failing integrated workflow test**

Drive the real message/store boundaries with fake ports and storage:

1. Start rebuild analyze and assert no classify network call.
2. Receive a draft and checkpoint.
3. Rename one candidate, remove one, merge one, and add `tmp:user:fixed`.
4. Confirm and assert the classifier candidate schema contains the renamed and added paths and excludes removed/merged source paths.
5. Resolve classifications into the renamed and added candidates.
6. Assert the final plan reaches review, selected rows include both destinations, no empty added directory operation survives when unused in a second fixture, and checkpoint clear is requested.

Name the test by the regression it prevents: `rebuild never classifies before confirmation and classifies against the confirmed tree`.

- [ ] **Step 2: Run the integrated test and verify RED if any seam is missing**

Run: `npm test -- tests/background/handlers.test.ts tests/background/service-worker.test.ts tests/sidepanel/store.test.ts tests/sidepanel/App.test.tsx tests/smoke.test.ts`

Expected: PASS only when all cross-layer contracts align; otherwise observe the concrete seam failure before changing production code.

- [ ] **Step 3: Fix only cross-layer mismatches exposed by the test**

Keep the discriminants and request names exact. Ensure `TaskRecord.kind` and busy/cancel UI recognize `classify_structure`; ensure App continues rendering `StructureStep` for `step === 'structure'`; ensure a classify error does not replace structure UI with review/result; ensure checkpoint control responses are accepted by `send`; and ensure no service-worker path clears the checkpoint before the store has adopted the final plan.

- [ ] **Step 4: Remove the legacy plan-edit compiler**

Run `rg -n "applyStructureEdits\(" src tests`. When no production caller remains, delete `applyStructureEdits` and its plan-row rewriting helpers from `src/core/structure.ts`; migrate or delete only tests that exclusively assert the obsolete post-classification behavior. Keep `buildStructureView` draft-based and keep all new compiler tests.

- [ ] **Step 5: Run the focused regression set and build**

Run: `npm test -- tests/background/handlers.test.ts tests/background/service-worker.test.ts tests/sidepanel/store.test.ts tests/sidepanel/App.test.tsx tests/smoke.test.ts tests/core/structure.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/structure.ts tests/background/handlers.test.ts tests/background/service-worker.test.ts tests/sidepanel/store.test.ts tests/sidepanel/App.test.tsx tests/smoke.test.ts tests/core/structure.test.ts
git commit -m "test: cover confirmed rebuild workflow end to end"
```

---

## Controller Final Verification

These are controller-owned verification steps after Task 7; they are not a review dispatch.

- [ ] Run the complete test suite from a fresh command:

```bash
npm test
```

Expected: all Vitest files and tests pass with zero failures.

- [ ] Run the production build from a fresh command:

```bash
npm run build
```

Expected: `tsc --noEmit` and `vite build` both exit 0.

- [ ] Inspect branch scope and commit history:

```bash
git status --short
git log --oneline --decorate --max-count=12
git diff --stat main...HEAD
git diff --check main...HEAD
```

Expected: no unintended uncommitted files, seven implementation commits (or a documented equivalent if a task needed more than one TDD commit), only files named by this plan or directly required type fixtures changed, and no whitespace errors.

- [ ] Hand the branch, plan path, verification evidence, and any recorded rulings to the user for human review. Do not merge, push, publish, or dispatch an automated code reviewer.
