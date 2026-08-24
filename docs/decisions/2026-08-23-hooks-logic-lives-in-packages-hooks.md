# All guard and hook logic lives in packages/hooks; .githooks/ and .claude/settings.json are launchers only

**Date:** 2026-08-23  **Mode:** after  **Status:** active

## Question
Hook code now touches three places — `.githooks/`, `.claude/settings.json`, and
`packages/hooks` — after commits 8349a6a and 9f890b5. Is that split sound, or should it be
consolidated?

## Ruling
The split is sound and is the pattern to keep. `packages/hooks` owns every rule and every
runnable entry point: pure rules in their own modules (`gitStaging.ts`, `powershell.ts`,
`shell.ts`, `refusal.ts`), IO confined to `io.ts`, entry points in `preToolUse.ts` and
`preCommit.ts`. The two files outside the package exist only because their hosts demand a
file at a fixed location: `.githooks/pre-commit` is a 6-line sh shim (git requires an
executable at `core.hooksPath`), and `.claude/settings.json` carries one command line
(Claude Code requires the hook wiring there). Neither contains logic. No third location may
grow logic either: a future hook adds a module and entry point under `packages/hooks/src`
and at most a shim outside it.

## Because
- `.claude/hooks/guard-git-staging.mjs` (87 lines of untested logic) was deleted in 8349a6a;
  its rules moved to `packages/hooks/src/gitStaging.ts` with tests in
  `packages/hooks/test/gitStaging.test.ts`.
- `.githooks/pre-commit` at HEAD is 6 lines: a tsx-presence check and
  `exec node --import tsx packages/hooks/src/preCommit.ts`. No rules.
- `.claude/settings.json` at HEAD carries only
  `node --import tsx packages/hooks/src/preToolUse.ts` with matcher `Bash|PowerShell`.
- The launcher wiring is itself tested: `packages/hooks/test/wiring.test.ts` runs the command
  from `.claude/settings.json` against a known violation and asserts exit 2 — this is what
  caught the guard that had been silently dead on `tsx` not being on PATH (9f890b5).
- The pure/IO split matches the package's existing convention (codec pure in `index.ts`, IO
  in `io.ts`) and the repo-wide pattern (`packages/codemap` states "Pure; IO in `src/io.ts`").

## Constraints for implementers
- New hook or guard rules go in `packages/hooks/src` as pure functions with tests; entry
  points follow the `preToolUse.ts`/`preCommit.ts` pattern (isMainModule guard, fail open on
  the guard's own errors).
- Files under `.githooks/` and hook commands in `.claude/settings.json` stay logic-free:
  locate the interpreter, exec the package entry point, nothing else.
- Any change to the launcher command in `.claude/settings.json` or `.githooks/pre-commit`
  must keep `packages/hooks/test/wiring.test.ts` passing — that test is the only defense
  against a guard that exits 127 and reads as "allow".
- Dialect rules (like the PowerShell `&&`/`||` refusal) are admitted only when the command is
  provably always wrong in that shell; usually-wrong patterns stay out of the guard
  (rationale at the top of `packages/hooks/src/powershell.ts`).

## Rejected
- Keep logic in `.claude/hooks/*.mjs`: untested, invisible to typecheck/ratchet/lint (gates
  scan `packages/*/{src,test}` only), and already produced one silently-dead guard.
- Put the pre-commit rules in a shell script under `.githooks/`: same testability problem,
  plus a second implementation of the staging rules that would drift from the PreToolUse one
  — `gitStaging.ts` is shared by both guards precisely to prevent that.

## Enforcement
Mostly mechanical already: `wiring.test.ts` holds the PreToolUse launcher. A matching wiring
test that runs `.githooks/pre-commit`'s command against a fabricated wide staging set would
close the same gap for the git side; worth adding if the pre-commit hook ever changes shape.
The "no logic in launchers" rule itself is judgment-only.

## Revisit when
Claude Code hooks gain a first-class way to run package code directly (no settings.json
command line), or a hook is needed in a repo that does not vendor `packages/hooks`.
