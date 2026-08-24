// The shape of every guard refusal: the rules broken, why the rule exists, then the command to
// run instead. Agents read a blocked hook's stderr as a correction, so a refusal that only says
// "no" costs a round-trip; one that names the alternative does not.

// Formats one refusal. Callers supply the three parts; the order and framing are fixed here so
// every guard in this repository refuses in the same voice.
export const refusalMessage = (
  violations: readonly string[],
  rationale: readonly string[],
  remedy: readonly string[],
): string =>
  ['Blocked by a repository guard.', ...violations.map((v) => `  - ${v}`), '', ...rationale, '', ...remedy].join('\n')
