# Task 3 Report: Rebuild Design Stage and Frozen Classification Stage

## Status

DONE_WITH_CONCERNS

## Commit hash

Implementation commit: `203372ad26f7c8e12d7e032f295636db7f5090d1` (`feat(background): split rebuild design from classification`).

## Changed files

- `src/background/rebuild.ts`
- `src/background/handlers.ts`
- `src/background/messages.ts`
- `src/sidepanel/store.ts`
- `tests/background/rebuild.test.ts`
- `tests/background/handlers.test.ts`
- `tests/background/promote-wiring.test.ts`
- `tests/background/service-worker.test.ts`
- `tests/background/sessions.test.ts`
- `tests/sidepanel/store.test.ts`
- `.superpowers/sdd/2026-09-11-pre-classification-structure-confirmation/task-3-report.md`

## RED evidence

### Design-stage boundary

Command:

```text
npm test -- tests/background/rebuild.test.ts tests/background/handlers.test.ts
```

Result: failed as expected. The new design-stage test observed that rebuild `analyze` still called classification and returned a plan instead of `outcome: 'structure'` with a serializable draft. The run had 1 failing new test while 154 existing focused tests passed.

### Frozen classification stage

Command:

```text
npm test -- tests/background/rebuild.test.ts tests/background/handlers.test.ts
```

Result: failed as expected after adding the second-stage gates. `classify_structure` had no handler branch and returned no response, causing the seven new classification-stage cases to fail before implementation. Existing handler assertions that still encoded post-classification pruning/rehome behavior also failed against the new boundary.

## GREEN evidence

Focused command:

```text
npm test -- tests/background/rebuild.test.ts tests/background/handlers.test.ts
```

Result: 2 test files passed, 163 tests passed.

Full command:

```text
npm test
```

Result: 99 test files passed, 2,092 tests passed.

The focused coverage proves draft serialization and metadata, no classification during design, exact edited/added/surviving classification candidates, removed candidate exclusion, `includeTopicRule: false`, freshness rules, draft-bound model resolution without key leakage, frozen structure after actual occupancy measurement, draft-bound title rewrites, and cancellation behavior.

## Build result

Command:

```text
npm run build
```

Result: passed. TypeScript completed with `--noEmit`; Vite transformed 123 modules and built the extension successfully.

`git diff --check` also passed before the implementation commit.

## Self-review

- Rebuild-only orchestration is isolated in `designRebuildDraft`; additive and title-only paths retain plan outcomes.
- The draft contains locale, endpoint/model identity, both tag generations, estimates, structural specs/moves/warnings, root metadata, and a sorted `{id,url}` fingerprint, but no API key.
- Structure edits are compiled and validated before classification work.
- Freshness uses current roots and bookmark fingerprints, accepting title/path/index changes while rejecting identity or URL changes.
- Classification runs once against the compiled candidates with topic fallback disabled.
- After classification, only occupancy measurements append warnings; no prune, collapse, expand, promote, or design operation mutates the confirmed structure.
- The final plan uses the fresh scan, compiled structure, draft tags/scope, and the draft's title-rewrite decision.
- Completed classification batches are persisted to cache even if a later cancellation or handled error occurs.
- Test fixture updates are limited to the new discriminated response contract and the moved pre-classification audit semantics.

## Concerns

- Task 5 has not yet connected the sidepanel to the structure-confirmation flow. The store currently clears its busy state and does not treat a structure draft as a final plan, preventing an invalid transition but leaving the draft UI integration for that task.
