// IO edge: turns browser feedback into a backlog item file.
// STUB — Track H fills this in. Signature is the wave contract.
import type { FeedbackInput, FeedbackResult } from '../../core/src/index.ts'

export const appendFeedbackItem = (
  backlogDir: string,
  _input: FeedbackInput,
  _now: number,
): Promise<FeedbackResult> => Promise.resolve({ id: 'BL-0000', file: backlogDir })
