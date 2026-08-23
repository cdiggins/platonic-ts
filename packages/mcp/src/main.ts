// Entry point for the MCP server. Run with: npx tsx packages/mcp/src/main.ts
//
// stdout carries the protocol and nothing else; anything a human should read
// goes to stderr, or it corrupts the stream.
import { resolve } from 'node:path'
import { serve } from './server.ts'

const repoDir = resolve(import.meta.dirname, '..', '..', '..')

serve(
  {
    repoDir,
    baselinePath: resolve(repoDir, 'ratchet.json'),
    write: (line) => process.stdout.write(line),
    log: (message) => process.stderr.write(`${message}\n`),
  },
  process.stdin,
)
