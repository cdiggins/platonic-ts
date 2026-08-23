# @platonic/hooks

Claude Code hook scripts that append `HookEvent` JSONL lines to
`<repo>/.claude/events/events.jsonl`, for the dashboard to read alongside transcripts.

- `src/index.ts` — pure `HookEvent` type, `parseHookEventLine`, `formatHookEvent`.
- `src/io.ts` — stdin payload reading + JSONL append (the only IO in this package).
- `src/postToolUse.ts` — PostToolUse hook entry point.
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
