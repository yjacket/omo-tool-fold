// Run with Bun >= 1.4. No prompts, installed-extension changes, or user sessions.
// SENPI_DIST, QA_ROOT (scratch parent), EVIDENCE_DIR, QA_NO_FOLD=1,
// QA_BROWSER_PATH, QA_BROWSER_SKILL, and QA_XTERM_ROOT are optional overrides.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--provider" || !["claude", "codex"].includes(args[1])) {
  throw new Error("Usage: bun qa/history-window-replay.mjs --provider claude|codex");
}
const provider = args[1];
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(process.env.SENPI_DIST ?? join(homedir(), ".omo/agent/runtime/bb7a5bb46b656c02-7e186e28b781/dist"));
const CLI = join(DIST, "bundle/cli.js");
if (!existsSync(CLI)) throw new Error(`Missing engine: ${CLI}; set SENPI_DIST`);
const scratchParent = resolve(process.env.QA_ROOT ?? tmpdir());
mkdirSync(scratchParent, { recursive: true });
// Always own a unique child, even when QA_ROOT points to a shared scratch parent.
const RUN_TMP = mkdtempSync(join(scratchParent, "history-window-"));
const EVIDENCE = resolve(process.env.EVIDENCE_DIR ?? join(REPO, ".omo/evidence/history-window", `${provider}${process.env.QA_NO_FOLD === "1" ? "-baseline" : ""}`));
if (EVIDENCE === RUN_TMP || EVIDENCE.startsWith(`${RUN_TMP}/`) || EVIDENCE.startsWith(`${RUN_TMP}\\`)) {
  rmSync(RUN_TMP, { recursive: true, force: true });
  throw new Error("EVIDENCE_DIR must be outside this run's temporary directory");
}
mkdirSync(EVIDENCE, { recursive: true });
process.env.RUN_TMP = RUN_TMP;
process.env.TMPDIR = RUN_TMP;
process.env.TMP = RUN_TMP;
process.env.TEMP = RUN_TMP;
process.env.NODE_COMPILE_CACHE = join(RUN_TMP, "node-cache");
process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = join(RUN_TMP, "bun-cache");
const COLS = 150;
const ROWS = 45;
const TIMEOUT = 90000;
const AGENT = join(RUN_TMP, "agent");
const SESSION = join(RUN_TMP, "sessions/replay.jsonl");
const QA_TOOL = join(RUN_TMP, "qa-tools.ts");
const noFold = process.env.QA_NO_FOLD === "1";
const children = new Set();
const cleanup = [];
const report = { provider, noFold, dimensions: { cols: COLS, rows: ROWS }, historyLines: 100, runTmp: RUN_TMP, evidence: EVIDENCE, actions: [], captures: {}, cleanup };
let browser;
let server;
let stream = Buffer.alloc(0);
let failure;

function fixture() {
  const t0 = Date.parse("2026-10-23T00:00:00Z");
  const entries = [];
  let parentId = null;
  const add = (fields) => {
    const id = (entries.length + 1).toString(16).padStart(8, "0");
    entries.push({ ...fields, id, parentId, timestamp: new Date(t0 + entries.length * 1000).toISOString() });
    parentId = id;
  };
  const at = () => t0 + entries.length * 1000;
  const model = provider === "claude"
    ? { api: "claude-sdk-oauth", provider: "anthropic-subscription", model: "claude-opus-5-5" }
    : { api: "openai-codex-responses", provider: "chatgpt-subscription", model: "gpt-6.1-sol" };
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const assistant = (content, stopReason = "stop") => add({ type: "message", message: { role: "assistant", ...model, content, stopReason, usage, timestamp: at() } });
  const thinking = (n) => ({
    type: "thinking",
    thinking: provider === "claude" ? `QA_THINKING_${n}` : "",
    thinkingSignature: provider === "claude" ? "qa-signature" : JSON.stringify({
      id: `rs_qa_${n}`, type: "reasoning", summary: [{ type: "summary_text", text: `QA_SIGNED_SUMMARY_${n}` }],
    }),
    startedAt: at(), endedAt: at() + 1,
  });
  const turn = (n, isError = false) => {
    const id = provider === "claude" ? `toolu_qa_${n}` : `call_qa_${n}|fc_qa_${n}`;
    const summary = isError ? "QA_ERROR_CALL" : `QA_STEP_${n}`;
    assistant([thinking(n), { type: "toolCall", id, name: "eval", arguments: { language: "js", summary, code: `/* ${summary} */` } }], "toolUse");
    const text = isError ? "QA_ERROR_VISIBLE: deterministic synthetic failure" :
      Array.from({ length: 75 }, (_, line) => `QA_LONG_${n}_${String(line + 1).padStart(3, "0")} ${"successful output ".repeat(5)}`).join("\n");
    add({ type: "message", message: { role: "toolResult", toolCallId: id, toolName: "eval", content: [{ type: "text", text }], isError, timestamp: at(),
      details: { language: "js", summary, cells: [{ index: 0, status: isError ? "error" : "complete", language: "js", summary }] } } });
  };
  add({ type: "model_change", provider: model.provider, modelId: model.model });
  add({ type: "thinking_level_change", thinkingLevel: "low" });
  add({ type: "message", message: { role: "user", content: [{ type: "text", text: "QA_HISTORY_BEGIN" }], timestamp: at() } });
  turn(1);
  turn(2);
  assistant([{ type: "text", text: "QA_GROUP_BREAK_A" }]);
  add({ type: "custom", customType: "omo-kibitzer:nudged", data: { version: 1, nudges: [{ path: "qa/synthetic", hint: "QA_NOTICE_EXPANDED" }], via: "prompt" } });
  turn(3);
  turn(4);
  assistant([{ type: "text", text: "QA_GROUP_BREAK_B" }]);
  turn(5);
  turn(6, true);
  assistant([{ type: "text", text: "QA_HISTORY_END" }]);
  return `${[{ type: "session", version: 3, id: "00000000-0000-7000-8000-000000000b01", timestamp: new Date(t0).toISOString(), cwd: REPO }, ...entries]
    .map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

// Observes, but never changes, the history window or projection. A private OSC marker
// follows the engine's synchronous terminal writes for the exact frame under test.
function qaExtension() {
  return `
import { Text, TuiMainScreen } from "@earendil-works/pi-tui";
import { InteractiveMode } from "@code-yeongyu/senpi";
import { noticeEntryRenderer } from ${JSON.stringify(pathToFileURL(join(DIST, "core/extensions/notice/index.js")).href)};
let pending;
let mode;
const initial = InteractiveMode.prototype.renderInitialMessages;
const expand = InteractiveMode.prototype.setToolsExpanded;
const render = TuiMainScreen.prototype.doRender;
if (![initial, expand, render].every((fn) => typeof fn === "function")) throw new Error("QA_RENDER_SEAM_MISSING");
InteractiveMode.prototype.renderInitialMessages = function (...args) {
  const result = initial.apply(this, args);
  mode = this;
  pending = "initial";
  this.ui.requestRender();
  return result;
};
InteractiveMode.prototype.setToolsExpanded = function (expanded) {
  const changed = expanded !== this.toolOutputExpanded;
  const result = expand.call(this, expanded);
  if (changed) {
    mode = this;
    pending = expanded ? "expanded" : "recollapsed";
    this.ui.requestRender();
  }
  return result;
};
TuiMainScreen.prototype.doRender = function (...args) {
  const result = render.apply(this, args);
  if (pending && mode?.renderer === this) {
    const phase = pending;
    pending = undefined;
    const chat = mode.chatContainer;
    const snapshot = { phase, expanded: mode.toolOutputExpanded, historyStart: chat?.display?.historyStart,
      children: chat?.children?.length };
    this.terminal.write("\\x1b]0;QA_HISTORY;" + phase + ";" + Buffer.from(JSON.stringify(snapshot)).toString("base64") + "\\x07");
  }
  return result;
};
export default function (pi) {
  pi.registerEntryRenderer("omo-kibitzer:nudged", noticeEntryRenderer(() => ({
    glyph: "*", title: "QA_NOTICE_EXPANDED", tone: "accent", why: "QA_NOTICE_EXPANDED",
    extra: [{ text: "QA_NOTICE_DETAIL", tone: "dim" }],
  })));
  pi.registerTool({
    name: "eval", label: "eval", description: "Synthetic replay only; never executed.",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    async execute() { throw new Error("QA_MUST_NOT_EXECUTE"); },
    renderCall(args) { return new Text(String(args?.summary ?? "QA_CALL"), 0, 0); },
    renderResult(result, options, _theme, context) {
      const text = result.content.filter((c) => c.type === "text").map((c) => c.text).join("\\n");
      if (context?.isError || result.isError || options.expanded) return new Text(text, 0, 0);
      return new Text("QA_ORIGINAL_COLLAPSED", 0, 0);
    },
  });
}
`;
}

async function kill(child, label) {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32") {
      const killer = Bun.spawn(["taskkill", "/PID", String(child.pid), "/T", "/F"], { stdout: "pipe", stderr: "pipe" });
      const code = await killer.exited;
      cleanup.push({ action: "taskkill", label, pid: child.pid, exitCode: code });
    } else child.kill("SIGKILL");
  }
  await child.exited;
  cleanup.push({ action: "reaped", label, pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode });
  children.delete(child);
}

// Register before spawning or sending a key. Only an exact marker after the byte
// boundary satisfies a capture; ordinary status prose cannot satisfy the waiter.
const listeners = new Set();
function waitFrame(phase, from) {
  return new Promise((resolveFrame, reject) => {
    const timer = setTimeout(() => finish(new Error(`No QA ${phase} frame after byte ${from}`)), TIMEOUT);
    const finish = (error, value) => {
      clearTimeout(timer);
      listeners.delete(check);
      error ? reject(error) : resolveFrame(value);
    };
    const check = () => {
      const tail = stream.subarray(from).toString("latin1");
      const match = new RegExp(`\\x1b\\]0;QA_HISTORY;${phase};([A-Za-z0-9+/=]+)\\x07`).exec(tail);
      if (match) finish(undefined, { end: from + match.index + match[0].length, state: JSON.parse(Buffer.from(match[1], "base64").toString()) });
    };
    listeners.add(check);
    check();
  });
}

async function xtermAssets() {
  const installed = [
    process.env.QA_XTERM_ROOT,
    join(REPO, "node_modules/@xterm/xterm"),
    join(dirname(DIST), "node_modules/@xterm/xterm"),
  ].filter(Boolean).find((path) => existsSync(join(path, "lib/xterm.js")));
  if (installed) return installed;
  const cache = join(RUN_TMP, "xterm");
  mkdirSync(cache);
  writeFileSync(join(cache, "package.json"), '{"name":"history-window-qa-assets","private":true}');
  const install = Bun.spawn([process.execPath, "add", "--exact", "@xterm/xterm@5.5.0"], { cwd: cache, env: { ...process.env, BUN_INSTALL_CACHE_DIR: join(RUN_TMP, "package-cache") }, stdout: "pipe", stderr: "pipe" });
  children.add(install);
  const [code, stdout, stderr] = await Promise.all([install.exited, new Response(install.stdout).text(), new Response(install.stderr).text()]);
  children.delete(install);
  report.xtermInstall = { exitCode: code, stdout, stderr };
  if (code !== 0) throw new Error(`Isolated xterm install exited ${code}: ${stderr}`);
  return join(cache, "node_modules/@xterm/xterm");
}

async function renderCaptures() {
  const assets = await xtermAssets();
  const [js, css] = await Promise.all([Bun.file(join(assets, "lib/xterm.js")).text(), Bun.file(join(assets, "css/xterm.css")).text()]);
  const html = `<!doctype html><meta charset="utf-8"><style>${css}body{margin:0;background:white}</style>
<div id="terminal"></div><script>${js.replace(/<\/script/gi, "<\\/script")}</script><script>
window.show = async (base64) => {
  window.term?.dispose();
  const el = document.getElementById("terminal"); el.innerHTML = "";
  const term = window.term = new Terminal({cols:150,rows:45,fontSize:13,fontFamily:"Consolas,monospace",scrollback:100000,theme:{background:"#ffffff",foreground:"#1f2328"}});
  term.open(el);
  await new Promise(resolve => term.write(Uint8Array.from(atob(base64), c => c.charCodeAt(0)), resolve));
  await new Promise(requestAnimationFrame);
  const b = term.buffer.active;
  return {viewport:Array.from({length:45},(_,i)=>b.getLine(b.viewportY+i)?.translateToString(true)??"").join("\\n"),
    scrollback:Array.from({length:b.length},(_,i)=>b.getLine(i)?.translateToString(true)??"").join("\\n"),baseY:b.baseY,viewportY:b.viewportY};
};
</script>`;
  writeFileSync(join(EVIDENCE, "xterm.html"), html);
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }) });
  const skill = process.env.QA_BROWSER_SKILL ?? join(homedir(), ".bun/install/global/node_modules/omo-ai/plugin/skills/browser");
  const { loadOmowright } = await import(pathToFileURL(join(skill, "scripts/omowright.mjs")).href);
  const { omowright } = await loadOmowright();
  const chrome = [process.env.QA_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
    .filter(Boolean).find(existsSync);
  if (!chrome) throw new Error("Set QA_BROWSER_PATH to a Chromium executable; raw captures are retained");
  const profile = join(RUN_TMP, "browser-profile");
  const launch = [chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1500,950", "about:blank"];
  let chromeProc;
  const endpoint = new Promise((resolveEndpoint, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome CDP endpoint timeout")), TIMEOUT);
    chromeProc = Bun.spawn(launch, { env: process.env, stdout: "ignore", stderr: "pipe" });
    children.add(chromeProc);
    (async () => {
      let text = "";
      for await (const chunk of chromeProc.stderr) {
        text += Buffer.from(chunk).toString();
        const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(text);
        if (match) { clearTimeout(timer); resolveEndpoint(`http://127.0.0.1:${match[1]}`); }
      }
      clearTimeout(timer);
      reject(new Error(`Chrome exited before CDP endpoint: ${text}`));
    })().catch(reject);
  });
  report.browser = { command: launch, transport: "socket" };
  browser = await omowright.connect(await endpoint);
  const targets = await browser.listTargets();
  const target = targets.find((item) => item.type === "page");
  if (!target) throw new Error("Owned Chrome has no page target");
  const page = await browser.attachPage(target.targetId ?? target.id);
  await page.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: "load" });
  for (const [phase, capture] of Object.entries(report.captures)) {
    const base64 = stream.subarray(0, capture.end).toString("base64");
    const screen = await page.evaluate(`window.show(${JSON.stringify(base64)})`);
    writeFileSync(join(EVIDENCE, `${phase}.txt`), screen.viewport);
    writeFileSync(join(EVIDENCE, `${phase}-scrollback.txt`), screen.scrollback);
    writeFileSync(join(EVIDENCE, `${phase}.png`), await page.screenshot());
    capture.screen = { baseY: screen.baseY, viewportY: screen.viewportY };
    capture.sentinels = Object.fromEntries(["QA_HISTORY_BEGIN", "QA_HISTORY_END", "QA_ERROR_VISIBLE", "QA_NOTICE_EXPANDED", "QA_LONG_5_075"].map((needle) => [needle, screen.viewport.includes(needle)]));
    capture.viewport = screen.viewport;
  }
  await browser.close();
  browser = undefined;
  await kill(chromeProc, "owned Chrome");
}

try {
  mkdirSync(AGENT, { recursive: true });
  mkdirSync(dirname(SESSION), { recursive: true });
  writeFileSync(join(AGENT, "settings.json"), JSON.stringify({ theme: "grok-day", packages: [], hideThinkingBlock: true, disabledBuiltinExtensions: ["codemode"], showCacheMissNotices: false }));
  writeFileSync(SESSION, fixture());
  writeFileSync(join(EVIDENCE, "synthetic-session.jsonl"), fixture());
  writeFileSync(QA_TOOL, qaExtension());
  writeFileSync(join(EVIDENCE, "qa-tools.ts"), qaExtension());
  const { brandEnvNames } = await import(pathToFileURL(join(DIST, "core/brand.js")).href);
  const isolated = Object.fromEntries([...brandEnvNames("CODING_AGENT_DIR"), "OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"].map((name) => [name, AGENT]));
  const env = { ...process.env, ...isolated, PI_TUI_HISTORY_LINES: "100", TERM: "xterm-256color", COLORTERM: "truecolor" };
  const command = [process.execPath, CLI, "--session", SESSION, "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve", "--offline",
    ...(!noFold ? ["-e", join(REPO, "extension/tool-fold.ts")] : []), "-e", QA_TOOL];
  report.engine = { command, cwd: RUN_TMP, isolatedEnv: isolated, tempEnv: Object.fromEntries(["RUN_TMP", "TMPDIR", "TMP", "TEMP", "NODE_COMPILE_CACHE", "BUN_RUNTIME_TRANSPILER_CACHE_PATH"].map((key) => [key, env[key]])) };
  const initial = waitFrame("initial", 0);
  const engine = Bun.spawn(command, { cwd: RUN_TMP, env, terminal: { cols: COLS, rows: ROWS,
    data(_terminal, bytes) {
      stream = Buffer.concat([stream, Buffer.from(bytes)]);
      for (const listener of [...listeners]) listener();
    },
  } });
  children.add(engine);
  report.engine.pid = engine.pid;
  report.captures.initial = await initial;
  for (const phase of ["expanded", "recollapsed"]) {
    const from = stream.length;
    const frame = waitFrame(phase, from);
    report.actions.push({ action: "write", bytesHex: "0f", phase, fromByte: from, cols: COLS, rows: ROWS });
    engine.terminal.write("\x0f");
    report.captures[phase] = await frame;
  }
  await kill(engine, "isolated engine");
  writeFileSync(join(EVIDENCE, "raw.ansi"), stream);
  for (const [phase, capture] of Object.entries(report.captures)) writeFileSync(join(EVIDENCE, `${phase}.ansi`), stream.subarray(0, capture.end));
  await renderCaptures();
  const initialScreen = report.captures.initial.viewport;
  const finalScreen = report.captures.recollapsed.viewport;
  report.assertions = [
    { name: "initial body and error visible", ok: initialScreen.includes("QA_HISTORY_END") && initialScreen.includes("QA_ERROR_VISIBLE") },
    { name: "expanded history overflow", ok: report.captures.expanded.state.historyStart > 0 },
    { name: "expanded multiline content visible", ok: report.captures.expanded.viewport.includes("QA_LONG_") },
    { name: "recollapsed body and error visible", ok: finalScreen.includes("QA_HISTORY_END") && finalScreen.includes("QA_ERROR_VISIBLE") },
    { name: "recollapsed long output hidden", ok: !finalScreen.includes("QA_LONG_") },
    { name: "no runtime renderer failure", ok: !/QA_RENDER_SEAM_MISSING|Failed to load extension|TypeError:|detachAll|\[render error/.test(Bun.stripANSI(stream.toString())) },
  ];
  if (!noFold) report.assertions.push({ name: "recollapsed compact summaries restored", ok: finalScreen.includes("QA_STEP_1") && finalScreen.includes("QA_STEP_5") });
  if (report.assertions.some((assertion) => !assertion.ok)) throw new Error("Replay assertions failed; inspect report.json and PNG captures");
} catch (error) {
  failure = error;
  report.error = error.stack ?? String(error);
} finally {
  if (browser) {
    try { await browser.close(); cleanup.push({ action: "browser connection closed" }); }
    catch (error) { cleanup.push({ action: "browser close failed", error: String(error) }); }
  }
  if (server) { server.stop(true); cleanup.push({ action: "capture server stopped" }); }
  for (const child of [...children]) {
    try { await kill(child, "owned child"); }
    catch (error) { cleanup.push({ action: "process cleanup failed", pid: child.pid, error: String(error) }); failure ??= error; }
  }
  writeFileSync(join(EVIDENCE, "raw.ansi"), stream);
  try {
    rmSync(RUN_TMP, { recursive: true, force: true });
    cleanup.push({ action: "temporary directory removed", path: RUN_TMP, remains: existsSync(RUN_TMP) });
  } catch (error) {
    cleanup.push({ action: "temporary directory removal failed", path: RUN_TMP, error: String(error) });
    failure ??= error;
  }
  report.liveResources = children.size;
  writeFileSync(join(EVIDENCE, "report.json"), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ provider, noFold, evidence: EVIDENCE, assertions: report.assertions, cleanup, error: report.error }, null, 2));
if (failure) process.exitCode = 1;
