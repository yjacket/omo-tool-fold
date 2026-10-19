// Isolated live replay of an OMO session in the bundled Senpi engine CLI.
// Loads the working-tree tool-fold extension plus a QA eval tool, never sends a prompt,
// presses Ctrl+O twice and renders each screen through xterm.js to PNG/txt evidence.
//
// Env overrides:
//   SENPI_DIST  senpi dist root (default: global bun install)
//   QA_SESSION  real session .jsonl to replay a copy of (default: a synthetic session this script writes,
//               so the viewport content and the assertions are deterministic)
//   QA_ROOT     scratch root for the temp agent dir, session copy and xterm (default: fresh mkdtemp)
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const SENPI_DIST = process.env.SENPI_DIST ?? "C:/Users/yjack/.bun/install/global/node_modules/@code-yeongyu/senpi/dist";
const USER_SESSIONS = "C:/Users/yjack/.omo/agent/sessions/--C--dev-omo-omo-tool-fold--";
const INSTALLED_CLONE = "C:/Users/yjack/.omo/agent/git/github.com/yjacket/omo-tool-fold";
const EVIDENCE = join(REPO, ".omo/evidence/fold-thinking-eval-group");
const COLS = 150;
const ROWS = 45;
// The expanded transcript of this synthetic session is taller than the documented 45-row viewport.
// Capture it at 70 rows so the older eval assertions and the new notice assertions share one frame.
const EXPANDED_ROWS = 70;

const CLI = join(SENPI_DIST, "bundle/cli.js");
if (!existsSync(CLI)) throw new Error(`senpi bundle CLI not found at ${CLI}; set SENPI_DIST`);

const SESSION_SRC = process.env.QA_SESSION;
const SYNTHETIC = SESSION_SRC === undefined;

// Session v3 entries chained by parentId: a user message, three eval turns (finished thinking +
// eval toolCall, then its result), an assistant text, one lone eval turn, and a closing message.
const syntheticSession = () => {
  const t0 = Date.parse("2026-10-17T00:00:00.000Z");
  const entries = [];
  let parentId = null;
  const add = (fields) => {
    const id = (entries.length + 1).toString(16).padStart(8, "0");
    const timestamp = new Date(t0 + entries.length * 1000).toISOString();
    entries.push({ ...fields, id, parentId, timestamp });
    parentId = id;
  };
  const at = () => t0 + entries.length * 1000;
  const thinking = (text) => ({ type: "thinking", thinking: text, thinkingSignature: "qa", startedAt: at(), endedAt: at() + 1 });
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const assistant = (content, stopReason, usageOverride) =>
    add({
      type: "message",
      message: { role: "assistant", content, api: "claude-sdk-oauth", provider: "anthropic-subscription", model: "claude-opus-5-5", usage: usageOverride ?? usage, stopReason, timestamp: at() },
    });
  const customEntry = (customType, data) => add({ type: "custom", customType, data });
  const cacheUsage = (input, cacheRead) => ({ ...usage, input, cacheRead, cacheWrite: 0, totalTokens: input + cacheRead });
  const evalTurn = (n) => {
    const toolCallId = `toolu_qa_${n}`;
    const summary = `QA step ${n}`;
    assistant([thinking(`qa thought ${n}`), { type: "toolCall", id: toolCallId, name: "eval", arguments: { language: "js", summary, code: "1" } }], "toolUse");
    add({
      type: "message",
      message: {
        role: "toolResult",
        toolCallId,
        toolName: "eval",
        content: [{ type: "text", text: "1" }],
        details: { language: "js", summary, cells: [{ index: 0, status: "complete", language: "js", summary, code: "1" }] },
        isError: false,
        timestamp: at(),
      },
    });
  };
  add({ type: "model_change", provider: "anthropic-subscription", modelId: "claude-opus-5-5" });
  add({ type: "thinking_level_change", thinkingLevel: "low" });
  add({ type: "message", message: { role: "user", content: [{ type: "text", text: "QA replay" }], timestamp: at() } });
  for (const n of [1, 2, 3]) evalTurn(n);
  // Cache-read turn. The later `QA 끝` turn re-bills the prompt, so the runtime derives a
  // cache-miss notice there on resume (the notice itself is not persisted).
  assistant([{ type: "text", text: "between" }], "stop", cacheUsage(0, 40000));
  evalTurn(4);
  // A folded edit right after eval 4 joins it in one mixed block.
  assistant([{ type: "toolCall", id: "toolu_qa_edit", name: "edit", arguments: { path: join(REPO, "README.md"), edits: [{ oldText: "a", newText: "b" }] } }], "toolUse");
  add({
    type: "message",
    message: {
      role: "toolResult",
      toolCallId: "toolu_qa_edit",
      toolName: "edit",
      content: [{ type: "text", text: "Successfully replaced 1 block(s) in README.md." }],
      details: { diff: "--- a\n+++ b\n-old line\n+new line\n+more" },
      isError: false,
      timestamp: at(),
    },
  });
  assistant([thinking("qa thought final"), { type: "text", text: "QA 끝" }], "stop", cacheUsage(40000, 0));
  // Durable custom entries in the exact shapes the runtime appends. Both notice types render
  // through CustomEntryComponent; the QA extension registers their renderers in this isolated run.
  // Distinct goal ids keep both cache-warm cards: the runtime replaces a wake onto the same goal's
  // preceding wait card, so one goal id would leave only the wake in the transcript.
  customEntry("omo-kibitzer:nudged", {
    version: 1,
    nudges: [{ path: join(REPO, ".omo/memory/qa-nudge.md"), hint: "QA recall hint" }],
    via: "prompt",
  });
  customEntry("goal-cache-warmup", {
    phase: "scheduled",
    goalId: "goal-qa-wait",
    iteration: 1,
    delayMs: 60000,
    dueAtMs: t0 + 600000,
    activeMonitorCount: 1,
    wakeSources: "monitor",
    cache: { cachedTokens: 40000, ttlSeconds: 300 },
  });
  customEntry("goal-cache-warmup", {
    phase: "resumed",
    goalId: "goal-qa-wake",
    iteration: 1,
    delayMs: 60000,
    dueAtMs: t0 + 600000,
    waitedMs: 60000,
    wakeCause: "timer",
    activeMonitorCount: 1,
    wakeSources: "monitor",
  });
  const header = { type: "session", version: 3, id: "00000000-0000-7000-8000-000000000a01", timestamp: new Date(t0).toISOString(), cwd: REPO };
  return [header, ...entries].map((e) => JSON.stringify(e));
};

// Bun (and its WebView profile dirs) follow TMPDIR before the OS temp dir.
const TMP = process.env.TMPDIR ?? tmpdir();
const ownRoot = process.env.QA_ROOT === undefined;
const ROOT = process.env.QA_ROOT ?? mkdtempSync(join(TMP, "tool-fold-live-"));
const AGENT = join(ROOT, "agent");
const XTERM = join(ROOT, "xterm");
const SESSIONS = join(ROOT, "sessions"); // the engine writes session side files next to the session
const SESSION = join(SESSIONS, "session.jsonl");
const created = [AGENT, SESSIONS, join(ROOT, "qa-eval-tool.ts"), XTERM, join(ROOT, "page.html")];

const listSessions = () => (existsSync(USER_SESSIONS) ? readdirSync(USER_SESSIONS).sort() : []);
const cloneHead = async () => (await Bun.$`git -C ${INSTALLED_CLONE} log -1 --format=%h`.nothrow().quiet().text()).trim();
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? [`${relative(AGENT, p)}/`, ...walk(p)] : [relative(AGENT, p)];
  });

// (a) isolated agent dir, (b) session copy, (c) QA eval tool
mkdirSync(join(AGENT, "themes"), { recursive: true });
// codemode is a bundled built-in that registers the real eval tool even with --no-extensions;
// disable it so the QA eval tool (with its EVAL-FULL-OUTPUT marker) owns the name.
writeFileSync(
  join(AGENT, "settings.json"),
  JSON.stringify({ theme: "grok-day-focus", hideThinkingBlock: true, showCacheMissNotices: true, packages: [], disabledBuiltinExtensions: ["codemode"] }),
);
cpSync(join(REPO, "themes/grok-day-focus.json"), join(AGENT, "themes/grok-day-focus.json"));
mkdirSync(SESSIONS, { recursive: true });
const syntheticLines = SYNTHETIC ? syntheticSession() : [];
if (SYNTHETIC) writeFileSync(SESSION, `${syntheticLines.join("\n")}\n`);
else cpSync(SESSION_SRC, SESSION);
writeFileSync(
  join(ROOT, "qa-eval-tool.ts"),
  `import { Text } from "@earendil-works/pi-tui";
import { noticeEntryRenderer } from ${JSON.stringify(join(SENPI_DIST, "core/extensions/notice/index.js"))};
import { renderGoalCacheWarmupEntry } from ${JSON.stringify(join(SENPI_DIST, "core/extensions/builtin/goal/cache-warm-renderer.js"))};
// --no-extensions hides the bundled goal extension, and the OMO plugin is not loaded in this
// isolated run, so register the real runtime adapter/renderer here rather than a fake card.
const kibitzerEntryRenderer = noticeEntryRenderer((entry) => {
  const data = entry.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return undefined;
  if (data.version !== 1 || !Array.isArray(data.nudges) || data.nudges.length === 0) return undefined;
  const nudges = [];
  for (const nudge of data.nudges) {
    if (nudge === null || typeof nudge !== "object") return undefined;
    if (typeof nudge.path !== "string" || typeof nudge.hint !== "string") return undefined;
    nudges.push({ path: nudge.path, hint: nudge.hint });
  }
  const [first, ...rest] = nudges;
  return {
    glyph: "✦",
    title: "Kibitzer !",
    tone: "accent",
    why: \`recalled memory: \${first.hint}\`,
    extra: [
      ...rest.map((nudge) => ({ text: \`recalled memory: \${nudge.hint}\`, tone: "dim" })),
      ...nudges.map((nudge) => ({ text: nudge.path, tone: "dim" })),
    ],
    detail: "Kibitzer surfaced this from stored memory; it is a hint, not current state.",
  };
});
export default function (pi) {
  pi.registerEntryRenderer("omo-kibitzer:nudged", kibitzerEntryRenderer);
  pi.registerEntryRenderer("goal-cache-warmup", renderGoalCacheWarmupEntry);
  pi.registerTool({
    name: "eval",
    label: "eval",
    description: "QA stand-in for the omo eval tool; renders markers only.",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    async execute() { return { content: [{ type: "text", text: "qa" }], details: {} }; },
    renderCall(args) { return new Text("EVAL-CALL " + String(args?.summary ?? ""), 0, 0); },
    renderResult() { return new Text("EVAL-FULL-OUTPUT", 0, 0); },
  });
}
`,
);

const { brandEnvNames } = await import(new URL(`file:///${join(SENPI_DIST, "core/brand.js").replace(/\\/g, "/")}`).href);
const agentEnv = Object.fromEntries(brandEnvNames("CODING_AGENT_DIR").map((n) => [n, AGENT]));
for (const legacy of ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"]) agentEnv[legacy] = AGENT;

const sessionsBefore = listSessions();
const headBefore = await cloneHead();

// (d) launch in a PTY
const argv = [
  process.execPath, CLI,
  "--session", SESSION,
  "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve", "--offline",
  "-e", join(REPO, "extension/tool-fold.ts"),
  "-e", join(ROOT, "qa-eval-tool.ts"),
];
const chunks = [];
let total = 0;
const waiters = new Set();
const proc = Bun.spawn(argv, {
  cwd: REPO,
  env: { ...process.env, ...agentEnv, TERM: "xterm-256color", COLORTERM: "truecolor" },
  terminal: {
    cols: COLS,
    rows: ROWS,
    data(_t, data) {
      chunks.push(Buffer.from(data));
      total += data.length;
      for (const w of waiters) w();
    },
  },
});
const raw = () => Buffer.concat(chunks);

// Resolve once output arrived after `from` and then stayed quiet for `quietMs`; bounded by `maxMs`.
const waitIdle = (from, quietMs, maxMs) =>
  new Promise((resolve, reject) => {
    const deadline = setTimeout(() => done(new Error(`no redraw idle within ${maxMs}ms after byte ${from}`)), maxMs);
    let quiet;
    const arm = () => {
      clearTimeout(quiet);
      if (total > from) quiet = setTimeout(() => done(), quietMs);
    };
    const done = (err) => {
      clearTimeout(deadline);
      clearTimeout(quiet);
      waiters.delete(arm);
      err ? reject(err) : resolve(total);
    };
    waiters.add(arm);
    if (total > from) arm();
  });

// Resolve once the ANSI-stripped output after `from` matches `pattern`; bounded by `maxMs`.
const waitFor = (from, pattern, maxMs) =>
  new Promise((resolve, reject) => {
    const check = () => {
      if (!pattern.test(Bun.stripANSI(raw().subarray(from).toString("utf8")))) return;
      clearTimeout(deadline);
      waiters.delete(check);
      resolve(total);
    };
    const deadline = setTimeout(() => {
      waiters.delete(check);
      reject(new Error(`no ${pattern} within ${maxMs}ms after byte ${from}`));
    }, maxMs);
    waiters.add(check);
    check();
  });

const keys = [];
let killed = false;
const killTree = async () => {
  if (killed) return;
  killed = true;
  if (process.platform === "win32") await Bun.$`taskkill /PID ${proc.pid} /T /F`.nothrow().quiet();
  else proc.kill("SIGKILL");
  await proc.exited;
};

const captures = {};
const captureRows = {};
try {
  // ready = the editor border is drawn, then the history redraw settles
  const ready = await waitFor(0, /─{40,}/, 90000);
  captures.collapsed = await waitIdle(ready - 1, 2500, 60000);
  captureRows.collapsed = ROWS;
  // Expand, resettle at the taller viewport so every assertion target is in frame, then collapse.
  let from = total;
  keys.push({ key: "0x0f", atByte: from });
  proc.terminal.write("\x0f");
  await waitIdle(from, 1500, 20000);
  from = total;
  keys.push({ key: `resize ${COLS}x${EXPANDED_ROWS}`, atByte: from });
  proc.terminal.resize(COLS, EXPANDED_ROWS);
  captures.expanded = await waitIdle(from, 2500, 30000);
  captureRows.expanded = EXPANDED_ROWS;
  from = total;
  keys.push({ key: `resize ${COLS}x${ROWS}`, atByte: from });
  proc.terminal.resize(COLS, ROWS);
  await waitIdle(from, 1500, 20000);
  from = total;
  keys.push({ key: "0x0f", atByte: from });
  proc.terminal.write("\x0f");
  captures.recollapsed = await waitIdle(from, 1500, 20000);
  captureRows.recollapsed = ROWS;
} finally {
  await killTree();
}
const exitCode = await proc.exited;
const stream = raw();
mkdirSync(EVIDENCE, { recursive: true });
writeFileSync(join(EVIDENCE, "live-raw.ansi"), stream);

// (f) xterm.js render
mkdirSync(XTERM, { recursive: true });
if (!existsSync(join(XTERM, "node_modules/@xterm/xterm/lib/xterm.js"))) {
  writeFileSync(join(XTERM, "package.json"), JSON.stringify({ name: "qa-xterm", private: true }));
  const add = await Bun.$`bun add @xterm/xterm`.cwd(XTERM).nothrow().quiet();
  if (add.exitCode !== 0) throw new Error(`bun add @xterm/xterm failed: ${add.stderr.toString()}`);
}
const xjs = await Bun.file(join(XTERM, "node_modules/@xterm/xterm/lib/xterm.js")).text();
const xcss = await Bun.file(join(XTERM, "node_modules/@xterm/xterm/css/xterm.css")).text();
const page = join(ROOT, "page.html");
writeFileSync(
  page,
  `<!doctype html><html><head><meta charset="utf-8"><style>${xcss}html,body{margin:0;background:#fff}</style>
<script>${xjs.replace(/<\/script/g, "<\\/script")}</script></head><body><div id="t"></div><script>
window.show = (b64, rows) => new Promise((resolve) => {
  document.getElementById("t").innerHTML = "";
  const term = new Terminal({ cols: ${COLS}, rows, fontSize: 13, theme: { background: "#ffffff", foreground: "#1f2328", cursor: "#1f2328" }, fontFamily: "Consolas, monospace", allowProposedApi: true, scrollback: 100000 });
  term.open(document.getElementById("t"));
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  term.write(bytes, () => requestAnimationFrame(() => {
    const buf = term.buffer.active;
    const lines = [];
    for (let i = buf.viewportY; i < buf.viewportY + rows; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? "");
    resolve(lines.join("\\n"));
  }));
});
</script></body></html>`,
);
// Bun.WebView leaves a Chrome profile dir (.<hash>.bun-chrome) in the temp dir; remove only new ones.
const profiles = () => readdirSync(TMP).filter((n) => n.endsWith(".bun-chrome"));
const profilesBefore = profiles();
const view = new Bun.WebView({ width: 1200, height: 800 });
const screens = {};
try {
  await view.navigate(`file:///${page.replace(/\\/g, "/")}`);
  for (const [name, end] of Object.entries(captures)) {
    const b64 = stream.subarray(0, end).toString("base64");
    screens[name] = await view.evaluate(`window.show(${JSON.stringify(b64)}, ${captureRows[name]})`);
    writeFileSync(join(EVIDENCE, `live-${name}.txt`), screens[name]);
    await Bun.write(join(EVIDENCE, `live-${name}.png`), await view.screenshot());
  }
} finally {
  view.close?.();
}
const profileDirs = profiles().filter((n) => !profilesBefore.includes(n)).map((n) => join(TMP, n));

// (g) assertions
const plain = Bun.stripANSI(stream.toString("utf8"));
const header = /Ran \d+ (?:evals|tools)/;
const NEEDLES = ["TypeError", "tool-fold 꺼짐", "tool-fold 일부 꺼짐", "detachAll", "Failed to load extension", "[render error"];

// Synthetic mode: the transcript is known, so assert exact viewport lines.
const collapsedChecks = (name, screen) => {
  const ls = screen.split(/\r?\n/).map((l) => l.trim());
  const headers = ls.filter((l) => header.test(l));
  const at = ls.findIndex((l) => /Ran 3 evals/.test(l));
  return [
    [`${name}: two block headers, 'Ran 3 evals' and the mixed eval+edit block`, headers.length === 2 && at !== -1],
    [
      `${name}: block members are '└ js ✓ QA step 1', 'js ✓ QA step 2', 'js ✓ QA step 3'`,
      at !== -1 && ls[at + 1] === "└ js ✓ QA step 1" && ls[at + 2] === "js ✓ QA step 2" && ls[at + 3] === "js ✓ QA step 3",
    ],
    (() => {
      const mixed = ls.findIndex((l) => l.includes("Ran 2 tools · eval 1 · edit 1"));
      return [
        `${name}: mixed block 'Ran 2 tools · eval 1 · edit 1' with '└ eval js ✓ QA step 4' and 'edit README.md (+2/-1)'`,
        mixed !== -1 && ls[mixed + 1] === "└ eval js ✓ QA step 4" && ls[mixed + 2] === "edit README.md (+2/-1)",
      ];
    })(),
    [`${name}: no 'Thought:' line`, !ls.some((l) => l.includes("Thought:"))],
    [`${name}: 'QA 끝' present`, ls.some((l) => l.includes("QA 끝"))],
  ];
};
const cacheMissLine = /Cache miss: .*tokens re-billed/;
const noticeChecks = (name, screen) => [
  [`${name}: no 'Kibitzer' nudge text`, !screen.includes("Kibitzer")],
  [`${name}: no 'Cache-warm' notice text`, !screen.includes("Cache-warm")],
  [`${name}: cache-miss notice stays visible`, cacheMissLine.test(screen)],
];
const syntheticAssertions = () => [
  ...collapsedChecks("collapsed", screens.collapsed),
  ...noticeChecks("collapsed", screens.collapsed),
  ["expanded shows the Kibitzer nudge", screens.expanded.includes("Kibitzer !") && screens.expanded.includes("recalled memory: QA recall hint")],
  ["expanded shows the cache-warm wait", screens.expanded.includes("Cache-warm wait")],
  ["expanded shows the cache-warm wake", screens.expanded.includes("Cache-warm wake")],
  ["expanded keeps the cache-miss notice", cacheMissLine.test(screens.expanded)],
  ["expanded shows EVAL-FULL-OUTPUT at least 3 times", screens.expanded.split("EVAL-FULL-OUTPUT").length - 1 >= 3],
  // The expanded edit diff scrolls the first block's header out of the 45-row viewport; the mixed one stays.
  ["expanded keeps the mixed block header", screens.expanded.includes("Ran 2 tools · eval 1 · edit 1")],
  ["expanded shows the edit diff", screens.expanded.includes("+new line")],
  ...collapsedChecks("recollapsed", screens.recollapsed),
  ...noticeChecks("recollapsed", screens.recollapsed),
  ["recollapsed has no EVAL-FULL-OUTPUT", !screens.recollapsed.includes("EVAL-FULL-OUTPUT")],
  ...NEEDLES.map((n) => [`stream has no '${n}'`, !plain.includes(n)]),
];

// QA_SESSION mode: the replayed session itself discusses these strings (plans, diffs, code). A hit
// counts as a runtime emission only when its surrounding text is not found in the session source.
const sessionText = await Bun.file(SESSION).text();
const runtimeHits = (needle) => {
  const hits = [];
  for (const line of plain.split(/\r?\n/)) {
    for (let at = line.indexOf(needle); at !== -1; at = line.indexOf(needle, at + 1)) {
      // context on either side, since TUI gutters or wrapping can cut one side
      const end = at + needle.length;
      const frags = [20, 8].flatMap((w) => [line.slice(at, end + w), line.slice(Math.max(0, at - w), end)]);
      const inTranscript = frags
        .map((f) => f.trim())
        .filter((f) => f.length >= needle.length + 4)
        .some((f) => sessionText.includes(f) || sessionText.includes(JSON.stringify(f).slice(1, -1)));
      if (!inTranscript) hits.push(line.trim());
    }
  }
  return hits;
};
const runtime = SYNTHETIC ? {} : Object.fromEntries(NEEDLES.map((n) => [n, runtimeHits(n)]));
// A leftover runtime thinking label renders as its own line (`Thought: 1ms` plus the one-column
// card padding). The replayed session's own prose also mentions the label mid-sentence (and the
// renderer strips its markdown backticks), so a raw substring hit is not proof of a runtime label;
// match the label line shape instead.
const hasThoughtLabel = (screen) => screen.split(/\r?\n/).some((line) => /^\s*Thought:\s+\S/.test(line));
const realSessionAssertions = () => [
  ["collapsed has a 'Ran N evals' header", header.test(screens.collapsed)],
  ["collapsed has no runtime 'Thought:' label line", !hasThoughtLabel(screens.collapsed)],
  ["expanded shows EVAL-FULL-OUTPUT", screens.expanded.includes("EVAL-FULL-OUTPUT")],
  ["recollapsed has a 'Ran N evals' header", header.test(screens.recollapsed)],
  ["recollapsed has no EVAL-FULL-OUTPUT", !screens.recollapsed.includes("EVAL-FULL-OUTPUT")],
  ["recollapsed has no runtime 'Thought:' label line", !hasThoughtLabel(screens.recollapsed)],
  ...Object.entries(runtime).map(([n, hits]) => [`stream has no runtime '${n}' (outside replayed transcript text)`, hits.length === 0]),
];
const assertions = SYNTHETIC ? syntheticAssertions() : realSessionAssertions();

// (h) isolation receipts
const sessionsAfter = listSessions();
const added = sessionsAfter.filter((n) => !sessionsBefore.includes(n));
const headAfter = await cloneHead();
const agentWrites = walk(AGENT);
assertions.push(
  ["no new non-01a14910 file in the user session dir", added.every((n) => n.includes("01a14910"))],
  ["installed clone HEAD unchanged", headBefore === headAfter],
);

// (i) cleanup
if (ownRoot) rmSync(ROOT, { recursive: true, force: true });
else for (const p of created) rmSync(p, { recursive: true, force: true });
// The WebView's Chrome can still hold its profile until this process exits; report, don't fail.
const profileErrors = [];
for (const p of profileDirs) {
  try {
    rmSync(p, { recursive: true, force: true });
  } catch (error) {
    profileErrors.push(`${p}: ${error.code ?? error}`);
  }
}
created.push(...profileDirs);

const report = {
  command: argv,
  cwd: REPO,
  agentEnv,
  sessionSource: SESSION_SRC ?? "synthetic",
  syntheticSessionLines: syntheticLines.length,
  keys,
  captureBytes: captures,
  streamBytes: stream.length,
  engineExit: { pid: proc.pid, exitCode, killed, exited: proc.exitCode !== null || proc.signalCode !== null },
  runtimeHits: runtime,
  transcriptHits: Object.fromEntries(NEEDLES.map((n) => [n, plain.split(n).length - 1])),
  assertions: assertions.map(([name, ok]) => ({ name, ok })),
  isolation: { headBefore, headAfter, sessionsBefore, sessionsAfter, added, agentWrites },
  cleanup: { removed: ownRoot ? [ROOT] : created, remaining: created.filter((p) => existsSync(p)), profileErrors },
  evidence: readdirSync(EVIDENCE).filter((n) => n.startsWith("live-")).map((n) => join(EVIDENCE, n)),
};
console.log(JSON.stringify(report, null, 2));
const failed = assertions.filter(([, ok]) => !ok);
for (const [name] of failed) console.error(`FAIL: ${name}`);
process.exit(failed.length === 0 ? 0 : 1);
