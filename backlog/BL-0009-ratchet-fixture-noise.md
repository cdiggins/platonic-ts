---
id: BL-0009
title: Ratchet regex counts pollute baseline via test fixtures
status: todo
priority: 3
created: 2026-08-22
---
tsDirectives/eslintDisables are counted by regex over raw source text, so ratchet test
fixtures containing directive strings inflate the baseline (4 and 7 at init), and any new
fixture will trip the ratchet falsely. AST counts (any/as/!) don't have this problem.
Fix: count directives from comment trivia only, or exclude packages/check/test from the scan.
