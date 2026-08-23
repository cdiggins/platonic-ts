// Rendering an init plan as text. Kept pure and separate from the CLI so the
// exact wording an operator reads before approving a retrofit is testable.
import type { ApplyReport, InitAction, InitPlan } from './index.ts'

const summarizeAction = (action: InitAction): string => {
  if (action.kind === 'writeFile') {
    const lines = action.content.split('\n').length
    return `write   ${action.path}  (${lines} lines) — ${action.reason}`
  }
  if (action.kind === 'mergeJson') {
    const added = Object.keys(action.additions).length
    const conflicts = action.conflicts.length
    return `merge   ${action.path}  (+${added} key group(s), ${conflicts} conflict(s)) — ${action.reason}`
  }
  return `skip    ${action.path} — ${action.reason}`
}

// Formats an InitPlan as human-readable text: action summary, then manual steps.
export const formatPlan = (plan: InitPlan): string => {
  const actionLines = plan.actions.map((action) => `  ${summarizeAction(action)}`)
  const manualLines =
    plan.manualSteps.length === 0
      ? ['  (none)']
      : plan.manualSteps.map((step) => `  - ${step}`)
  return [
    `plan (profile: ${plan.profile})`,
    ...actionLines,
    'manual steps',
    ...manualLines,
  ].join('\n')
}

// Formats an ApplyReport as human-readable text: dry-run indicator and per-file outcomes.
export const formatApplyReport = (report: ApplyReport): string => {
  const header = report.dryRun ? 'dry run — nothing written' : 'applied'
  const lines = report.outcomes.map(
    (outcome) => `  ${outcome.changed ? 'done' : 'noop'}  ${outcome.path} — ${outcome.detail}`,
  )
  return [header, ...lines].join('\n')
}
