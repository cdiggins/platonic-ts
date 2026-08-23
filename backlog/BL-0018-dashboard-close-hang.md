---
id: BL-0018
title: Dashboard close() can hang on leaked keep-alive sockets
type: bug
status: ready
priority: p3
effort: S
risk: low
area: dashboard
sprint:
created: 2026-08-23
closed:
links: [BL-0006, BL-0016]
---

## Problem
`startDashboard`'s returned `close()` in `packages/dashboard/src/server.ts` clears the SSE
intervals, ends the SSE responses, and calls `server.close()`. It never calls
`server.closeAllConnections()`. `server.close()` stops accepting new connections but waits for
existing ones to end on their own, so any idle keep-alive socket — which `fetch` leaves behind
by default — keeps the callback from firing.

## Impact
Latent rather than observed. Every dashboard test currently passes, because undici happens to
release its sockets before the test runner gives up. It is a hang, not a failure, so when it
does bite it will look like a stuck test run or a process that will not exit, with nothing in
the output pointing at the cause. Found while building the codeview server, which does call
`closeAllConnections()` and therefore does not have the problem.

## Affected code
- `packages/dashboard/src/server.ts` — the `close` closure inside `startDashboard`.
- `packages/codeview/src/server.ts` — has the correct shape; the two are otherwise near
  identical.

## Fix approaches
- **Call it.** Add `server.closeAllConnections()` before `server.close()`. One line.
- **Share the shutdown.** Both servers now have the same listen/close dance. A small shared
  helper in `packages/core` would stop the two from drifting again, at the cost of a dependency
  from two Root-zone files onto a Core helper that only exists to hold four lines.

## Simplest fix
The one line, plus a regression test that opens a keep-alive connection, calls `close()`, and
asserts it resolves inside a timeout.

- Gets: the hang cannot come back silently.
- Gives up: nothing. The duplication between the two servers remains, and can be revisited if a
  third server ever appears.

## Done means
- [ ] `close()` calls `server.closeAllConnections()`
- [ ] A test asserts `close()` resolves while a keep-alive connection is open
