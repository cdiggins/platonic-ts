# packages/hooks/src

This folder implements the Claude Code hook scripts and git hook that back the repository's
staging guard and event log: pure rule/codec modules, the IO edges that read hook stdin and
touch git and the filesystem, and the runnable entry points Claude Code and git invoke
directly. See `packages/hooks/README.md` for how each script is wired into
`.claude/settings.json` and `.githooks/`.

| File | Purpose |
|---|---|
| `gitStaging.ts` | Pure rules for what a commit may contain: the checks that flag broad `git add`/`git commit -a` invocations and staged-path sets spanning more than one package, built on `shell.ts`'s tokenizer. |
| `index.ts` | Defines the pure `HookEvent` type and its JSONL codec (`parseHookEventLine`/`formatHookEvent`), and re-exports the tailing API from `tail.ts` as this package's public surface. |
| `io.ts` | IO edge for hook scripts: reads a hook's JSON payload from stdin, appends `HookEvent` lines to `.claude/events/events.jsonl`, and — for the staging guards — reads git's staged-path set, reads the `PLATONIC_WIDE_COMMIT` override, and writes a refusal to stderr with an exit code. |
| `payload.ts` | Two dependency-free guards (`isRecord`, `asString`) for pulling typed fields out of untrusted JSON payloads (hook stdin, event lines). |
| `postToolUse.ts` | PostToolUse hook entry point: turns a tool-call payload into a `HookEvent` (capturing the invoked skill name when the tool is `Skill`) and appends it to the event log; always exits 0. |
| `powershell.ts` | Dialect rules for the PowerShell tool: flags `&&`/`||` in a command, which Windows PowerShell 5.1 cannot parse at all, and supplies the rationale and remedy text the guard prints. |
| `preCommit.ts` | Git pre-commit hook entry point: backstops the PreToolUse guard for commits it never saw (manual terminal, editor, MCP tool) by refusing a staged set that spans more than one package, unless `PLATONIC_WIDE_COMMIT=1` is set. |
| `preToolUse.ts` | PreToolUse hook entry point matched on the Bash and PowerShell tools: extracts the shell command from the payload and refuses (exit 2) a command that stages or commits files broadly, or a PowerShell command using chain operators PowerShell 5.1 cannot parse. |
| `refusal.ts` | The shared shape of a refusal message — violations, rationale, remedy — that every guard in this package prints in the same voice. |
| `sessionStart.ts` | SessionStart hook entry point: turns a session-start payload into a `HookEvent` and appends it to the event log; always exits 0. |
| `shell.ts` | Quote-aware tokenizing of a shell command string into words and separator runs, shared by the staging and PowerShell-dialect guards; tuned for POSIX quoting. |
| `tail.ts` | Incremental tailer for hook event log files: tracks per-file byte offset and line remainder across polls, reads only newly appended bytes, and resets on truncation. |
