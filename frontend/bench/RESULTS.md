# Lean bench, 2026-10-14

Four small tasks on the fixture (a new helper, a bug fix, input validation, a monthly report), each
run twice with Lean off and twice with Lean on, through Claude Code (Sonnet) and Codex (gpt-6.1-sol,
medium effort), with the flags dhrive gives a task left alone. Means per run.

| CLI | Lean | runs | input tokens | of it cached | output tokens | seconds | closing text | done |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | off | 8 | 202k | 88% | 1,133 | 17.4 | 528 chars | 8/8 |
| Claude Code | on | 8 | 197k | 88% | 1,059 | 16.0 | 347 chars | 8/8 |
| Codex | off | 8 | 154k | 85% | 2,028 | 59 | 852 chars | 8/8 |
| Codex | on | 8 | 180k | 87% | 1,902 | 68 | 296 chars | 8/8 |

- Lean cuts what the agent says at the end by a third on Claude Code and by two thirds on Codex, and
  output tokens by about 6% on both: most output is the code itself (and, on Codex, its reasoning).
- No task got worse: every run changed the project and passed lint, typecheck, test and build.
- Input doesn't follow: it is the context re-sent on every turn (about 190k for a small task on
  Claude Code, mostly cached). Codex's lean runs read more (+17%) with two long runs among eight; at
  this size that is within the spread, not a finding.
- The next lever is the number of turns, not the words: every tool call re-sends the whole context.

"Done" means the run changed the project and all four checks passed after it. One Claude Code run
with Lean off committed its own work; it counts as changed.
