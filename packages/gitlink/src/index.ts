// Pure library for correlating git commits to agent sessions.
// Parsing and correlation logic; IO in io.ts.

// Format string for git log to produce commit records.
// Delimiter: %x1f (ASCII 31, Unit Separator) between fields within a record,
// %x1e (ASCII 30, Record Separator) at the end of each record.
// Usage: git log --format='<this string>'
export const GIT_LOG_FORMAT = '%H%x1f%aI%x1f%s%x1f%(trailers)%x1e'

export type CommitInfo = {
  readonly hash: string
  readonly timestamp: string // ISO 8601 format (e.g., 2026-08-22T14:30:45+00:00)
  readonly subject: string
  readonly trailers: Readonly<Record<string, string>>
}

export type CommitSessionLink = {
  readonly hash: string
  readonly sessionId?: string
  readonly sessionFile?: string
  readonly confidence: 'trailer' | 'time-window' | 'none'
}

// Parse git log raw output into CommitInfo records.
// Raw input is expected to match GIT_LOG_FORMAT: records separated by %x1e,
// fields within a record separated by %x1f.
// Trailers section is parsed as key: value lines (git trailer format).
export const parseGitLog = (raw: string): readonly CommitInfo[] => {
  if (raw.length === 0) return []

  const records = raw.split('\x1e').filter((r) => r.length > 0)

  return records
    .map((record): CommitInfo | undefined => {
      const fields = record.split('\x1f')
      if (fields.length < 4) return undefined // Need at least hash, timestamp, subject, trailers

      const hash = fields[0]
      const timestamp = fields[1]
      const subject = fields[2]
      const trailersRaw = fields[3]

      if (!hash || !timestamp || !subject) return undefined

      // Parse trailers: each line is "Key: value" or "Key: value\n"
      // Trailers can span multiple lines (continuation lines start with space/tab).
      // For now, simple key: value parsing (one per line, no continuation).
      const trailers = (): Readonly<Record<string, string>> => {
        if (!(typeof trailersRaw === 'string') || trailersRaw.length === 0) {
          return {}
        }
        const trailerLines = trailersRaw.split('\n').filter((line) => line.trim().length > 0)
        const entries = trailerLines
          .map((line) => {
            const colonIdx = line.indexOf(':')
            if (colonIdx > 0) {
              const key = line.substring(0, colonIdx).trim()
              const value = line.substring(colonIdx + 1).trim()
              if (key && value) {
                return [key, value] as const
              }
            }
            return undefined
          })
          .filter((entry): entry is readonly [string, string] => entry !== undefined)
        return Object.fromEntries(entries)
      }

      return {
        hash,
        timestamp,
        subject,
        trailers: trailers(),
      }
    })
    .filter((commit): commit is CommitInfo => commit !== undefined)
}

// Correlate commits to sessions.
// Returns one CommitSessionLink per commit with a confidence level:
// - 'trailer': Session-Id or Co-Authored-By trailer matched exactly
// - 'time-window': No trailer match; found a session with activity within ±10 min of commit time
// - 'none': No match
export const correlateCommits = (
  commits: readonly CommitInfo[],
  activities: readonly { sessionId?: string; timestamp?: string; file?: string }[],
): readonly CommitSessionLink[] =>
  commits.map((commit): CommitSessionLink => {
    // Try trailer match first: Session-Id or Co-Authored-By
    const trailerSessionId = commit.trailers['Session-Id']
    if (trailerSessionId) {
      return {
        hash: commit.hash,
        sessionId: trailerSessionId,
        confidence: 'trailer',
      }
    }

    // Check for Co-Authored-By trailer as fallback
    const coAuthoredBy = commit.trailers['Co-Authored-By']
    if (coAuthoredBy) {
      return {
        hash: commit.hash,
        sessionId: coAuthoredBy,
        confidence: 'trailer',
      }
    }

    // If no trailer match, try time-window heuristic: ±10 minutes
    const commitTime = new Date(commit.timestamp).getTime()
    const timeWindowMs = 10 * 60 * 1000 // ±10 minutes

    let closestActivity: (typeof activities)[number] | undefined
    let closestDistance = Infinity

    for (const activity of activities) {
      if (!activity.sessionId || !activity.timestamp) continue
      const activityTime = new Date(activity.timestamp).getTime()
      const distance = Math.abs(commitTime - activityTime)

      if (distance <= timeWindowMs && distance < closestDistance) {
        closestDistance = distance
        closestActivity = activity
      }
    }

    if (closestActivity && closestActivity.sessionId) {
      if (closestActivity.file) {
        return {
          hash: commit.hash,
          sessionId: closestActivity.sessionId,
          sessionFile: closestActivity.file,
          confidence: 'time-window',
        }
      }
      return {
        hash: commit.hash,
        sessionId: closestActivity.sessionId,
        confidence: 'time-window',
      }
    }

    return {
      hash: commit.hash,
      confidence: 'none',
    }
  })
