# UX engineering plan

The working plan for raising dhrive's interaction quality without changing its look: flat panels with
one hairline, near-square corners, IBM Plex, black with white as the only accent, coral for the Claude
mark, red for failure, amber for "needs you". Every phase lands as its own PR with tests and leaves the
app working. This file is the handoff: whoever picks the work up reads it first and updates it last.

## Where it started (2026-10-15 audit)

Five read-only audits of `frontend/src` (and the backend paths they touch): interaction states and the
design system, accessibility against WCAG 2.2 AA, async state and edge cases, rendering performance,
information architecture and journeys. Every finding below was checked in code.

| Dimension | Score | In one line |
| --- | --- | --- |
| Reliability | 1/4 | Auto mode can spin forever; Stop isn't honored between awaits; two writers share a folder |
| Accessibility | 2/4 | Labels and toggles are right; no live regions, no focus management, the terminal traps keys |
| Performance | 2/4 | The open conversation re-renders on every log line of any run; per-run state is never freed |
| Design system | 2/4 | Tokens exist but drift: doubled hairlines, three reds, ~21 primary buttons, 18 font sizes |
| Journeys | 2/4 | Good progress language; one click discards the first delivery; "needs your OK" can be invisible |

## Phases

Each item names its fix and its proof. A finding is done when its test fails before the fix and passes
after it, or, for what a test can't hold, when it is checked in the running app.

### 1. Reliability: no lost work, no run after Stop

1. **Auto mode spins when every open task waits on a failed one** (`store/auto.ts` round/loop,
   `store/day.ts` work). A round that changes no task's status ends Auto mode with the reason; a task
   waiting on a failed or stopped one is blocked and says so; the planner's dependency cycles are
   dropped (`lib/day.ts` parseDay); rounds pause on a real timer. Proof: a store test that freezes
   today (Ollama, A failed, B after A) ends instead of looping.
2. **An unreadable COMPANY.md or doc reads as empty and the next save overwrites it**
   (`src-tauri/src/company.rs`, `documents.rs`, `store/company.ts`, `store/documents.ts`). Reads fail
   loudly except for "not found"; the brief shows the error with Retry and refuses to save until a read
   succeeds. Proof: Rust tests for a non-UTF-8 file; a store test that a failed load never saves.
3. **Stop is a flag the code after an await never re-reads** (`store/runs.ts`, `store/task-run.ts`
   fresh, `store/day.ts` workArmy, `store/founding.ts`; `src-tauri/src/cancel.rs` begin clears an early
   stop). One run token per stage, checked after every await and before a result is applied; the
   backend keeps early stops. Proof: tests that stop during each await and assert nothing starts or
   lands after it.
4. **A conversation's code step and the company's tasks edit the same folder at once**
   (`store/runs.ts` editing lock vs `store/task-run.ts` alone). One lock per folder shared by
   conversation steps, company tasks outside the army, undo and backup; `.company/` stays out of step
   snapshots. Proof: a property test over random interleavings: never two writers in one folder.
5. **"Suggest more" discards the first delivery and its publish** (`store/day.ts` plan). Suggesting
   adds to what waits instead of replacing it, and keeps the first day's flag; while suggestions wait,
   "Add all" is the primary action. Proof: store test.
6. **Small guards**: deleting a company stops its auto mode, tasks, plan, chat and timers; Undo, sign
   out and conversation delete can't fire twice; settings writes that fail say so and roll back.

### 2. Performance on the paths used every minute

1. Live run state leaves `useApp` for its own store, events apply once per frame, and a run's entry is
   freed when it settles. Proof: a test that a settled run leaves no entry; a render count in a test
   harness for the thread during a mocked stream.
2. The open conversation stops subscribing to every run's log: it follows only its running stage, and
   run cards, the composer and the file panel are memoized. Target: zero thread re-renders per log line
   of another run.
3. Live edit diffs are computed once, when the edit arrives.
4. The backend flushes a held log line on a timer, so "doing" is never minutes stale (`proc.rs`).
5. Startup fills the sidebar after the first answer, not the slowest CLI probe, with no wrong empty
   state; the sign-in gate decides before the app shows.
6. Cheap wins: the running pulse animates transform and opacity (no repaint per frame), the site poll
   pauses while hidden, terminals refit once per resize, files are cut before they're highlighted.

### 3. One design system

1. One hairline: `panel` and `popover` utilities carry the surface and its inset; the 33 doubled
   borders go.
2. Tokens for what's repeated by hand: `--failure`, `--live`, hover/selected/pressed levels, six text
   steps with their line heights, two durations and one easing.
3. Primitives used everywhere: Button (variants and sizes the app already uses), Field, Dialog and
   Popover (focus moves in, is held, returns; one Escape stack; inert background), InlineConfirm
   (focus on the safe choice, Escape keeps).

### 4. Accessibility (WCAG 2.2 AA)

1. Terminals: a documented key leaves the pane; output is readable by screen readers.
2. The sign-in gate is a real modal over an inert app.
3. The model picker moves focus in and back.
4. Status is announced: one polite and one assertive live region; approvals are assertive.
5. Focus is always visible: fields get a 3:1 focus style, the ring reaches 3:1, the off switch and
   faint text pass contrast.
6. Actions revealed on hover stay in the layout and in tab order (no row jump, reachable by keyboard).
7. Text can be enlarged (zoom hotkeys) and the layout holds at 200%.
8. Names start with the visible label; the current row says so; "needs your OK" isn't color alone.

### 5. Journeys

1. "Needs your OK" shows for every running task, ahead of the list's cap, with one line on the
   company's overview.
2. Failures surface: a "needs attention" group above Done, the status line counts them, a retry goes
   to the front.
3. The current policy (Ask first, Lean, review) stays visible while work runs; Auto mode warns when
   Ask first would make it wait; Stop ends after the current task, Stop now is the second choice.
4. A founding that fails after the company exists offers to open it and plan again.
5. An ended trial says so where work starts, not only in conversations.
6. Instructions and allowed rules are reachable from the company; ⌘K/⌘O open companies; ⌘N works on
   the company page; one word per concept.
7. Three confirm tiers: reversible (undo), ends work (inline confirm), irreversible (typed).

### 6. Polish

Abrupt swaps and width jumps, drafts kept for every composer, chat scroll that follows only when
pinned, an error queue with context instead of one toast, motion details.

## Rules for the work

- No new dependency without a measured reason; primitives are small and local.
- Business rules stay as they are; where a fix changes behavior (Suggest, Stop, Auto mode), the PR says
  so in its first line.
- Tests come with the fix: store tests for behavior, property tests for concurrency, Rust tests for
  reads and writes.
- After each phase: the app runs from `cargo tauri dev`, the changed flows are walked once, and this
  file's progress log is updated.

## Progress

| Phase | PR | State |
| --- | --- | --- |
| 1. Reliability | | planned |
| 2. Performance | | planned |
| 3. Design system | | planned |
| 4. Accessibility | | planned |
| 5. Journeys | | planned |
| 6. Polish | | planned |
