# @platonic/hooks

Claude Code hook scripts that append `HookEvent` JSONL lines to
`<repo>/.claude/events/events.jsonl`, for the dashboard to read alongside transcripts.

- `src/index.ts` — pure `HookEvent` type, `parseHookEventLine`, `formatHookEvent`.
- `src/io.ts` — stdin payload reading + JSONL append (the only IO in this package).
- `src/postToolUse.ts` — PostToolUse hook entry point.
- `src/gitStaging.ts` — pure staging rules (shell command parsing, staged-path checks).
- `src/preToolUse.ts` — PreToolUse hook entry point; refuses broad staging commands.
- `src/preCommit.ts` — git pre-commit entry point; refuses commits spanning two packages.
- `src/sessionStart.ts` — SessionStart hook entry point.

This package does **not** write `.claude/settings.json` — wiring the hooks into Claude Code
is a manual step. Paste the following into your project's `.claude/settings.json` (merge with
any existing `hooks` block):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "tsx packages/hooks/src/postToolUse.ts"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "tsx packages/hooks/src/sessionStart.ts"
          }
        ]
      }
    ]
  }
}
```

Both scripts read the hook's JSON payload from stdin, resolve the repo root from the payload's
`cwd` field (falling back to the process's own `cwd()`), and append one line to
`.claude/events/events.jsonl` under that root — creating the `.claude/events/` directory if it
doesn't exist yet. Both scripts always exit `0`: any failure (malformed payload, missing
fields, a write error) is swallowed so a hook can never block the agent.

## Staging guards

`preToolUse.ts` and `preCommit.ts` enforce one rule from two directions: a commit may contain
only files its author edited. Agents share a single working tree here, so a broad `git add`
sweeps in another agent's in-flight work.

The PreToolUse hook sees the command before it runs and blocks `git add -A`, a bare `git add`,
`git commit -a`, and a `git commit` with no `-- <paths>` pathspec. Exit code 2 cancels the tool
call and returns stderr to the agent, so the refusal reads as a correction. Wire it under
`PreToolUse` with matcher `Bash|PowerShell`:

```json
{
  "type": "command",
  "command": "tsx packages/hooks/src/preToolUse.ts",
  "timeout": 15
}
```

The pre-commit hook backstops commits the tool layer never sees — a manual terminal, an editor,
an MCP tool with its own commit path. Git knows the staged path set but not who staged it, so
it can only check the shape a broad `git add` produces: a commit spanning more than one
package. That is a proxy, not a proof. It misses a broad add confined to one package, and it
flags a legitimate cross-package change, which the author waves through with
`PLATONIC_WIDE_COMMIT=1`. Enable it per clone with `npm run hooks:install`, which points
`core.hooksPath` at `.githooks/`; git hooks are not carried by a clone.

Unlike this package's logging hooks, these two are meant to block. They still fail open on
their own errors: a guard that breaks must not make the repository uncommittable.

Command parsing is shell-agnostic — it reads `tool_input.command`, which both the Bash and
PowerShell tools carry. It is tuned for POSIX quoting; PowerShell's backtick escape is read as
a quote character, which can hide a violation from the guard but only rarely invents one.
