// Impure I/O for reading git log. The pure parsing library (index.ts) is
// independent and can be tested without git access.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GIT_LOG_FORMAT } from './index.ts'

const execFileAsync = promisify(execFile)

// Read git log from the given repository directory.
// Returns the raw output as produced by: git log --format=<GIT_LOG_FORMAT>
// Throws if git is not available or the directory is not a git repo.
export const readGitLog = async (repoDir: string): Promise<string> => {
  const { stdout } = await execFileAsync('git', ['log', `--format=${GIT_LOG_FORMAT}`], {
    cwd: repoDir,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024, // 10 MB
  })
  return stdout
}
