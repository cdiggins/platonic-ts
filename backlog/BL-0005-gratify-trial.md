---
id: BL-0005
title: Trial run on Gratify library
type: debt
status: in-progress
priority: p3
effort: L
risk: med
area: repo
sprint:
created: 2026-08-22
closed:
links: []
---
Apply platonic check to C:\Users\cdigg\git\studio\submodules\gratify, record findings.

First probe (2026-08-22, read-only): 31 TS files (src+tests). Escape hatches:
any 41, as-casts 67, non-null 26, ts-directives 4, eslint-disable 0.
Own tsc: clean. Under platonic strict flags (+noUncheckedIndexedAccess,
exactOptionalPropertyTypes, noImplicitReturns): 322 error lines.
Next: ratchet-based retrofit — adopt check with Gratify's current counts as baseline,
tighten via mechanic-agent waves instead of fixing all 322 upfront.

## Done means
- [ ] platonic check adopted in Gratify with a baseline ratchet.json
- [ ] escape-hatch counts trending down across at least one retrofit wave
- [ ] findings recorded back in this item or a follow-up ADR
