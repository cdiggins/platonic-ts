// Several symbol-addressed edits that are only correct together, applied all or
// nothing. Combining is pure: the check that the edits do not fight each other
// happens before anything is written, so a batch that cannot be applied
// cleanly is refused rather than half-run.
import type { EditPlan } from './edit.ts'
import { overlapping } from './edit.ts'

// Every failure is reported, not the first: a caller fixing three problems
// wants all three in one round trip.
export const combinePlans = (plans: readonly EditPlan[]): EditPlan => {
  if (plans.length === 0) return { ok: false, text: 'no plans to combine.' }
  const failures = plans.flatMap((plan) => (plan.ok ? [] : [plan.text]))
  if (failures.length > 0)
    return {
      ok: false,
      text: [`${failures.length} of ${plans.length} plans failed:`, ...failures].join('\n'),
    }
  const planned = plans.flatMap((plan) => (plan.ok ? [plan] : []))
  const edits = planned.flatMap((plan) => plan.edits)
  const collisions = overlapping(edits)
  if (collisions.length > 0)
    return {
      ok: false,
      text: [`${collisions.length} overlapping edits:`, ...collisions].join('\n'),
    }
  return {
    ok: true,
    edits,
    summary: [
      `${plans.length} plans combined, ${edits.length} edits:`,
      ...planned.map((plan) => plan.summary),
    ].join('\n'),
  }
}
