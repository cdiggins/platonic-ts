// PreToolUse(Bash) guard: blocks staging or committing files the agent did not name.
// Exit 2 blocks the tool call and returns stderr to the agent as a correction.
// Rule source: AGENTS.md "Conventions" and CONTRACTS.md fence table.

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let command = "";
try {
  command = JSON.parse(raw)?.tool_input?.command ?? "";
} catch {
  process.exit(0); // unparseable payload: do not block
}

// Quote-aware split into segments (unquoted ; | && || newline) of tokens (unquoted whitespace).
// Quoted text collapses to a single opaque token so a multi-line -m message cannot be
// mistaken for a command separator.
function segmentsOf(source) {
  const segments = [];
  let tokens = [];
  let token = "";
  let quote = null;
  const endToken = () => { if (token) tokens.push(token); token = ""; };
  const endSegment = () => { endToken(); if (tokens.length) segments.push(tokens); tokens = []; };

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
      else token += c;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; token += "\0"; continue; }
    if (c === "\\" && source[i + 1]) { token += source[++i]; continue; }
    if (c === ";" || c === "\n") { endSegment(); continue; }
    if ((c === "&" || c === "|") && source[i + 1] === c) { endSegment(); i++; continue; }
    if (c === "|") { endSegment(); continue; }
    if (/\s/.test(c)) { endToken(); continue; }
    token += c;
  }
  endSegment();
  return segments;
}

const violations = [];

for (const words of segmentsOf(command)) {
  const gitAt = words.findIndex((w) => w === "git");
  if (gitAt === -1) continue;

  // Skip global options like `git -C dir add`.
  let i = gitAt + 1;
  while (words[i]?.startsWith("-")) i += words[i] === "-C" || words[i] === "-c" ? 2 : 1;
  const subcommand = words[i];
  const args = words.slice(i + 1);

  if (subcommand === "add") {
    const broad = args.filter((a) => ["-A", "--all", ".", ":/", "*", "-u", "--update"].includes(a));
    if (broad.length > 0) violations.push(`\`git add ${broad.join(" ")}\` stages files you did not name.`);
    else if (args.every((a) => a.startsWith("-"))) violations.push("`git add` with no pathspec stages the whole worktree.");
  }

  if (subcommand === "commit") {
    if (args.some((a) => a === "--all" || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a)))
      violations.push("`git commit -a` commits every tracked modification, not just your files.");
    else if (!args.includes("--") && !args.includes("--amend"))
      violations.push("`git commit` without a `-- <paths>` pathspec commits whatever happens to be staged.");
  }
}

if (violations.length > 0) {
  console.error(
    [
      "Blocked by the repository's staging guard.",
      ...violations.map((v) => `  - ${v}`),
      "",
      "This repository runs parallel agents on one worktree, so a commit may only",
      "contain files you edited yourself (AGENTS.md, CONTRACTS.md fence table).",
      "",
      "Commit each file you touched by name:",
      "  git commit -m \"<message>\" -- packages/foo/src/a.ts packages/foo/test/a.test.ts",
      "",
      "Run `git status --porcelain` first if you are unsure which files are yours.",
    ].join("\n"),
  );
  process.exit(2);
}
