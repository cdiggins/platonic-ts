// Pure merge of gitlink's CommitInfo + CommitSessionLink into dashboard row shape
// (BL-0014). Reading git and running parseGitLog/correlateCommits happens in
// main.ts (composition root); this module only shapes the result for the
// /api/commits endpoint and the commits table.

import type { CommitInfo, CommitSessionLink } from '../../gitlink/src/index.ts'

// Display row for a git commit with session correlation.
export type CommitRow = {
  readonly hash: string
  readonly shortHash: string
  readonly subject: string
  readonly timestamp: string
  readonly sessionLabel: string | undefined
  readonly confidence: CommitSessionLink['confidence']
}

const SHORT_HASH_LENGTH = 7

// A short human label for the linked session: prefer the session id itself
// (already short-ish, e.g. a UUID or a trailer's free-text author line); falls
// back to the correlated transcript file's basename when only that is known.
const sessionLabelFor = (link: CommitSessionLink | undefined): string | undefined => {
  if (link === undefined) return undefined
  if (link.sessionId !== undefined) return link.sessionId
  if (link.sessionFile !== undefined) return link.sessionFile
  return undefined
}

// Pure. One row per commit, most-recent-first order preserved from the input
// (git log already lists newest first; correlateCommits preserves input order).
// Commits with no matching link (shouldn't happen when both lists come from the
// same commit set, but the fence contract doesn't guarantee it) fall back to
// confidence 'none'.
export const buildCommitRows = (
  commits: readonly CommitInfo[],
  links: readonly CommitSessionLink[],
): readonly CommitRow[] => {
  const linkByHash = new Map(links.map((l) => [l.hash, l] as const))
  return commits.map((commit): CommitRow => {
    const link = linkByHash.get(commit.hash)
    return {
      hash: commit.hash,
      shortHash: commit.hash.slice(0, SHORT_HASH_LENGTH),
      subject: commit.subject,
      timestamp: commit.timestamp,
      sessionLabel: sessionLabelFor(link),
      confidence: link?.confidence ?? 'none',
    }
  })
}
