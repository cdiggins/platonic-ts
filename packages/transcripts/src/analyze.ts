// Corpus-level analysis of Claude Code session transcripts: classify every JSONL
// entry into byte-counted content slices, deduplicate resumed sessions, and build
// tabular views (composition, per-session, per-tool, per-model, user-message grep).
// Pure module — no IO; main.ts feeds it file contents.

const utf8Bytes = (s: string): number => Buffer.byteLength(s, 'utf8')

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

const asNumber = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// ---------------------------------------------------------------------------
// Entry parsing and classification
// ---------------------------------------------------------------------------

// Content slices a transcript entry can contribute bytes to. "injected" is text that
// appears in user messages but was machine-inserted (skill bodies, system reminders,
// task notifications, hook output) rather than typed by the user.
export type SliceKey =
  | 'assistantText'
  | 'thinking'
  | 'toolUseArgs'
  | 'toolResults'
  | 'userText'
  | 'injected'

export type TokenUsage = {
  readonly outputTokens: number
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly cacheCreationTokens: number
}

export type ParsedEntry = {
  readonly file: string
  readonly sessionId: string | undefined
  readonly uuid: string | undefined
  readonly timestamp: number | undefined
  readonly role: 'assistant' | 'user' | 'other'
  readonly isSidechain: boolean
  readonly model: string | undefined
  readonly usage: TokenUsage
  readonly slices: ReadonlyMap<SliceKey, number>
  readonly tools: readonly {
    readonly name: string
    readonly inputBytes: number
    readonly id: string | undefined
    readonly skill: string | undefined
  }[]
  // tool_result blocks in user entries, so result bytes can be attributed to the
  // tool call (matched by tool_use_id) at corpus level.
  readonly results: readonly { readonly toolUseId: string | undefined; readonly bytes: number }[]
  // Slash commands invoked in this entry (from injected <command-name> markers).
  readonly commandNames: readonly string[]
  readonly userText: string | undefined
  readonly lineBytes: number
}

const ZERO_USAGE: TokenUsage = {
  outputTokens: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
}

const INJECTED_MARKERS = [
  'Base directory for this skill',
  '<system-reminder>',
  '<command-name>',
  '<command-message>',
  '<task-notification>',
  '<local-command-stdout>',
  '<local-command-caveat>',
  'Stop hook feedback:',
] as const

const isInjectedText = (text: string): boolean =>
  INJECTED_MARKERS.some((m) => text.includes(m))

const toolResultBytes = (content: unknown): number => {
  if (typeof content === 'string') return utf8Bytes(content)
  if (!Array.isArray(content)) return 0
  return content.reduce(
    (sum: number, block) =>
      sum + (isRecord(block) && typeof block.text === 'string' ? utf8Bytes(block.text) : 0),
    0,
  )
}

export const parseEntry = (file: string, line: string): ParsedEntry | undefined => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined

  const type = asString(parsed.type)
  const role: ParsedEntry['role'] =
    type === 'assistant' ? 'assistant' : type === 'user' ? 'user' : 'other'

  const rawTs = asString(parsed.timestamp)
  const ts = rawTs === undefined ? undefined : Date.parse(rawTs)

  const base = {
    file,
    sessionId: asString(parsed.sessionId),
    uuid: asString(parsed.uuid),
    timestamp: ts === undefined || Number.isNaN(ts) ? undefined : ts,
    isSidechain: parsed.isSidechain === true,
    lineBytes: utf8Bytes(trimmed),
  }

  const message = isRecord(parsed.message) ? parsed.message : undefined

  if (role === 'assistant') {
    const usageRaw = message && isRecord(message.usage) ? message.usage : undefined
    const usage: TokenUsage = usageRaw
      ? {
          outputTokens: asNumber(usageRaw.output_tokens),
          inputTokens: asNumber(usageRaw.input_tokens),
          cacheReadTokens: asNumber(usageRaw.cache_read_input_tokens),
          cacheCreationTokens: asNumber(usageRaw.cache_creation_input_tokens),
        }
      : ZERO_USAGE

    const blocks = Array.isArray(message?.content) ? message.content.filter(isRecord) : []
    const textBytes = blocks
      .filter((b) => b.type === 'text')
      .reduce((sum, b) => sum + utf8Bytes(asString(b.text) ?? ''), 0)
    const thinkingBytes = blocks
      .filter((b) => b.type === 'thinking')
      .reduce((sum, b) => sum + utf8Bytes(asString(b.thinking) ?? ''), 0)
    const tools = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => {
        const input = isRecord(b.input) ? b.input : {}
        return {
          name: asString(b.name) ?? '(unnamed)',
          inputBytes: utf8Bytes(JSON.stringify(b.input ?? {})),
          id: asString(b.id),
          skill: asString(b.name) === 'Skill' ? asString(input.skill) : undefined,
        }
      })

    return {
      ...base,
      role,
      model: message ? asString(message.model) : undefined,
      usage,
      slices: new Map<SliceKey, number>([
        ['assistantText', textBytes],
        ['thinking', thinkingBytes],
        ['toolUseArgs', tools.reduce((sum, t) => sum + t.inputBytes, 0)],
      ]),
      tools,
      results: [],
      commandNames: [],
      userText: undefined,
    }
  }

  if (role === 'user') {
    const content = message?.content
    const texts: readonly string[] =
      typeof content === 'string'
        ? [content]
        : Array.isArray(content)
          ? content
              .filter(isRecord)
              .filter((b) => b.type === 'text')
              .map((b) => asString(b.text) ?? '')
          : []
    const results = Array.isArray(content)
      ? content
          .filter(isRecord)
          .filter((b) => b.type === 'tool_result')
          .map((b) => ({ toolUseId: asString(b.tool_use_id), bytes: toolResultBytes(b.content) }))
      : []

    const injected = texts.filter(isInjectedText)
    const typed = texts.filter((t) => !isInjectedText(t))
    const commandNames = texts.flatMap((t) =>
      [...t.matchAll(/<command-name>([^<]+)<\/command-name>/g)].map((m) => (m[1] ?? '').trim()),
    )

    return {
      ...base,
      role,
      model: undefined,
      usage: ZERO_USAGE,
      slices: new Map<SliceKey, number>([
        ['userText', typed.reduce((sum, t) => sum + utf8Bytes(t), 0)],
        ['injected', injected.reduce((sum, t) => sum + utf8Bytes(t), 0)],
        ['toolResults', results.reduce((sum, r) => sum + r.bytes, 0)],
      ]),
      tools: [],
      results,
      commandNames,
      userText: typed.length > 0 ? typed.join('\n') : undefined,
    }
  }

  return {
    ...base,
    role,
    model: undefined,
    usage: ZERO_USAGE,
    slices: new Map(),
    tools: [],
    results: [],
    commandNames: [],
    userText: undefined,
  }
}

// Resumed sessions copy their history into a new file; keep the first occurrence of
// each uuid. Entries without a uuid are kept as-is.
export const dedupeEntries = (entries: readonly ParsedEntry[]): readonly ParsedEntry[] => {
  // Reversed pairs make the FIRST occurrence win in the Map constructor.
  const firstIndexByUuid = new Map(entries.map((e, i) => [e.uuid, i] as const).reverse())
  return entries.filter((e, i) => e.uuid === undefined || firstIndexByUuid.get(e.uuid) === i)
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export type Table = {
  readonly title: string
  readonly columns: readonly string[]
  // Right-aligned when numeric-looking; rendered by renderTable.
  readonly rows: readonly (readonly string[])[]
  readonly notes: readonly string[]
}

// Rough prose-to-token estimate. Exact bytes are always shown alongside; this is a
// planning aid, not billing truth.
export const BYTES_PER_TOKEN = 4
export const estTokens = (bytes: number): number => Math.round(bytes / BYTES_PER_TOKEN)

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US')

const fmtSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : bytes >= 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${bytes} B`

const fmtPct = (part: number, whole: number): string =>
  whole > 0 ? `${((100 * part) / whole).toFixed(2)}%` : '—'

const sliceTotal = (entries: readonly ParsedEntry[], key: SliceKey): number =>
  entries.reduce((sum, e) => sum + (e.slices.get(key) ?? 0), 0)

const usageTotal = (entries: readonly ParsedEntry[], pick: (u: TokenUsage) => number): number =>
  entries.reduce((sum, e) => sum + pick(e.usage), 0)

const SLICE_LABELS: readonly (readonly [SliceKey, string])[] = [
  ['assistantText', 'assistant visible text'],
  ['thinking', 'assistant thinking'],
  ['toolUseArgs', 'tool-call arguments'],
  ['toolResults', 'tool results'],
  ['userText', 'user typed text'],
  ['injected', 'injected text (skills, reminders, hooks)'],
]

// What the context is made of, in exact bytes — plus the API-reported token totals
// the estimates should be read against.
export const compositionTable = (entries: readonly ParsedEntry[]): Table => {
  const totalBytes = SLICE_LABELS.reduce((sum, [key]) => sum + sliceTotal(entries, key), 0)
  const sliceRows = SLICE_LABELS.map(([key, label]) => {
    const bytes = sliceTotal(entries, key)
    return [label, fmtInt(bytes), fmtSize(bytes), fmtInt(estTokens(bytes)), fmtPct(bytes, totalBytes)]
  })

  const out = usageTotal(entries, (u) => u.outputTokens)
  const inUncached = usageTotal(entries, (u) => u.inputTokens)
  const cacheCreate = usageTotal(entries, (u) => u.cacheCreationTokens)
  const cacheRead = usageTotal(entries, (u) => u.cacheReadTokens)
  const totalProcessed = out + inUncached + cacheCreate + cacheRead

  return {
    title: 'Context composition (deduplicated corpus)',
    columns: ['slice', 'bytes', 'size', 'est tokens', '% of content bytes'],
    rows: [
      ...sliceRows,
      ['— API-reported token totals —', '', '', '', ''],
      ['output tokens (billed)', '', '', fmtInt(out), ''],
      ['input tokens (uncached)', '', '', fmtInt(inUncached), ''],
      ['cache creation tokens', '', '', fmtInt(cacheCreate), ''],
      ['cache read tokens', '', '', fmtInt(cacheRead), ''],
      ['total tokens processed', '', '', fmtInt(totalProcessed), ''],
    ],
    notes: [
      `est tokens = bytes / ${BYTES_PER_TOKEN} (rough prose heuristic; API totals above are exact)`,
      `assistant visible text ceiling: ${fmtPct(estTokens(sliceTotal(entries, 'assistantText')), out)} of billed output tokens, ${fmtPct(estTokens(sliceTotal(entries, 'assistantText')), totalProcessed)} of total processed`,
    ],
  }
}

export const sessionsTable = (entries: readonly ParsedEntry[]): Table => {
  const ids = [...new Set(entries.map((e) => e.sessionId ?? e.file))]
  const rows = ids
    .map((id) => {
      const group = entries.filter((e) => (e.sessionId ?? e.file) === id)
      const stamps = group.map((e) => e.timestamp).filter((t): t is number => t !== undefined)
      const first = stamps.length > 0 ? Math.min(...stamps) : undefined
      const last = stamps.length > 0 ? Math.max(...stamps) : undefined
      const mins = first !== undefined && last !== undefined ? (last - first) / 60_000 : 0
      const bytes = group.reduce((sum, e) => sum + e.lineBytes, 0)
      return {
        first: first ?? 0,
        cells: [
          id.slice(0, 8),
          first !== undefined ? new Date(first).toISOString().slice(0, 16).replace('T', ' ') : '—',
          `${mins.toFixed(0)} min`,
          fmtInt(group.filter((e) => e.userText !== undefined).length),
          fmtInt(group.reduce((sum, e) => sum + (e.slices.get('assistantText') ?? 0), 0)),
          fmtInt(usageTotal(group, (u) => u.outputTokens)),
          fmtInt(usageTotal(group, (u) => u.cacheCreationTokens)),
          fmtInt(usageTotal(group, (u) => u.cacheReadTokens)),
          fmtSize(bytes),
        ],
      }
    })
    .sort((a, b) => a.first - b.first)
    .map((r) => r.cells)

  return {
    title: 'Per-session (deduplicated; resumed history counted once, under original session)',
    columns: ['session', 'started (UTC)', 'span', 'user msgs', 'text bytes', 'out tokens', 'cache create', 'cache read', 'file size'],
    rows,
    notes: ['"user msgs" counts typed messages only — injected skill/reminder text excluded'],
  }
}

// Result bytes attributed back to the tool that produced them, by tool_use_id.
export const toolsTable = (entries: readonly ParsedEntry[]): Table => {
  const calls = entries.flatMap((e) => e.tools)
  const nameById = new Map(
    calls.filter((t) => t.id !== undefined).map((t) => [t.id, t.name] as const),
  )
  const results = entries.flatMap((e) => e.results)
  const resultBytesByName = results.reduce(
    (acc: ReadonlyMap<string, number>, r) => {
      const name = (r.toolUseId !== undefined ? nameById.get(r.toolUseId) : undefined) ?? '(unmatched)'
      return new Map([...acc, [name, (acc.get(name) ?? 0) + r.bytes]])
    },
    new Map<string, number>(),
  )

  const names = [...new Set([...calls.map((t) => t.name), ...resultBytesByName.keys()])]
  const rows = names
    .map((name) => {
      const group = calls.filter((t) => t.name === name)
      const argBytes = group.reduce((sum, t) => sum + t.inputBytes, 0)
      const resBytes = resultBytesByName.get(name) ?? 0
      return {
        total: argBytes + resBytes,
        cells: [
          name,
          fmtInt(group.length),
          fmtInt(argBytes),
          fmtInt(estTokens(argBytes)),
          fmtInt(resBytes),
          fmtInt(estTokens(resBytes)),
          fmtSize(argBytes + resBytes),
        ],
      }
    })
    .sort((a, b) => b.total - a.total)
    .map((r) => r.cells)

  return {
    title: 'Per-tool usage (arguments written by the model, results injected back)',
    columns: ['tool', 'calls', 'arg bytes', 'arg est tok', 'result bytes', 'result est tok', 'total size'],
    rows,
    notes: [
      'arg bytes count toward output tokens (model writes them); result bytes toward input/cache',
      '(unmatched) = tool_result blocks whose tool_use_id has no visible tool_use (e.g. truncated files)',
    ],
  }
}

// Skill tool invocations by skill name, and slash-command occurrences.
export const skillsTable = (entries: readonly ParsedEntry[]): Table => {
  const calls = entries.flatMap((e) => e.tools)
  const results = entries.flatMap((e) => e.results)
  const resultBytesById = new Map(
    results.filter((r) => r.toolUseId !== undefined).map((r) => [r.toolUseId, r.bytes] as const),
  )

  const skillCalls = calls.filter((t) => t.skill !== undefined)
  const skillNames = [...new Set(skillCalls.map((t) => t.skill))]
  const skillRows = skillNames
    .map((skill) => {
      const group = skillCalls.filter((t) => t.skill === skill)
      const resBytes = group.reduce(
        (sum, t) => sum + (t.id !== undefined ? (resultBytesById.get(t.id) ?? 0) : 0),
        0,
      )
      return {
        count: group.length,
        cells: [`skill: ${skill ?? ''}`, fmtInt(group.length), fmtInt(resBytes), fmtInt(estTokens(resBytes))],
      }
    })
    .sort((a, b) => b.count - a.count)
    .map((r) => r.cells)

  const commands = entries.flatMap((e) => e.commandNames)
  const commandNames = [...new Set(commands)]
  const commandRows = commandNames
    .map((cmd) => ({
      count: commands.filter((c) => c === cmd).length,
      cells: [`command: ${cmd}`, fmtInt(commands.filter((c) => c === cmd).length), '', ''],
    }))
    .sort((a, b) => b.count - a.count)
    .map((r) => r.cells)

  return {
    title: 'Skill invocations and slash commands',
    columns: ['name', 'count', 'result bytes', 'result est tok'],
    rows: [...skillRows, ...commandRows],
    notes: [
      'result bytes = the tool_result of the Skill call; the skill BODY injected into user turns is counted under "injected" in composition',
      'commands counted from <command-name> markers in user turns (no per-command byte attribution)',
    ],
  }
}

export const modelsTable = (entries: readonly ParsedEntry[]): Table => {
  const models = [...new Set(entries.map((e) => e.model).filter((m): m is string => m !== undefined))]
  const rows = models
    .map((model) => {
      const group = entries.filter((e) => e.model === model)
      const out = usageTotal(group, (u) => u.outputTokens)
      return {
        out,
        cells: [
          model,
          fmtInt(group.length),
          fmtInt(out),
          fmtInt(usageTotal(group, (u) => u.cacheCreationTokens)),
          fmtInt(usageTotal(group, (u) => u.cacheReadTokens)),
          fmtInt(group.reduce((sum, e) => sum + (e.slices.get('assistantText') ?? 0), 0)),
          fmtInt(group.reduce((sum, e) => sum + (e.slices.get('thinking') ?? 0), 0)),
        ],
      }
    })
    .sort((a, b) => b.out - a.out)
    .map((r) => r.cells)

  return {
    title: 'Per-model usage',
    columns: ['model', 'messages', 'out tokens', 'cache create', 'cache read', 'text bytes', 'thinking bytes'],
    rows,
    notes: [],
  }
}

// User messages matching a pattern, each with the output tokens spent answering it
// (assistant entries in the same file until the next typed user message).
export const grepTable = (entries: readonly ParsedEntry[], pattern: RegExp): Table => {
  const files = [...new Set(entries.map((e) => e.file))]
  const rows = files.flatMap((file) => {
    const seq = entries.filter((e) => e.file === file)
    return seq.flatMap((e, i) => {
      if (e.userText === undefined || !pattern.test(e.userText)) return []
      const rest = seq.slice(i + 1)
      const end = rest.findIndex((n) => n.userText !== undefined)
      const answer = end === -1 ? rest : rest.slice(0, end)
      const answerTokens = usageTotal(answer, (u) => u.outputTokens)
      return [[
        (e.sessionId ?? file).slice(0, 8),
        fmtInt(utf8Bytes(e.userText)),
        fmtInt(answerTokens),
        e.userText.slice(0, 70).replace(/\s+/g, ' '),
      ]]
    })
  })

  return {
    title: `User messages matching /${pattern.source}/${pattern.flags}`,
    columns: ['session', 'msg bytes', 'answer out tokens', 'message'],
    rows,
    notes: ['answer out tokens = output tokens until the next typed user message in that file'],
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const NUMERIC = /^[\d,.%\s—-]+(?:B|KB|MB|min)?$/

export const renderTable = (table: Table): string => {
  const widths = table.columns.map((col, i) =>
    Math.max(col.length, ...table.rows.map((r) => (r[i] ?? '').length)),
  )
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, i) =>
        NUMERIC.test(cell) && i > 0 ? cell.padStart(widths[i] ?? 0) : cell.padEnd(widths[i] ?? 0),
      )
      .join('  ')
      .trimEnd()

  const header = line(table.columns)
  const rule = widths.map((w) => '-'.repeat(w)).join('  ')
  const body = table.rows.map(line)
  const notes = table.notes.map((n) => `  note: ${n}`)
  return [`## ${table.title}`, '', header, rule, ...body, ...notes].join('\n')
}
