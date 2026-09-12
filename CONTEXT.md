# Reshelve (TidyMark)

An AI bookmark organizer for Chrome: it reads native bookmarks within a chosen scope,
proposes a reorganization, and lands it only after the user reviews and confirms every
move — always undoable.

## Language

### Organize flow

**Scope**:
The folders the user checked for this run. Unchecked folders are never read and never modified — no bookmark moves out of them, and none moves in.
_Avoid_: selection, range

**Analyze**:
The background run that reads the scope and produces either an organize plan or a structure proposal.
_Avoid_: classify (that is a later step)

**Structure draft**:
The proposed folder tree the user may edit and confirm before any classification happens. Exists only after a redesign is proposed and only until confirmed or discarded.
_Avoid_: skeleton, template

**Structure workflow**:
The passage from a structure draft through the user's confirmation into classification. It has exactly three answers — awaiting confirmation, classifying, or nothing — and the background owns the whole passage, including how it survives a service-worker restart.
_Avoid_: checkpoint protocol, draft state

**Plan**:
The ordered list of proposed bookmark moves and title rewrites produced by an analyze, awaiting the user's per-row acceptance.
_Avoid_: proposal, diff

**Apply**:
Landing the accepted plan rows onto the real bookmark tree, with a snapshot taken first so the whole run can be undone.
_Avoid_: commit, execute

**Undo**:
Restoring the bookmark tree to the snapshot taken before an apply. One click, whole run.
_Avoid_: rollback, revert

**Cleanup**:
The rule-based, model-free mode: dedupe, stale links, title rewrites — scanned and applied separately from the organize flow.
_Avoid_: tidy, fix

### Background tasks

**Task**:
A background operation that occupies the single task slot, broadcasts progress to every open panel, and survives panel close and service-worker restarts. There is at most one task running at a time.
_Avoid_: job, run

**TaskSpec**:
The policy of one request kind: whether it is exclusive, whether it is cancellable, and the label shown while the panel waits. One registry row per request kind, read by both the panel and the service worker.
_Avoid_: busy map, policy table

**Exclusive**:
A request that touches global singletons (the task slot, the bookmark tree, the classify cache) and must reject a second concurrent run outright rather than queue it.
_Avoid_: locked, busy

**Cancellable**:
A task whose background implementation actually reads the cancel signal. Only these get a cancel button in the UI — a button on a task that ignores the signal is a lie.
_Avoid_: interruptible, stoppable
