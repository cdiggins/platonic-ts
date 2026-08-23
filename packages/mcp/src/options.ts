// What every tool call is given besides its own arguments: where the repository
// is, where the ratchet baseline lives, and what time it is. The clock is a
// value rather than something a tool may read (PS-045).
export type CallOptions = {
  readonly repoDir: string
  readonly baselinePath: string
  readonly now: number
}
