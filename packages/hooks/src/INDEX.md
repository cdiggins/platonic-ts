# packages/hooks/src

This folder implements the Claude Code hook scripts and git hook that back the repository's
staging guard and event log: pure rule/codec modules, the IO edges that read hook stdin and
touch git and the filesystem, and the runnable entry points Claude Code and git invoke
directly. See `packages/hooks/README.md` for how each script is wired into
`.claude/settings.json` and `.githooks/`.

<!-- BEGIN GENERATED: src-index (npm run docs:regen) -->
| File | Purpose |
|---|---|
| `gitStaging.ts` | Pure rules for which files a commit is allowed to contain, shared by the two guards that enforce them: the PreToolUse hook (inspects a shell command before it runs) and the pre-commit hook (inspects the staged path set). Agents here share one working tree, so a commit may only contain files its author named — see AGENTS.md "Conventions". |
| `index.ts` | Pure event type + JSONL codec for Claude Code hook events. IO (reading hook stdin payloads, appending to the event log) lives in postToolUse.ts / sessionStart.ts. Tailing live events is via tail.ts (pollHookEvents). |
| `io.ts` | IO edge for hook scripts: read the JSON payload Claude Code pipes to a hook's stdin, and append formatted events to the repo's event log. Kept separate from index.ts so the codec (parseHookEventLine/formatHookEvent) stays pure and testable without touching the filesystem. |
| `payload.ts` | Shared, dependency-free helpers for reading untrusted JSON payloads (hook stdin, event lines). Kept tiny and duplicated in spirit from packages/transcripts/src/index.ts's style. |
| `postToolUse.ts` | Runnable PostToolUse hook entry point (`tsx packages/hooks/src/postToolUse.ts`). Reads the PostToolUse payload Claude Code pipes to stdin ({ session_id, cwd, tool_name, tool_input, ... }) and appends one HookEvent line to `<cwd>/.claude/events/events.jsonl`. Never throws and never sets a non-zero exit code: a hook must not block the agent. |
| `powershell.ts` | Dialect rules for commands sent to the PowerShell tool, which runs Windows PowerShell 5.1. |
| `preCommit.ts` | Runnable git pre-commit hook entry point, invoked by `.githooks/pre-commit`. Backstops the PreToolUse guard for commits it cannot see — a manual terminal, an editor, an MCP tool with its own commit path. Git knows only the staged path set, not who staged it, so this checks the one property that set reveals: a commit wider than a single package fence. |
| `preToolUse.ts` | Runnable PreToolUse hook entry point (`tsx packages/hooks/src/preToolUse.ts`), matched on the Bash and PowerShell tools. Reads the payload Claude Code pipes to stdin and refuses commands that stage files the agent did not name, or that cannot parse in the shell they were sent to. |
| `refusal.ts` | The shape of every guard refusal: the rules broken, why the rule exists, then the command to run instead. Agents read a blocked hook's stderr as a correction, so a refusal that only says "no" costs a round-trip; one that names the alternative does not. |
| `sessionStart.ts` | Runnable SessionStart hook entry point (`tsx packages/hooks/src/sessionStart.ts`). Reads the SessionStart payload Claude Code pipes to stdin ({ session_id, cwd, source, ... }) and appends one HookEvent line to `<cwd>/.claude/events/events.jsonl`. Never throws and never sets a non-zero exit code: a hook must not block the agent. |
| `shell.ts` | Quote-aware reading of a shell command string, shared by the PreToolUse guards. Splitting only on UNQUOTED separators is what keeps the guards honest: a multi-line `-m` message is not two commands, and `echo 'git add -A'` is not a `git add`. |
| `tail.ts` | Incremental tailing of hook event logs. Reads only appended bytes since the last poll, tracks file offsets and partial lines (remainder), parses via parseHookEventLine, skips malformed lines, handles missing files and truncation. |
<!-- END GENERATED -->
