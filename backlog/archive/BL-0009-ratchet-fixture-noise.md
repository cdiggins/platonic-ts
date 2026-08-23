---
id: BL-0009
title: Ratchet regex counts pollute baseline via test fixtures
type: bug
status: done
priority: p3
effort: S
risk: low
area: check
sprint:
created: 2026-08-22
closed: 2026-08-22
links: []
---
tsDirectives/eslintDisables are counted by regex over raw source text, so ratchet test
fixtures containing directive strings inflate the baseline (4 and 7 at init), and any new
fixture will trip the ratchet falsely. AST counts (any/as/!) don't have this problem.
Fix: count directives from comment trivia only, or exclude packages/check/test from the scan.

## Done means
- [ ] tsDirectives/eslintDisables counted from actual comment trivia, not raw text matches
- [ ] ratchet.json counts drop to reflect only real directives, not fixture noise
- [ ] a new test fixture containing a directive string no longer trips the ratchet
