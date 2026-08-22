# Git Worktrees and Branches for Concurrent Coding Agents

**Status:** technical report.
**Date:** 2026-08-22
**Companion to:** [agent-development-framework-2026-08-18.md](agent-development-framework-2026-08-18.md)

---

## 1. The question

The README currently asserts: "Don't use Git work trees or branch (doesn't help multiple agents)." The companion framework document builds on that constraint in section 8: one shared working tree, package boundaries as fences, and a coordination ledger for cross-package work. This report treats the README line as a hypothesis and evaluates it.

The context shapes every conclusion here: one human operator, one repository, fast iteration, Claude Code as the primary agent platform, and two stated goals — finish work faster and consume fewer tokens. Advice written for teams of humans does not transfer unchanged, and most published advice was written for teams of humans.

The finding, stated up front: the hypothesis is right as a default and wrong as an absolute. The shared tree with fences is the correct home for ordinary concurrent work in this project. Worktrees earn their cost in three specific situations, and the vendor's own tooling has made those situations cheap to exploit. The README line should become a decision rule rather than a prohibition.

---

## 2. What a worktree costs

A [git worktree](https://git-scm.com/docs/git-worktree) is a linked checkout: a second working directory sharing the same object database and refs as the main one. Creating one is fast, git-side; the object store is not duplicated, and a branch checked out in one worktree cannot be checked out in another, which makes the model explicit — one line of development per directory.

The checkout is the cheap part. The development environment around it is the expensive part, because almost nothing outside git is shared:

- **Dependencies.** `node_modules` is per-directory. With npm, every worktree pays a full `npm ci` in time and disk. pnpm changes the disk half of this almost completely: packages live once in a [content-addressable store and are hard-linked into each project](https://pnpm.io/motivation), so a second worktree adds near-zero marginal bytes for packages. It changes the time half only partially: linking is fast but the virtual store still has to be built and lifecycle scripts still run per tree. Two caveats from the [pnpm FAQ](https://pnpm.io/faq): the store must be on the same drive as the project ("otherwise packages will be copied, not linked"), and on Windows without Developer Mode pnpm uses NTFS junctions instead of symlinks.
- **Disk beyond packages.** Build outputs, caches, and generated artifacts duplicate per tree. One practitioner measured a ~2 GB codebase ballooning to 9.82 GB of worktree disk in a twenty-minute session of automatic worktree creation ([Upsun](https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents)).
- **Watch daemons.** The framework's core token-economy mechanism (section 6) is a persistent `tsc --watch` plus `vitest --watch` whose state a post-edit hook reads for a near-instant verdict. That design assumes one tree. N worktrees means N daemon pairs — N warm-ups, N times the memory, and hook wiring that must find the right daemon for the right tree. The gate's economics were computed for a single tree; worktrees multiply its fixed costs.
- **Ports.** "Every dev server defaults to the same ports: 3000, 5432, 8080. Launch two React apps from different worktrees and one fails" ([Upsun](https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents)). Watch-mode `tsc` and `vitest` bind nothing by default, so the gate itself is safe, but any preview server, database, or Docker resource is shared or colliding and needs per-tree allocation.
- **Path confusion.** Agents carry absolute paths in context. A session that has read files from two trees can silently edit the wrong copy. Claude Code mitigates this with hard enforcement: while a session is isolated in a worktree, it [blocks edits, working directories, and git redirects that escape to the main checkout](https://code.claude.com/docs/en/worktrees#how-claude-code-enforces-isolation). That protection exists because the failure mode is real.
- **Windows friction.** Two documented items. First, worktree removal versus links: a folder inside a worktree that is really an NTFS junction or directory symlink gets its link deleted, not its target — and before Claude Code v2.1.205, a nested link could cause deletion of the folder it pointed to ([worktrees docs](https://code.claude.com/docs/en/worktrees#clean-up-worktrees)). A pnpm `node_modules` on Windows is full of junctions, so worktree removal and pnpm interact exactly here. Second, permission approvals granted in a worktree [stay with that worktree on Windows](https://code.claude.com/docs/en/worktrees#what-worktrees-share-with-the-main-checkout) rather than being shared through the main checkout, so each new tree re-prompts. Neither is fatal; both are per-tree overhead that a shared tree never pays.

| Per-worktree cost | With npm | With pnpm (store on same drive) |
|---|---|---|
| Package bytes on disk | Full copy per tree | Hard links into one store; near-zero marginal |
| Install time | Full `npm ci` per tree | Link + lifecycle scripts; fast, not free |
| Watch daemons | One `tsc`/`vitest` pair per tree | Same — pnpm does not help |
| Dev-server ports, local DB state | Collide or need allocation | Same |

The one-line summary: pnpm removes the disk argument against worktrees and shrinks the install argument, but the daemon, port, and attention costs remain untouched.

---

## 3. Branch and merge economics

A mechanical point first, because it decides how the README line should be read. In a single working tree, branches cannot parallelize agents at all: a checkout has exactly one `HEAD`, so two agents on different branches require two directories. On a shared tree, branches are a serialization tool. In that world the README's "branching doesn't help multiple agents" is literally true. The real comparison is therefore shared-tree-on-main versus worktrees-with-branches, and branch economics are worktree economics.

What a branch buys is deferral: isolation now, integration later. The trunk-based-development literature is unambiguous about the price of deferral — long-lived branches drift from trunk and produce compounding merge conflicts, which is why the discipline caps branch lifetime at a day or two ([trunkbaseddevelopment.com](https://trunkbaseddevelopment.com/), [STX Next](https://www.stxnext.com/blog/escape-merge-hell-why-i-prefer-trunk-based-development-over-feature-branching-and-gitflow)). Agents amplify the drift rate: an agent working for thirty minutes can produce a day-sized diff, so branch lifetimes must be measured in diff volume, not wall-clock. Three agents on three branches for one afternoon can accumulate what a human team accumulates in a week.

Someone pays the integration bill serially. With N parallel branches, the later merges land on a main that has already moved N−1 times; each needs a rebase or merge plus a re-test. In a solo repository the human — or an integrator agent — becomes that pipeline stage, and it is the least parallelizable stage in the whole system.

The worst part of the bill is invisible to merge tools. A [semantic conflict](https://martinfowler.com/bliki/SemanticConflict.html) is a pair of changes that "can be safely merged on a textual level but cause the program to behave differently" — Fowler's canonical example is one branch renaming a function while another adds calls to the old name. Agents produce this class constantly, because two agents given adjacent tasks will both "improve" the same helper. Each branch is green against its own stale base; only the merged state is truth, and the merged state was never tested until merge time. Fowler's remedy is [frequent integration and self-testing code](https://martinfowler.com/articles/branching-patterns.html) — integrate within hours so the assumptions cannot drift far. The framework's API Extractor report (section 5) catches the public-surface subset of these conflicts cheaply, but internal behavioral conflicts only surface when the full check runs on integrated code.

History quality cuts both ways. Small single-concern commits landing directly on main produce the ideal `git bisect` substrate: linear, and every commit passed the check. Branch-heavy histories carry work-in-progress commits that force `bisect skip`; squash-merging recovers linearity but coarsens revert granularity to the whole branch. The README's existing frequent-commit policy is already the bisect-friendly shape.

---

## 4. The shared-tree model

Section 8 of the framework proposes: one working tree, package boundaries doing the structural fencing (an undeclared cross-package import simply does not resolve), and a ledger carrying only cross-package coordination. Evaluated honestly:

**What it gets right.** Integration latency is approximately zero — this is continuous integration taken to its limit. Where Fowler asks for integration within hours, the shared tree integrates within seconds, and the continuous gate evaluates the actually-integrated state on every edit. There is one definition of green and it is the true one, because it is measured on the code that will ship, not on a per-branch fiction. There is one environment: one `node_modules` (the framework's section 7 warning about install races between concurrent agents is answered by one tree, one completed install, supervisor-owned manifests), one watcher pair, one set of ports, one directory for the human to watch. And there is no merge debt at all — no rebase queue, no integrator role, no semantic-conflict discovery at merge time because there is no merge time.

**What it costs.** Four real weaknesses:

1. **File claims are advisory.** The ledger is a prompt-level rule, and the framework's own thesis (section 2) is that advisory rules get violated under pressure. Two agents writing one file is last-writer-wins at the filesystem; git provides no protection inside a working tree. The consistent fix is the framework's own medicine: promote the ledger to a tool — a pre-edit hook that refuses writes to files claimed by another agent. That is unbuilt work, and until it exists the shared tree runs on discipline.
2. **Broken intermediate states are shared.** Agent A mid-refactor turns `tsc --watch` red; agent B's next verdict is red for A's reasons. Root-cause deduplication (section 6) plus ledger ownership can *attribute* the failure, but B still cannot obtain a green verdict until A finishes. The gate is shared mutable state, and red states serialize the agents that share it.
3. **Test runs can be polluted.** A test run reads files as they change; concurrent edits mid-run can yield results corresponding to no state that ever existed. Affected-only selection (`vitest --changed`) narrows the window and the pure-functional subset narrows the blast radius, but neither closes the window.
4. **Rollback is entangled.** Reverting one agent's work after others have committed on top means reverting interleaved commits — clean only when commits are small, per-agent, and non-overlapping, which is the fences again. A worktree branch rolls back by deletion. Claude Code's checkpoint/rewind is no substitute here: it is per-session, and the docs are explicit that it "isn't a replacement for git" ([best practices](https://code.claude.com/docs/en/best-practices#rewind-with-checkpoints)); with several sessions in one directory, one session's restore does not know about another session's edits to the same files.

---

## 5. What single-user changes

Most branch advocacy assumes an institution the project does not have. Branches exist largely to feed pull requests; pull requests exist largely to gate review between people. With one human, there is no review gate to feed — push-to-main is viable and is already policy. That deletes the strongest conventional argument for branches.

What replaces review as the binding constraint is the operator's attention. Worktrees parallelize machines, not the human: every live tree is another mental register — which branch, what is running, is it green, what did I promise it. Anthropic's own [power-user guidance](https://support.claude.com/en/articles/14554000-claude-code-power-user-tips) recommends two to four parallel sessions, noting that beyond that, reviewing the output becomes the bottleneck, and suggests naming worktrees, shell aliases, and color-coded terminals just to stay oriented. A Windows practitioner running N worktrees reports the same: it works, with real automation investment, and "Don't try to run eight worktrees on day one" ([Laurent Kempé](https://laurentkempe.com/2026/03/31/from-3-worktrees-to-n-ai-powered-parallel-development-on-windows/)). Guides aimed at solo developers still recommend the plain-branch (or no-branch) model when doing one thing at a time, on mental-overhead grounds ([Jonathan's Blog](https://jonathansblog.co.uk/git-worktrees-vs-branches-a-complete-guide-for-developers-and-ai-coding-agents)).

The recovery argument also shrinks. For a team, a branch is a free checkpoint that keeps unfinished work off everyone else's main. Solo, a milestone commit on main is nearly the same checkpoint at lower ceremony: `git revert` of a small single-concern commit is cheap, and the README already mandates frequent commit-and-push. The one thing a branch still buys is the option to abandon wholesale, leaving no revert trail on main — which is precisely the spike case, and the honest core of what worktrees are for in this project.

---

## 6. What vendors and practitioners recommend, 2025–2026

Anthropic has made worktrees a first-class primitive. [`claude --worktree <name>`](https://code.claude.com/docs/en/worktrees) creates `.claude/worktrees/<name>/` on branch `worktree-<name>`; clean trees are removed automatically on exit; a `.worktreeinclude` file carries gitignored files like `.env` into each new tree; worktrees can be created straight from a PR number. Subagents accept `isolation: worktree` in their frontmatter, get a temporary tree that is auto-removed when the agent finishes without changes, and a periodic sweep cleans up old trees while refusing to delete unmerged work. The desktop app gives every parallel session its own worktree automatically. The [best-practices guide](https://code.claude.com/docs/en/best-practices#run-multiple-claude-sessions) lists worktrees first among the parallel-session options, and the built-in `/batch` command fans a change out across 5–30 subagents, each in its own worktree, each opening a PR.

But the defaults are informative. Subagents run in the shared tree unless isolation is requested; worktrees are pitched as the answer to "edits that collide," not as the universal working mode; and the bulk of the best-practices document is about context management and verification, not parallelism. The vendor position is best read as: worktrees when isolation is worth paying for, shared context otherwise.

Practitioner writing through 2025–2026 converges on the same shape from the other direction. The how-to guides ([Upsun](https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents), [Kempé](https://laurentkempe.com/2026/03/31/from-3-worktrees-to-n-ai-powered-parallel-development-on-windows/), [Jonathan's Blog](https://jonathansblog.co.uk/git-worktrees-vs-branches-a-complete-guide-for-developers-and-ai-coding-agents)) all land on worktree-per-agent at low single-digit agent counts, all report that it requires genuine automation investment (setup hooks, port allocation, cleanup scripts, terminal multiplexing), and all note the ceiling is the human's review capacity, not the machine. None of them describes the framework's alternative — a fenced shared tree with a continuous gate — because almost nobody has built one; the worktree pattern is popular partly because it is the isolation you can get without building anything.

---

## 7. Hybrid patterns

The choice is not binary, and the useful patterns are all short-lived or role-scoped:

- **Spike worktree.** A risky experiment that will probably be discarded gets `claude --worktree spike-x`; it merges or dies within a day. This matches the README's "perform spikes and investigations early" and is the case where wholesale-abandonment rollback genuinely beats revert-on-main.
- **Worktree per long-running background agent.** A dependency upgrade, a large mechanical migration, or an adversarial reviewer that must run tests destructively should not share the gate with foreground work for hours. Claude Code's `isolation: worktree` on a background subagent is exactly this shape, and the auto-cleanup sweep handles the hygiene.
- **Trunk-based development as the frame.** The shared tree is trunk-based development taken to its limit; a worktree branch that lands within a day is an orthodox [short-lived feature branch](https://trunkbaseddevelopment.com/). Both positions are inside the same discipline — what the discipline forbids is the long-lived branch, and that prohibition should survive any revision of the README line.
- **Stacked branches.** Stacking (each branch based on the previous, restacked as ancestors change) solves dependent-sequence work for teams with review gates. Solo on a shared tree, the same property — every change builds on the latest state — comes free, so stacking machinery is overhead without benefit here.
- **Checkpoint commits on main.** The lightweight default alternative to all of the above: commit at task start and at each milestone, push immediately. Revert granularity equals commit size. This is already project policy, and it is the discipline that makes shared-tree rollback tolerable at all.

---

## 8. Recommendation for this project

**Decision rule.**

| Situation | Home |
|---|---|
| Ordinary feature and fix work, one or several agents, fenced by packages | Shared tree on `main`; ledger for cross-package claims; milestone commits pushed |
| Risky spike likely to be discarded | Worktree (`claude --worktree spike-x`); merge or delete within one day |
| Long-running background agent: migration, upgrade, destructive test runs, adversarial review | Subagent with `isolation: worktree`, run in background; integrates only via a full `check` on the merged state |
| Work that must pause for days while main moves | Keep the worktree, push its branch as backup — expected to be rare |
| Two agents needing the same files at the same time | Do not parallelize; sequence them. The fence is reporting that the tasks were never parallel |

**Rules that keep the worktree cases cheap.** pnpm with the store on the project drive; `.worktreeinclude` for env files; at most one or two worktrees alive alongside the shared tree; nothing merges back without the single `check` script green on the *merged* result, because per-branch green proves nothing about integration.

**One prerequisite for the shared-tree default.** Promote the ledger from prompt to tool early — a pre-edit hook that refuses writes to files claimed by another agent. Section 8 of the framework leans on the ledger being honored; the framework's own section 2 argues advisory rules will not be. This is the same half-day-of-tooling shape as the escape-hatch ratchet, and it should sit near it in the order of work.

**When to revisit.**

1. Shared-tree collisions become measurable — file-claim conflicts or red verdicts misattributed between agents more than about once a day. Enforce claims via hook first; if collisions persist, widen worktree use.
2. The trace layer (framework section 9) shows agents spending a meaningful share of wall time blocked on other agents' red gate states.
3. A second human joins. Review gates return, PRs return, and the branch calculus reverts to the team-shaped conventional wisdom.
4. Per-worktree cost approaches zero in practice — pnpm link plus `.worktreeinclude` plus automatic daemon management making a fresh tree ready in seconds — at which point default isolation for every background agent becomes free and should become the norm.
5. Unattended long-running agents become the primary working mode rather than the exception, since everything above assumes the human is present and attending.

**The README line.** Replace "Don't use Git work trees or branch (doesn't help multiple agents)" with the decision rule: shared tree by default; a worktree for spikes and long-running background agents; no long-lived branches ever. The original sentence was right about the default and right that branching alone does not create agent parallelism, but as an absolute it is contradicted by the economics of the three exception cases and by the direction the primary vendor's tooling has taken.
