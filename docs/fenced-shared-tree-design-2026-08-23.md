# Design: A Fenced Shared Tree with a Continuous Gate

**Status:** design exploration.
**Date:** 2026-08-23
**Companion to:** [worktrees-and-branches-for-agents-2026-08-22.md](worktrees-and-branches-for-agents-2026-08-22.md), [agent-development-framework-2026-08-18.md](agent-development-framework-2026-08-18.md)

---

## 1. What this document is

The worktrees report ends with a claim: the alternative to worktree-per-agent — a fenced shared tree with a continuous gate — is undescribed in the practitioner literature "because almost nobody has built one." This document does two things. Section 12 reports the results of a deliberate attempt to falsify that claim. Everything before it describes how such a system could actually work: the major design decisions, the viable options for each, and the pros, cons, risks, and costs of choosing among them.

The target context is inherited from the companions: one human operator, one TypeScript monorepo, 2–5 concurrent Claude Code sessions or subagents, push-to-main, and the twin goals of faster completion and fewer tokens. Where a decision would go differently at team scale, that is noted, but team scale is not the design point.

The system decomposes into five subsystems, each with its own decision space:

1. **Fences** — who may write where, and at what granularity (section 2).
2. **Enforcement** — the mechanism that makes fences real rather than advisory (section 3).
3. **The claim store** — where fence state lives and how it changes (section 4).
4. **The gate** — the continuous verdict machinery, and how verdicts are attributed to agents (sections 5–6).
5. **Commit, rollback, and the supervisor** — how work lands, how it un-lands, and who arbitrates (sections 7–9).

Sections 10–11 cover failure modes and a cost/benefit summary; section 13 gives a recommended configuration.

---

## 2. Decision one: fence granularity

A fence is a unit of exclusive write access. The choice of unit is the deepest decision in the design because everything downstream — claim traffic, conflict rates, verdict attribution — scales with it.

### Option A: package-level fences

The workspace's `package.json` boundaries are the fences. An agent claims a package; while it holds the claim, no other agent may write inside that directory.

- **Pros.** The fence already exists structurally: an undeclared cross-package import does not resolve, so the package manager polices reads for free and the claim system only has to police writes. Claims are few and long-lived, so claim-store traffic is negligible. Attribution of gate failures is nearly automatic — a red verdict in package X belongs to whoever holds X. It matches how tasks are naturally scoped ("fix the parser" claims the parser package).
- **Cons.** Coarse. Two agents cannot work in different corners of one large package, so the effective parallelism ceiling is the package count in the active area — which pushes toward many small packages, a layout pressure the framework document already accepts (its section 8) but which has its own overhead in manifests, build config, and API surface files.
- **Risks.** Shared "utility" packages become contention hot spots. The observed behavior of agents — two agents given adjacent tasks will both "improve" the same helper — lands exactly there.
- **Cost.** Near zero beyond the claim mechanism itself; the boundaries exist anyway.

### Option B: file-level fences

Claims name individual files (or globs). An agent claims the four files it intends to touch.

- **Pros.** Maximal parallelism — two agents can share a package if their file sets are disjoint. Matches the actual unit of collision (last-writer-wins happens at the file, not the package).
- **Cons.** Claim traffic becomes chatty and speculative: agents rarely know the full file set up front, so they either over-claim (reintroducing coarseness, plus deadlock risk when two agents each hold half of what the other needs) or under-claim and hit fence violations mid-task, each of which costs a stall and tokens. Attribution weakens: a red verdict in a file nobody claimed (a downstream consumer of a changed type) belongs to no one obvious.
- **Risks.** Deadlock is real once claims are acquired incrementally. It needs either an ordering rule (claim in path-sorted order), a supervisor arbiter, or timeouts — each of which is more machinery.
- **Cost.** A claim vocabulary, a conflict-resolution policy, and deadlock handling. Perhaps a day or two of tooling beyond option A.

### Option C: directory-subtree fences

Claims name directories at any depth — a middle point that behaves like A when a whole package is claimed and like B when a subfolder is.

- **Pros.** One mechanism covers both scales; the operator can start coarse and let hot packages be subdivided only when contention is actually observed.
- **Cons.** The flexibility is also ambiguity: nested claims need a rule (does claiming `src/parser/` conflict with an existing claim on `src/parser/lexer/`? — yes, overlap must be conflict), and agents must be told which grain to use or they will choose inconsistently.

### Option D: no spatial fences — optimistic detection instead

Skip claims entirely. Let agents write freely; detect collisions after the fact by watching for interleaved writes to the same file (mtime/hash tracking per agent) and force the later writer to re-read and re-apply.

- **Pros.** Zero coordination cost in the common case. This is the CRDT/optimistic-concurrency instinct, and when tasks are genuinely disjoint it is free.
- **Cons.** It converts a prevented error into a detected one, and detection arrives after tokens were spent producing the clobbered edit. Worse, "re-read and re-apply" is exactly the failure mode agents handle badly: an agent whose mental model of a file is stale often re-applies its stale version wholesale. The framework's core thesis — advisory or after-the-fact rules get violated under pressure; prevention beats detection — argues directly against this option.

**Assessment.** Package-level fences (A) as the default, with subtree claims (C) as the pressure-relief valve for packages that prove hot, and no file-level machinery until measurement shows the package grain is actually the parallelism bottleneck. Option D is worth keeping only as a backstop: cheap write-interleaving detection behind the fences catches the bugs in the fence system itself.

---

## 3. Decision two: the enforcement point

The worktrees report is blunt that an unenforced ledger "runs on discipline." The question is where the refusal happens.

### Option A: agent-platform hook (Claude Code PreToolUse)

A `PreToolUse` hook on `Edit`/`Write` checks the target path against the claim store and returns a deny with a short reason ("claimed by agent-B for BL-0031; ledger row 4") when the path is fenced to someone else.

- **Pros.** The refusal happens *before* the write, inside the agent's own turn, with a message the agent can act on — it can wait, negotiate via the ledger, or re-scope. It is precisely the "promote the prompt to a tool" move, and the hook is small: read a JSON file, match a path, exit nonzero. Half a day including tests.
- **Cons.** It only governs agents running under this harness. A stray shell command (`sed -i`, `git checkout --`, a codegen script) bypasses it; so does any non-Claude tool. Hook coverage of Bash-mediated writes requires either denying file-writing shell patterns (brittle) or accepting the gap.
- **Risks.** A hook bug that over-blocks halts all agents at once; the hook itself must be supervisor-owned and trivially simple. Latency must stay in the low tens of milliseconds or it taxes every edit.

### Option B: filesystem-level enforcement (OS ACLs / read-only bits)

The claim system flips real filesystem permissions: claiming a package makes it writable to that agent's user/process and read-only to everyone else.

- **Pros.** Nothing bypasses it — shell commands, codegen, everything obeys. This is the only option that closes option A's gap.
- **Cons.** On a single-user Windows machine the OS identity model does not distinguish agents; per-agent enforcement needs per-agent OS users or containers, which reintroduces the environmental duplication the shared tree exists to avoid. A degraded form — flip everything read-only except the claimed area, same identity for all agents — protects against *accidents* but not against a confused agent that chmods first. Windows ACL semantics plus watchers (a `tsc --watch` that cannot read a momentarily-locked file) add friction.
- **Risks.** Permission state leaking across crashes: a wedged claim leaves a directory read-only and the operator debugging ACLs instead of code.

### Option C: git-level enforcement (index locks / commit hooks)

Enforce at commit time: a pre-commit hook rejects commits touching files outside the committer's claims.

- **Pros.** Simple, uses machinery git already has, and catches the case where an agent wandered.
- **Cons.** Far too late. The working tree is the shared medium; the collision happened at write time, possibly an hour of tokens ago, and the gate has been evaluating the clobbered state ever since. Commit-time checks are a useful *audit*, not an enforcement point.

### Option D: a write-broker daemon

All writes go through a small local service (an MCP server or LSP-like daemon) that owns the claim table and performs the writes itself; agents never write directly.

- **Pros.** Single choke point, perfect enforcement for anything routed through it, and a natural place to add journaling (who wrote what when — the trace layer gets its data free).
- **Cons.** Requires replacing the agent's native edit tools, which forfeits the platform's own diffing, checkpointing, and permission UX; and shell writes still bypass it. Highest build cost of the four by a wide margin.

**Assessment.** Option A now, with option C's commit-time check as the cheap audit layer behind it, and a measurement habit: log every write (a `PostToolUse` journal) and diff the journal against claims weekly. If bypass-writes show up in that diff more than rarely, that is the trigger to consider B's degraded form. D is over-engineering at this scale.

---

## 4. Decision three: the claim store

Where fence state lives. The constraints: multiple processes read it on every edit (the hook), agents and the supervisor mutate it, the human must be able to read it at a glance, and it must survive crashes without wedging.

- **Option A: a committed file in the repo** (`.claims.json` or a markdown ledger with a parseable block). *Pros:* visible in git history, diffable, survives anything, readable by human and hook alike; claim changes can even be commits, giving an audit trail for free. *Cons:* it is itself a shared-write file — the one file every agent must write — so it needs its own micro-locking (atomic rename, retry on conflict), and committing claim churn pollutes history unless claims live in an untracked file. *Verdict:* untracked JSON file with atomic-rename writes is the sweet spot; the ledger's human-readable view can be generated from it.
- **Option B: the supervisor's memory / a daemon.** Fast and race-free, but opaque, unreadable when the daemon is down, and it makes the supervisor a single point of failure for every edit in the system.
- **Option C: git refs or notes as locks** (a ref per claim, creation is atomic). Clever, atomic, crash-visible — but invisible to humans without tooling and awkward on Windows filesystems under concurrent ref churn.
- **Option D: OS file locks.** Advisory locks are not reliably shared across the processes involved on Windows, and mandatory locks fight the watchers.

Claim lifecycle matters more than the store: claims need an owner, a task id, a timestamp, and a TTL or heartbeat, because the dominant real-world failure is the *stale claim* — an agent that crashed or was interrupted holding a fence. A TTL (say 30 minutes, refreshed by activity) plus a supervisor sweep converts that from an operator-debugging session into a log line.

**Assessment.** Untracked `.claims.json`, atomic-rename updates, TTL + heartbeat, and a generated human view. A few hours of work.

---

## 5. Decision four: gate architecture

The gate is the shared `tsc --watch` + `vitest --watch` pair plus the post-edit hook that reads their state and returns a compact verdict. The framework document establishes the mechanism; the multi-agent question is how many gates and what they watch.

- **Option A: one global gate.** One watcher pair over the whole workspace; every agent's verdict comes from the same daemons. *Pros:* the verdict is the truth about the integrated state — the entire point of the shared tree; one warm-up, one memory footprint. *Cons:* it is shared mutable state; one agent's red is everyone's red (addressed in section 6), and a full-workspace `tsc --watch` on a large repo has slower incremental turnaround than a scoped one.
- **Option B: per-package gate daemons.** One watcher pair per active package (project references make `tsc -b --watch` natural here). *Pros:* verdicts are pre-attributed — package X's daemon speaks only about package X, so an agent fenced into X gets a verdict that is red only for its own reasons plus genuine upstream breakage; incremental checks are faster. *Cons:* N daemon pairs is the very cost the worktrees report charged against worktrees — though cheaper here, since they share one tree, one `node_modules`, and can be started lazily only for claimed packages. Cross-package integration truth now needs a composition step (the build graph) rather than a single answer.
- **Option C: two-tier.** Per-package daemons for the per-edit verdict (fast, attributed), plus one global check — the sacred `check` script — that runs on claim-release and before any commit lands. The per-edit tier answers "did I break my area"; the global tier answers "did the integrated state stay green."

**Assessment.** Option C, arrived at honestly: it is option B plus the framework's existing single-source-of-truth rule. Lazy daemon startup (spawn the pair when a package is first claimed, reap when released) keeps the daemon count at the concurrency level, not the package count. The one-`check`-script rule is unchanged and remains sacred.

---

## 6. Decision five: verdict attribution and the red-state problem

The worktrees report's weakness #2: agent A turns the gate red mid-refactor; agent B's next verdict is red for A's reasons. Options, not mutually exclusive:

- **Blame by fence.** Root-cause deduplication already groups errors by the file that owns the offending type; joining that against the claim table turns "3 errors" into "3 errors, all in files claimed by agent-A — not yours, proceed by your own tier-1 verdict." With package fences and per-package daemons this is nearly free and nearly always right. It converts the red-state problem from a serialization into an information problem. *Risk:* "not yours" is subtly wrong when B's change *interacts* with A's broken state; the global gate at claim-release still catches this, which is why the two-tier design matters.
- **Snapshot verdicts.** Stamp each verdict with the set of (file, hash) pairs it was computed against, so an agent can distinguish "red because of my edit" from "red because the world changed under me." Cheap metadata, useful for the trace layer, does not by itself unblock anyone.
- **Red-time budgets.** A fence held red beyond a threshold (say 10 minutes) pages the supervisor: the offending agent is told to reach a green milestone or revert to its last checkpoint commit. This is the mechanism that keeps "broken intermediate states are shared" bounded in time. The threshold is a tuning knob the trace layer should measure.
- **Green-to-green discipline.** The strictest option: an agent may only *release* a fence green, and is prompted to structure work as a series of green milestones (behavior-preserving first, behavior-changing second). This is just trunk-based discipline applied intra-tree, and it doubles as the rollback story (section 8).

**Assessment.** All four; they compose. Blame-by-fence is the load-bearing one and costs a join between two data sources the system already has.

---

## 7. Decision six: test-run integrity

Weakness #3: a test run reads files as they change; concurrent edits mid-run can produce results corresponding to no state that ever existed.

- **Option A: accept and narrow.** `vitest --changed` plus the pure-functional subset shrink both the window and the blast radius; a torn run shows up as a flaky verdict that the next run corrects. *Pros:* zero cost. *Cons:* a flaky gate teaches agents to distrust the gate — the one thing the system cannot afford.
- **Option B: pause-the-world snapshots.** The gate briefly quiesces writes (the hook holds edits for the seconds a scoped test run takes) so every verdict corresponds to a real state. *Pros:* verdicts are always true. *Cons:* couples all agents' latency to the slowest test run; the machinery (write-holding) is invasive.
- **Option C: snapshot-on-read.** Run tier-1 tests from a lightweight shadow copy of the claimed package (copy-on-write or `git stash create`-style temp checkout of just the fenced area). *Pros:* torn reads impossible for the attributed tier. *Cons:* a partial reintroduction of worktree machinery, per-run copy cost.
- **Option D: verdict validation.** Record the (file, hash) set at run start and end; if they differ, mark the verdict *torn* and rerun instead of reporting it. *Pros:* cheap (hashing the changed-file set), honest, no pausing. *Cons:* under constant churn a run could starve; needs a retry cap that falls back to a brief quiesce.

**Assessment.** D as the mechanism, A as the context that makes D cheap (scoped runs finish in seconds, so torn runs are rare and retries cheap). B and C are escalations to hold in reserve; the trace layer will say whether torn-verdict rates ever justify them.

---

## 8. Decision seven: commit topology and rollback

- **Commit unit.** Per-agent, per-milestone commits directly on `main`, tagged in the message with agent/task id (`[agent-B/BL-0031]`). The existing frequent-commit policy already mandates the cadence; the tag is what makes interleaved history untangleable. An alternative — the supervisor batches and commits on agents' behalf — buys tidier history at the cost of a serialization point and a delay between "gate green" and "state durable"; not worth it solo.
- **Commit gate.** Tier-1 green suffices for milestone commits inside a fence; the full `check` must be green for a commit that releases a fence or touches cross-package contracts. Pushing after every commit stays policy.
- **Rollback.** With green-to-green discipline and tagged commits, reverting one agent's task is `git revert` of a contiguous-by-author, non-overlapping-by-fence commit range — the fences are precisely what make the revert clean. This is the shared tree's answer to "a worktree branch rolls back by deletion": it never matches deletion's simplicity, but fenced, tagged, green-to-green commits get within one command of it. The residual risk is the cross-fence contract change (agent A changed a contract; agent B built on it; reverting A strands B), which no topology fixes — it is the supervisor's job to sequence contract changes first, exactly as the parallel-wave skill already does.

---

## 9. Decision eight: supervisor topology

- **Option A: human as supervisor.** The claim store, hook, and gates run themselves; the human arbitrates conflicts and stale claims. *Pros:* no new software. *Cons:* the human is the pager for every fence dispute; attention is the scarce resource the worktrees report identified.
- **Option B: supervisor agent.** A long-running session owns claim arbitration, red-time paging, stale-claim sweeps, and contract-change sequencing. *Pros:* matches the parallel-wave skill's existing shape; absorbs the routine disputes. *Cons:* burns a session's tokens continuously; a wedged supervisor wedges the system unless the mechanisms (hook, TTL) keep working without it — which is the design rule: **the supervisor optimizes; the mechanisms enforce.** Nothing about correctness may depend on the supervisor being alive.
- **Option C: no supervisor, protocol only.** Claims, TTLs, ordered acquisition, red-budgets — all mechanical, disputes resolved by "first claim wins, second re-scopes." *Pros:* cheapest, most robust. *Cons:* nobody does lookahead; two tasks that should have been sequenced (same contract) get discovered in conflict rather than planned around.

**Assessment.** C's mechanisms as the foundation, B's supervisor as the planner layered on top for multi-track work (which is what parallel-wave already is), A's human as the escalation tier. The supervisor plans waves and sequences contract edits; the hook and TTLs keep the tree safe when it isn't looking.

---

## 10. Failure modes and their answers

| Failure | Detection | Answer |
|---|---|---|
| Agent writes outside its fence via shell | Write journal vs. claims diff; commit-time audit hook | Deny-message teaches agent; recurring → consider read-only-bit enforcement |
| Stale claim (agent died holding fence) | TTL expiry, supervisor sweep | Auto-release + log; work-in-progress in that fence is surfaced, not silently dropped |
| Deadlock on multi-fence acquisition | Ordered acquisition makes it impossible; violations logged | Path-sorted claim order, or supervisor pre-plans fence sets per wave |
| Fence held red too long | Red-time budget timer | Page supervisor → agent reverts to last green milestone commit |
| Torn test verdict | Hash-set comparison at run start/end | Rerun; cap retries; escalate to brief quiesce |
| Hook outage (enforcement silently off) | Heartbeat: hook writes a liveness stamp the gate checks | Gate refuses to report green when the fence hook is dead |
| Claim-store corruption | Atomic rename makes torn writes impossible; schema-validate on read | Rebuild from write journal |
| Cross-fence semantic conflict | Global `check` at fence release; API Extractor diff on contract files | Contract changes sequenced first by supervisor (existing parallel-wave rule) |
| Config sabotage (agent edits tsconfig/eslint/claims schema) | These paths are permanently fenced to the supervisor | Same hook, standing claim, no expiry |

The hook-outage row deserves emphasis: an enforcement layer that can fail silently is worse than none, because it changes behavior (people stop checking) while providing nothing. The fence hook and the gate must each verify the other is alive.

---

## 11. Costs and gains, summed

**Build cost.** Claim store + fence hook (~1 day), per-package lazy gate daemons + verdict attribution join (~1–2 days on top of the already-planned watch gate), write journal + audit hook (~half day), TTL sweep + red-budget timers (~half day). Roughly a week of tooling, most of it small scripts in the repo's own language — the framework's section 2 bet, applied.

**Run cost.** One tree, one install, one-to-few daemon pairs, no merge queue, no per-tree warm-ups. Hook latency (tens of ms per edit) and claim churn are the recurring taxes; both are measurable by the trace layer and both are orders of magnitude below a worktree's `pnpm install` + daemon warm-up.

**Gains.** Integration latency of seconds rather than merge-time; one definition of green measured on the code that ships; semantic conflicts surfaced continuously instead of discovered at merge; token savings from compact attributed verdicts; and rollback that stays one command away as long as green-to-green discipline holds.

**What it does not buy.** Isolation for destructive or long-running work (worktrees keep that role, per the companion report's decision rule); protection against two tasks that genuinely need the same files (the answer remains: sequence them); and safety without discipline — the design shrinks the discipline surface to two rules (claim before writing; release green) and enforces the first mechanically, but the second remains partly behavioral, backed by budgets rather than walls.

---

## 12. Validating "almost nobody has built one"

Two independent deep-search passes were run — one over practitioner tooling and guides, one over academic and systems literature. Both reached the same verdict: **the claim is mostly supported, but as written it is too strong, and it should be narrowed to what is actually unclaimed.**

### What contradicts the strong reading

Shared-tree-with-enforced-fences exists, both shipped and published:

| System | What it does | What it lacks |
|---|---|---|
| [STORM](https://arxiv.org/abs/2605.20563) (arXiv, May 2026) | The strongest near-miss. All agents share one workspace; a mediated `file_editor` enforces per-file version counters and optimistic concurrency, rejecting stale writes. Explicitly contrasts itself with worktree-per-agent — and empirically beats it (87.6 vs 78.2 on its benchmark). | Verification is post-hoc: a manager runs tests after agents finish. No continuous gate. Fences are dynamic OCC, not claim-based partitions. |
| [ATM](https://arxiv.org/abs/2607.00041) (arXiv) | Pre-write admission control: a broker decides which concurrent write intents proceed, serialize, or fail closed; a neutral steward applies mutations. The closest published thing to the enforced pre-edit fence. | No continuous gate. |
| [Agent-MCP](https://github.com/rinadelph/Agent-MCP), [AGNT-LOCK](https://lobehub.com/mcp/codewithriza-agnt-lock) | Shipped MCP coordination layers with real file-level locking over one shared project directory — a second agent's request for a locked file is refused, with holder and reason. | No gate; locking only. |
| [Concurrency-anomaly verification paper](https://arxiv.org/pdf/2606.17182) (arXiv) | The one place pessimistic locking is explicitly recommended for agents: acquire before read; a failed acquisition drops the operation *before* burning inference — worthwhile exactly when a wasted inference costs more than missed collaboration. | Theory, not an implementation. |
| [Perforce's position piece](https://www.perforce.com/blog/vcs/p4-vs-git-for-ai-coding-agents) | Pessimistic locking revived for agents in practice: P4 exclusive checkout under many writers on one mainline, with `p4 opened -a` suggested as a pre-edit hook. | VCS-level, no agent-loop gate. |

Two further data points sharpen the picture. [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams) put teammates in the *same working directory* with real locking — but only on the shared task list; for source files the docs offer prose ("give each teammate a different set of files"), i.e. the advisory ledger this design rejects. And [grite](https://arxiv.org/html/2606.19616v1), a git-native coordination substrate with deliberately *advisory* leases, reports its own leases insufficient on their own — direct published support for the framework's advisory-rules-get-violated thesis.

### What supports the claim

Three things survive the falsification attempt intact:

1. **The practitioner-guide half is literally true.** The 2025–2026 guide literature ([Osmani's Code Agent Orchestra](https://addyosmani.com/blog/code-agent-orchestra/), [Augment's worktree guide](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution), the Upsun/Kempé pieces already cited by the companion report) converges uniformly on worktree/branch/container isolation with merge-time gates. No guide describes the combined pattern.
2. **The continuous gate is genuinely unclaimed.** Across every system either pass could find — STORM, ATM, CoAgent, CodeCRDT, MetaGPT/ChatDev/MAGIS/HyperAgent, Google Piper's submit queue, Bazel watch tooling — verification of agent work is batch and post-hoc: tests at task end, presubmit per change, CI on merge. A persistent watch-mode compiler/test daemon whose state a post-edit hook reads as a near-instant verdict on the actually-integrated tree appears in no published system. The mechanism's ingredients exist (ibazel even has a change-notification protocol); nobody has published wiring them into an agent loop as a gate.
3. **The combination has no full match.** Every candidate misses at least one leg of the triple, and essentially all miss the gate leg.

One more finding matters for the design rather than the claim: the field has split optimistic versus pessimistic and mostly gone optimistic — CoAgent argues explicitly *against* locks (blocking is expensive when the blocked party's next move takes minutes of inference), and STORM, CodeCRDT, and grite are all optimistic or advisory. The enforced-fence choice in this document is a minority position, but one with published support (ATM's fail-closed admission; the anomaly paper's wasted-inference argument; grite's negative result on advisory leases; CodeCRDT's residual 5–10% *semantic* conflict rate even with zero textual conflicts, which is precisely what fences-plus-gate exist to catch).

### The corrected sentence

The companion report's line should be revised from "almost nobody has built one" to something like: *practitioner guides converge on worktree isolation; the closest built systems — STORM's OCC-mediated shared workspace, ATM's pre-write admission broker, and shipped lock-servers like Agent-MCP — supply the fence but verify post-hoc; no published system combines enforced fences with a continuous in-tree gate.* The shared-tree premise itself now has direct empirical backing worth citing rather than arguing from first principles: STORM's result is that explicit state management over one workspace *outperforms* workspace isolation.

---

## 13. Recommended configuration

- **Fences:** package-level claims, subtree claims permitted for observed hot spots; config files and the claim schema permanently fenced to the supervisor.
- **Enforcement:** PreToolUse deny hook against an untracked, atomically-updated `.claims.json` with TTL + heartbeat; PostToolUse write journal; commit-time audit; hook/gate mutual liveness checks.
- **Gate:** two-tier — lazy per-package `tsc -b --watch` + scoped `vitest` for attributed per-edit verdicts; the single sacred `check` script on fence release and cross-package commits. Torn-verdict detection by file-hash comparison.
- **Verdicts:** blame-by-fence join, snapshot stamps, 10-minute red budgets, green-to-green fence release.
- **Commits:** per-agent tagged milestone commits on `main`, pushed immediately; contract changes sequenced first.
- **Supervision:** mechanisms enforce, supervisor plans, human escalates.

Build order: claim store and fence hook first (they de-risk everything else and are useful alone), then the watch gate as already planned, then attribution, then the budgets and sweeps. Each step lands independently, which is the project's standing rule for all of its tooling.
