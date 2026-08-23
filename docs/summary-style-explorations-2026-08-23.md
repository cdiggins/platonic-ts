# Summary Style Explorations

**Date:** 2026-08-23
**Purpose:** eight stylistic rewrites of one dense summary paragraph (the "design half" recap of [fenced-shared-tree-design-2026-08-23.md](fenced-shared-tree-design-2026-08-23.md)), to compare shapes for making summaries easier to understand and parse. Each version was produced by a subagent given only a style prompt and the original text.

---

## 0. Original

The design half. The document decomposes the system into eight decisions, each with weighed options: fence granularity (package-level default, subtree claims for hot spots; file-level rejected until measured need; optimistic no-fence rejected on the framework's own advisory-rules thesis), enforcement point (PreToolUse deny hook now, commit-time audit behind it, filesystem ACLs held in reserve), claim store (untracked .claims.json with atomic renames, TTL + heartbeat against stale claims), gate architecture (two-tier: lazy per-package watch daemons for attributed per-edit verdicts, the sacred single check script at fence release), verdict attribution (blame-by-fence join, red-time budgets, green-to-green fence release), test-run integrity (torn-verdict detection via file-hash comparison rather than pause-the-world), commit/rollback (tagged per-agent milestone commits on main; fences are what make reverts clean), and supervision ("mechanisms enforce, supervisor plans, human escalates" — correctness never depends on the supervisor being alive). Plus a failure-mode table and a cost summary: roughly a week of small scripts.

---

## 1. Executive brief

Multiple AI coding agents editing one shared checkout carries real collision risk; the fix costs about a week of small scripts. Eight decisions define it: claim granularity defaults to package-level, with subtree claims for hot spots and file-level held back until proven necessary. Enforcement runs as a PreToolUse deny hook now, with commit-time audit as backup and filesystem ACLs in reserve. Claims live in an untracked JSON file with atomic writes and TTL/heartbeat expiry. Gating is two-tier: fast per-package watch daemons for live verdicts, plus one authoritative check at fence release. Verdicts trace back to the fence that produced them, with time budgets and green-to-green release. Test runs are checked for integrity via file-hash comparison, not by pausing all agents. Commits land as tagged per-agent milestones on main, keeping reverts clean. Oversight follows one rule: mechanisms enforce, the supervisor plans, humans escalate — correctness never depends on the supervisor staying up.

---

## 2. Structured bullets

**Fence design decomposes into eight decisions, each weighed against alternatives, plus a failure-mode table and a cost estimate of roughly a week of small scripts.**

- **Fence granularity** — package-level by default, with subtree claims for hot spots; file-level rejected as premature (no measured need), and no-fence rejected because the framework's own thesis argues advisory rules aren't enough.
- **Enforcement point** — a PreToolUse deny hook now, with commit-time audit layered behind it and filesystem ACLs held in reserve.
- **Claim store** — an untracked `.claims.json` using atomic renames, with TTL plus heartbeat to catch stale claims.
- **Gate architecture** — two-tier: lazy per-package watch daemons giving attributed per-edit verdicts, plus a single "sacred" check script run at fence release.
- **Verdict attribution** — blame-by-fence join, red-time budgets, and fence release only on green-to-green transitions.
- **Test-run integrity** — torn-verdict detection via file-hash comparison rather than pausing the world.
- **Commit/rollback** — tagged per-agent milestone commits directly on main, since fences are what make reverts clean.
- **Supervision** — mechanisms enforce, the supervisor plans, the human escalates; correctness never depends on the supervisor staying alive.

Together these decisions and the failure-mode table sketch a lightweight, low-cost enforcement layer rather than a heavyweight system.

---

## 3. Technical writer

The design half decomposes the system into eight decisions, each weighed against alternatives.

Fence granularity: package-level by default, with subtree claims for hot spots. File-level fencing is rejected until measured need shows it is necessary. Optimistic no-fencing is rejected too, on the framework's own advisory-rules thesis.

Enforcement point: a PreToolUse deny hook runs now. A commit-time audit sits behind it. Filesystem ACLs remain in reserve.

Claim store: an untracked .claims.json file, written with atomic renames. TTL and heartbeat checks guard against stale claims.

Gate architecture: two tiers. Lazy per-package watch daemons produce attributed per-edit verdicts. A single check script, treated as sacred, runs at fence release.

Verdict attribution: a blame-by-fence join assigns responsibility. Red-time budgets apply. Fences release only on a green-to-green transition.

Test-run integrity: torn verdicts are detected by comparing file hashes, not by pausing the system.

Commit and rollback: tagged per-agent milestone commits land on main. Fences are what make reverts clean.

Supervision: mechanisms enforce, the supervisor plans, and a human escalates. Correctness never depends on the supervisor staying alive.

The document also includes a failure-mode table and a cost summary: roughly a week of work building small scripts.

---

## 4. Colleague recap

We punted on file-level fences until we actually measure a need for them — for now it's package-level by default, with subtree claims when something's hot. Enforcement is a PreToolUse deny hook doing the real work today, with a commit-time audit sitting behind it as backup, and filesystem ACLs held in reserve if we need them later. We track claims in an untracked .claims.json, using atomic renames plus a TTL and heartbeat so a crashed agent doesn't leave a stale lock sitting around forever.

For the actual gating, we went two-tier: lightweight per-package watch daemons give each agent a fast, attributed verdict on every edit, and then there's one "sacred" check script that runs the full gate when a fence gets released. When something goes red, we trace it back to whoever's fence touched it last, put a time budget on how long it's allowed to stay red, and only let a fence release once it's back to green.

For test integrity, instead of pausing the world every time someone wants a clean run, we compare file hashes to catch a "torn" verdict — a test result computed against a half-edited state. Commits are tagged per-agent milestones on main, and the fences are really what make rollbacks clean if we need to back one out.

And on supervision, the principle is: mechanisms enforce, the supervisor plans, and a human is who you escalate to — correctness can never depend on the supervisor process actually being alive. There's also a failure-mode table in there, and the whole thing pencils out to roughly a week of small scripts to build.

---

## 5. Textbook

In this design, the system decomposes into eight decisions, each accompanied by a set of weighed options.

1. **Fence granularity.** A *fence* denotes the unit of exclusive claim over source. Package-level fencing serves as the default granularity; subtree claims are reserved for hot spots requiring finer control. File-level fencing is rejected pending measured need, and an optimistic no-fence approach is rejected outright, consistent with the framework's own thesis that advisory rules alone are insufficient.

2. **Enforcement point.** Enforcement is implemented as a PreToolUse deny hook, the mechanism that blocks a tool invocation before it executes. A commit-time audit operates behind this hook as a secondary check, while filesystem ACLs are held in reserve as a further backstop.

3. **Claim store.** Claims are recorded in an untracked `.claims.json` file, written via atomic renames to prevent partial or corrupted reads. A time-to-live (TTL) value combined with a heartbeat signal guards against stale claims persisting after an agent has stopped updating them.

4. **Gate architecture.** The gate is organized in two tiers: lazy, per-package watch daemons produce attributed, per-edit verdicts, while a single, authoritative check script — termed the "sacred" check — runs at fence release to render the final verdict.

5. **Verdict attribution.** Verdicts are attributed to agents through a blame-by-fence join, associating each verdict with the fence under which it was produced. Red-time budgets bound how long a fence may remain in a failing state, and fences are released only on a green-to-green transition — that is, only after verification confirms a passing state both before and after release.

6. **Test-run integrity.** Rather than pausing all activity during a test run (a "pause-the-world" approach), the design instead detects torn verdicts — results invalidated by concurrent edits — through comparison of file hashes taken before and after the run.

7. **Commit and rollback.** Each agent's milestone is committed directly to `main`, tagged per agent. Because fences delimit ownership boundaries clearly, they are also what make individual reverts clean and unambiguous.

8. **Supervision.** The governing principle is that mechanisms enforce, the supervisor plans, and the human escalates. Correctness is therefore never permitted to depend on the supervisor process remaining alive.

The document additionally provides a failure-mode table enumerating anticipated breakdowns and their mitigations, along with a cost summary estimating the total implementation effort at roughly one week of small scripts.

---

## 6. Instructor

You need to picture this document as a decomposition exercise — you're taking one big design problem and breaking it into eight decisions, and at every one of them you weigh the options against each other rather than just picking the obvious answer. Let's walk through them.

First, fence granularity. You default to package-level fencing, but you carve out subtree claims for the hot spots — the places where contention is actually going to bite. Why not go file-level everywhere? Because you don't have measured need for that yet, so you hold it in reserve rather than paying the complexity cost up front. And why not skip fencing altogether? You reject that too, and notice the irony: the framework's own thesis is that advisory rules alone don't hold up, so an optimistic no-fence approach would be arguing against your own premise.

Second, where do you enforce this? You want a PreToolUse deny hook doing the work right now, in real time. Behind that you keep a commit-time audit as a second layer, and you hold filesystem ACLs in reserve — you don't reach for the heaviest tool first, you keep it available if the lighter mechanisms turn out to be insufficient.

Third, the claim store. You use an untracked `.claims.json` file, and you write to it with atomic renames — you need that because you can't afford a claim file that's half-written when something reads it. And you pair it with a TTL plus a heartbeat, because claims go stale — an agent dies or stalls, and you need the system to notice and recover rather than leaving a permanent lock behind.

Fourth, gate architecture. This one's two-tiered, and you want to understand why. You run lazy per-package watch daemons that give you attributed, per-edit verdicts — that's your fast, granular feedback loop. But you also keep what the document calls "the sacred single check script," which runs at fence release. That's your ground truth — the fast per-edit checks are convenience, but the single check script is what actually gates the release.

Fifth, verdict attribution. You need to know, when something turns green or red, which agent and which change caused it. So you do blame-by-fence join — tying verdicts back to the fence that was active. You track red-time budgets, and you only release a fence going from green to green — never releasing while something is broken, because that's exactly the state you're trying to prevent from leaking out.

Sixth, test-run integrity. Here's a subtlety: instead of pausing the world every time you want a trustworthy test run — which would kill your parallelism — you detect torn verdicts by comparing file hashes. That lets you catch the case where a test result doesn't actually correspond to the code state it claims to, without serializing everything.

Seventh, commit and rollback. You tag per-agent milestone commits on the main branch. And here's the payoff of everything before it: the fences are exactly what make reverts clean, because a fence tells you precisely what changed and who owned it.

And eighth, supervision. The governing principle is: mechanisms enforce, the supervisor plans, and a human escalates. You need to hold onto that division, because correctness can never depend on the supervisor being alive — if the supervisor process dies, the enforcement still has to hold on its own.

Then the document rounds out with a failure-mode table, walking through what breaks and how each mechanism catches it, and a cost summary — roughly a week of small scripts to build the whole thing.

---

## 7. Novice developer

The design half breaks the system into eight separate decisions, and each decision comes with a list of options that were weighed against each other. Here they are, one at a time.

The first decision is called "fence granularity." A "fence" is a boundary that marks off a piece of the codebase so that only one agent is allowed to edit inside it at a time, similar to how you might lock a door before working in a room. The default fence covers a whole package (a folder of related code, like an npm package). For areas that see a lot of concurrent activity ("hot spots"), an agent can also claim a smaller "subtree" (a folder within a package) instead. Fencing at the level of individual files was considered and rejected, at least until there's measured evidence it's actually needed. Also rejected was the idea of having no fences at all and just trusting agents to avoid stepping on each other's work ("optimistic no-fence"). That was turned down because it contradicts the project's own guiding idea, which says rules should be enforced automatically rather than just advised.

The second decision is "enforcement point," meaning: at what moment does the system actually stop an agent from breaking a fence? The plan is to use something called a "PreToolUse deny hook." In Claude Code, a hook is a script that runs automatically at a certain moment; "PreToolUse" means it runs right before a tool (like a file-edit command) executes, and "deny" means it can block that action from happening. So this hook checks fence rules before every edit and blocks any edit that violates them. Behind that, as a second layer of defense, there would be an audit that runs at commit time (an automatic check when an agent tries to save a git commit) to catch anything the hook missed. A third, stronger option — using the operating system's own file permission system (filesystem ACLs, short for "access control lists," which control who can read or write a given file at the OS level) — is being kept in reserve rather than built right away.

The third decision is "claim store," which is where the system keeps track of who has claimed which fence. The plan is to use a plain file named .claims.json that sits in the repository but is not tracked by git (an "untracked" file, so it doesn't get committed or pushed). To avoid corruption when multiple agents try to update this file at once, updates will use "atomic renames" — a technique where you write a new version of the file under a temporary name and then swap it into place in one uninterruptible step, so no agent ever reads a half-written file. Claims will also expire automatically using a "TTL" (time-to-live, a countdown after which the claim is considered expired) combined with a "heartbeat" (a periodic signal an agent sends to prove it's still actively working). Together, TTL and heartbeat prevent a claim from staying locked forever if an agent crashes or goes silent.

The fourth decision is "gate architecture" — the layered system of checks that verify an agent's work is correct. It has two tiers. The first tier is a "lazy per-package watch daemon": a lightweight background process, one per package, that only wakes up when needed and gives fast, immediate feedback ("attributed per-edit verdicts") after each individual edit, so an agent knows quickly whether that specific edit was good or bad. The second tier is called "the sacred single check script," a single authoritative script that everyone trusts completely and that runs a full check at the moment a fence is released (meaning: when an agent finishes and gives up its claim on that part of the code).

The fifth decision is "verdict attribution," which is about figuring out which agent is responsible for which test result, since multiple agents may be changing things at once. The plan uses a "blame-by-fence join" — matching up test outcomes with whichever agent held the fence over that code at the time, similar to how "git blame" tells you who last changed a line of code. It also introduces "red-time budgets," meaning each agent gets a limited allowance of time during which its code is allowed to be in a failing state ("red," as opposed to "green" for passing) before that's treated as a problem. Fences are only released when the code goes from one passing state to another passing state ("green-to-green"), so nobody hands off broken code.

The sixth decision is "test-run integrity" — making sure a test result is trustworthy and wasn't corrupted by another agent editing files mid-test. Instead of freezing every other agent while tests run ("pause-the-world," which would hurt the whole point of working concurrently), the plan uses "torn-verdict detection." This means comparing file hashes (a fingerprint calculated from a file's contents) taken before and after the test run; if the hashes don't match, it means a file changed mid-test and the result is unreliable, so it gets discarded rather than trusted.

The seventh decision is "commit and rollback," meaning how work gets saved to git history and undone if something goes wrong. Each agent's completed unit of work gets its own git commit, tagged with a label, and applied directly onto the main branch. The reason fences make this safe is that because each agent only ever touches its own claimed area, undoing ("reverting") any one commit is clean and doesn't accidentally undo someone else's unrelated work.

The eighth and final decision is "supervision" — how a coordinating process oversees the agents. The guiding principle here is: "mechanisms enforce, supervisor plans, human escalates." That means the automatic technical mechanisms (the hooks, fences, and checks described above) are what actually stop bad edits from happening; the supervisor's job is just to plan and coordinate work, not to be the safety net; and a human only gets involved when something needs escalating. Crucially, correctness of the system must never depend on the supervisor process staying alive the whole time — if it crashes, the automatic mechanisms still keep things safe.

Beyond these eight decisions, the document also includes a table describing possible failure modes (ways the system could go wrong) and a summary of the expected cost to build it: roughly a week's worth of writing small scripts.

---

## 8. High-school student

The design covers the second half of the system: how to stop several AI coding assistants from stepping on each other while they all edit the same codebase at once. It breaks the problem into eight choices, each weighed against alternatives:

- **How big a "no-trespassing" zone each assistant claims.** Default: a whole folder at a time, with the option to grab a smaller sub-area if that folder is a bottleneck everyone wants. Claiming down to individual files was ruled out until there's actual proof it's needed. Also ruled out: no claims at all, letting assistants just be careful — because the system's own guiding idea is that "be careful" rules don't actually get followed reliably.
- **Where the rule gets enforced.** Right now, a checkpoint blocks an assistant the instant it tries to touch something it hasn't claimed. Later, a second check could review what was committed. A stricter option — locking files at the operating-system level — is being kept in a back pocket in case it's needed.
- **Where the claims get written down.** In a simple tracking file that isn't part of the saved project history, saved in a way that avoids half-written corruption. Claims also expire and need a periodic "still working on it" signal, so an assistant that crashes doesn't hold a folder hostage forever.
- **How the checking system is structured.** Two layers: each folder gets its own lightweight watcher giving fast, folder-specific pass/fail feedback, plus one main check that only runs — and must be run — right as a claimed zone is being released back for others to use.
- **Who gets credit or blame for a pass or fail.** Failures get traced back to whichever claimed zone caused them, there's a budget for how long something is allowed to stay broken, and a zone can only be released once everything's back to passing.
- **Making sure test results can be trusted.** Rather than freezing every assistant in place while tests run (which would be slow), the system compares file fingerprints to catch cases where a test's results got mixed up with edits made mid-run.
- **How work gets saved and undone.** Each assistant's completed chunk of work gets its own labeled checkpoint saved directly to the main project line, and having those claimed zones is exactly what makes it possible to cleanly undo just one assistant's work without disturbing everyone else's.
- **Who's in charge when something goes wrong.** The automatic rules do the actual enforcing, a coordinating layer does the planning, and a human is looped in when something needs a judgment call — but critically, the correctness of the whole system never depends on that coordinating layer being up and running.

The document also includes a table of what can go wrong and how each failure is handled, plus a total cost estimate: roughly a week's worth of writing small scripts.
