# Claude Code Integration: Hooks, Skills, Agents, and the Plugin

**Status:** design notes. Nothing here is implemented yet.
**Date:** 2026-08-22
**Companion to:** [agent-development-framework-2026-08-18.md](agent-development-framework-2026-08-18.md), [deliverable-ideas-2026-08-22.md](deliverable-ideas-2026-08-22.md)

---

## 1. The placement rule

Claude Code offers four extension surfaces: hooks (deterministic programs the harness runs around
tool calls), MCP servers (tools the model calls on demand), skills (prompt-level instructions loaded
into context), and agents (subagent definitions with their own context and tool set). Each surface
has different economics, and this project's central bet — prompts are advisory, a failing build is
not — dictates where each responsibility lives:

- **Anything mechanically checkable goes in a hook.** A hook runs on every relevant event, costs
  zero context tokens, cannot be rationalized around, and does not get dumber when the model does.
- **Anything queryable goes in the MCP server.** Questions ("is the repo green?", "where is this
  defined?") are pull, not push; the model asks when it needs to know.
- **Only the genuinely uncheckable residue goes in skills.** Process virtues — how to think about a
  spike, when a property test beats an example — have no mechanical check, so prompt-level guidance
  is the only available home. Everything else placed in a skill is a rule waiting to be gamed while
  paying context rent in every session.
- **Agents are for isolation**, of context (a reviewer that has not seen the implementation's
  excuses), of risk (a migrator in a worktree), or of cost (a cheap model doing mechanical work
  behind a strong verifier).

Everything below delegates to the `platonic` CLI underneath. The Claude layer stays a thin adapter,
so a second agent platform is a new adapter, not new logic.

---

## 2. Hooks

In priority order.

1. **Post-edit gate verdict.** After every Edit/Write, read the current state of the persistent
   `tsc --watch` / `vitest --watch` daemons and return a compact, root-cause-deduplicated verdict:
   green, or the smallest useful description of why not. This is the framework notes' section 6
   made real, and the largest single token saver — the agent never launches a build and never reads
   raw compiler output.
2. **Protected files.** Before an edit, refuse agent writes to supervisor-owned configuration:
   `tsconfig.json`, the ESLint configuration, and the ratchet baseline (the "ratchet gaming through
   configuration" risk). Additionally, flag any edit to a test file during a bug-fix task for
   supervisor review — the [TDD report](tdd-for-agents-2026-08-22.md) rule that the specification
   must not be writable by the thing being specified.
3. **File claims.** Before an edit, refuse writes to files claimed by another agent in the work
   ledger. The [worktree report](worktrees-and-branches-for-agents-2026-08-22.md) names this the
   prerequisite for the shared-tree default: without it the ledger is advisory, and the project's
   own thesis is that advisory rules get violated under pressure.
4. **Session-start orientation.** On session start, inject the auto-generated repository index
   (package map, exports, purposes — a few hundred tokens) so every session orients from fresh,
   derived truth instead of grepping and guessing.
5. **Pre-commit gate.** Before any commit, run the full `platonic check` plus the escape-hatch
   ratchet. Nothing else counts as green; no hook, agent instruction, or CI job may invoke a
   subset and call the result passing.

---

## 3. The MCP server

One server, three tools, all backed by the same daemons the hooks read:

| Tool | Answers | Replaces |
|---|---|---|
| Gate verdict | "Is the repo green, and if not, what is the root cause?" | Running builds and reading their output |
| Navigation | Definition, references, rename, quick-info via `tsserver` | Grep, read three files, guess |
| Ratchet status | Current escape-hatch counts vs. baseline | Manual counting, or not checking at all |

The server is a query surface, not an enforcement surface. Enforcement stays in the hooks, which
fire whether or not the model thinks to ask.

---

## 4. Skills

Only the uncheckable residue. Five candidates:

- **House style.** The functional subset's idioms: `Result` over `throw`, expressions over
  statements, type aliases plus factory functions over classes, when a branded type earns its
  ceremony. The linter enforces the letter; the skill teaches the spirit, so agents write
  conforming code on the first attempt instead of iterating against the gate.
- **Spike workflow.** Spikes live in a quarantined directory the gate exempts and shipping packages
  may not import; no tests required inside; promotion out of quarantine is the stabilize step and
  triggers the contract rules (goldens plus properties over the surviving surface); spikes that do
  not promote get deleted.
- **Test policy.** The TDD report's decision rule: test-first is mandatory for bug fixes (the gate
  replays the new test against the pre-fix tree) and public contract changes; properties are
  preferred over examples on pure code; test deletion is gated on mutation score, not intuition.
- **Rule graduation.** When the same correction has been prompted twice, propose promoting it to a
  lint rule, hook, or ratchet entry — and draft the implementation. This is the framework notes'
  section 9 flywheel; noticing repetition is not yet mechanically checkable, so a skill is the
  right trigger.
- **Decision log.** When options were weighed, append the alternatives and the choice to an
  append-only `decisions.md`, satisfying "track the decision-making process" without polluting
  code comments with history.

---

## 5. Agents

- **Mechanic** (cheap model tier). Lint fixes, rename fallout, mechanical migrations under a
  ratchet that makes cheap-model output safe to accept. This is the delegation the ratchet exists
  to enable: the verifier does not get dumber with the worker.
- **Background migrator** (worktree isolation). Dependency upgrades, large mechanical migrations,
  and destructive test runs — long-running work that must not share the gate with foreground
  sessions, per the worktree report's decision rule.
- **Adversarial reviewer.** Reviews diffs attempting to refute them; checks that new tests kill
  mutants rather than restating the implementation; challenges escape-hatch justification comments.
  Runs with fresh context precisely so it has not seen the implementation session's reasoning.
- **Codemod agent.** Given a repo-wide mechanical change, writes and applies an `ast-grep` or
  `ts-morph` rule instead of paying per-site token cost — then reports the rule so it can be kept.

---

## 6. Packaging

All of the above ships as **one Claude Code plugin**: hooks, the MCP server, skills, agents, and a
CLAUDE.md template, every piece delegating to the `platonic` CLI. This is deliverables B6 and B7
from the [deliverable ideas](deliverable-ideas-2026-08-22.md) — the thin Claude adapter over a
portable core. Porting to another agent platform later means a new adapter (an AGENTS.md plus CLI
conventions), not new logic.

---

## 7. What deliberately does not become a skill

Immutability, purity, floating promises, escape-hatch counts, dependency boundaries — everything
the gate can check. A skill rides in every session's context and is interpreted by the same model
it constrains; a hook rides in none and does not negotiate. Superpowers' rationalization-rebuttal
table — pages of prompt text pre-empting the model's excuses for skipping test-first — is the
cautionary example: it is excellent prompt engineering, and it is also documentary evidence that
prompt-level law gets litigated on every invocation. Where a rule can be a program, this project
makes it a program and spends the prompt budget on the residue.
