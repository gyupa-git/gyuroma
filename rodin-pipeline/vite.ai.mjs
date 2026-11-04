// Local Claude for the GYUROMA dev/preview server (plain JS: no node typings needed).
// The app's AI features ask the claude CLI on this computer (the owner's own login), one
// round trip per question, pictures attached to the question itself.
//   GET  /__rodin/ai/status -> {"available": true|false}
//   POST /__rodin/ai/ask    -> body {stable, stableImages[], images[], text, schema}
//                              answer {ok: true, result, usage} | {ok: false, error}
// stable / stableImages are what stays the same across a conversation (model pictures,
// rules): they go first with a 1-hour cache mark, so a follow-up question reads them from
// the cache instead of paying for them again.  RODIN_CLAUDE overrides the executable
// (a fake for tests).
import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// An empty folder outside the Desktop tree: the CLI loads any CLAUDE.md it finds in its
// working folder (and above), which would add thousands of tokens to every call.  Always
// the same folder, or the cached system prompt is never reused.
const CLI_HOME = path.join(os.homedir(), ".cache", "rodin-pipeline", "cli");
const LOG_FILE = path.join(os.homedir(), ".cache", "rodin-pipeline", "ai-usage.jsonl");
const MODEL = process.env.RODIN_AI_MODEL || "opus";
const MAX_BODY = 24 * 1024 * 1024;
const MAX_IMAGES = 12;
const TIMEOUT_MS = 5 * 60 * 1000;

function findClaude() {
  const override = process.env.RODIN_CLAUDE;
  if (override) return existsSync(override) ? override : null;
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of dirs) {
    const candidate = path.join(dir, "claude");
    if (dir && existsSync(candidate)) return candidate;
  }
  for (const candidate of [path.join(os.homedir(), ".local/bin/claude"), path.join(os.homedir(), ".claude/local/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function imageBlock(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) return null;
  return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
}

/** The first balanced {...} in the answer (code fences and stray words around it are ignored). */
function extractJson(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("JSON 이 없습니다");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        // Raw line breaks inside long strings would break JSON.parse.
        const slice = text.slice(start, i + 1).replace(/"(?:[^"\\]|\\.)*"/g, (s) => s.replace(/\n/g, "\\n").replace(/\r/g, ""));
        return JSON.parse(slice);
      }
    }
  }
  throw new Error("JSON 이 닫히지 않았습니다");
}

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("요청이 너무 큽니다");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function logUsage(entry) {
  try {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.appendFile(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // a missing log is no reason to fail the answer
  }
}

function humanError(text) {
  const low = text.toLowerCase();
  if (/not logged in|log in|authenticate|oauth|login/.test(low)) return "Claude 로그인이 풀렸어요 — 터미널에서 claude 를 켜고 /login 한 뒤 다시 눌러 주세요.";
  if (/session limit|usage limit|rate limit/.test(low)) return "Claude 사용 한도에 걸렸어요 — 한도가 풀린 뒤 다시 눌러 주세요.";
  return `AI 호출이 실패했어요: ${text.trim().slice(-300)}`;
}

async function ask(req, res) {
  const exe = findClaude();
  if (!exe) return sendJson(res, 200, { ok: false, error: "이 컴퓨터에서 claude 를 찾지 못했어요." });
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: String(err && err.message ? err.message : err) });
  }
  const stableImages = (Array.isArray(body.stableImages) ? body.stableImages : []).map(imageBlock).filter(Boolean);
  const images = (Array.isArray(body.images) ? body.images : []).map(imageBlock).filter(Boolean);
  if (stableImages.length + images.length > MAX_IMAGES) return sendJson(res, 400, { ok: false, error: "사진이 너무 많습니다" });
  const text = String(body.text || "");
  if (!text.trim()) return sendJson(res, 400, { ok: false, error: "질문이 비었습니다" });
  const schema = body.schema && typeof body.schema === "object" ? body.schema : null;

  // Same-every-time part first, marked for the 1-hour cache (one mark only: the CLI adds
  // three of its own and the API takes four; and only "1h" — a 5-minute mark before the
  // CLI's 1-hour ones is refused).
  const content = [...stableImages];
  if (body.stable) content.push({ type: "text", text: String(body.stable), cache_control: { type: "ephemeral", ttl: "1h" } });
  content.push(...images);
  content.push({
    type: "text",
    text: schema
      ? `${text}\n\n★ 출력 형식 (엄수)\n아래 스키마에 맞는 JSON 객체 하나만 출력한다. 인사·설명·코드펜스 금지. 첫 글자 { 마지막 글자 }.\n스키마:\n${JSON.stringify(schema)}`
      : text,
  });

  await fs.mkdir(CLI_HOME, { recursive: true });
  const args = [
    "-p", "--model", MODEL, "--tools", "", "--no-session-persistence",
    "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--strict-mcp-config", "--setting-sources", "user", "--no-chrome", "--disable-slash-commands",
    "--exclude-dynamic-system-prompt-sections",
  ];
  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ""}:${path.dirname(exe)}`,
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
  };
  const started = Date.now();
  const child = spawn(exe, args, { cwd: CLI_HOME, env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  let finished = false;
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (err += chunk));
  // The page went away (stop button, reload): stop the CLI too.
  res.on("close", () => {
    if (!finished) child.kill("SIGTERM");
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
  child.stdin.end(JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n");
  const code = await new Promise((resolve) => child.on("close", resolve));
  finished = true;
  clearTimeout(timer);
  if (res.writableEnded || res.destroyed) return;

  let result = null;
  for (const line of out.split("\n")) {
    if (!line.startsWith("{") || !line.includes('"result"')) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "result") result = event;
    } catch {
      // not an event line
    }
  }
  const usage = (result && result.usage) || {};
  void logUsage({
    at: new Date(started).toISOString(),
    tag: String(body.tag || ""),
    images: stableImages.length + images.length,
    sec: Math.round((Date.now() - started) / 100) / 10,
    in: usage.input_tokens || 0,
    cw: usage.cache_creation_input_tokens || 0,
    cr: usage.cache_read_input_tokens || 0,
    out: usage.output_tokens || 0,
    usd: result ? result.total_cost_usd : null,
    ok: Boolean(result && !result.is_error),
  });
  const answer = (result && result.result) || "";
  if (Date.now() - started >= TIMEOUT_MS) return sendJson(res, 200, { ok: false, error: "AI 가 너무 오래 답을 안 해서 멈췄어요." });
  if (!result || result.is_error || code) return sendJson(res, 200, { ok: false, error: humanError(`${err} ${answer}`) });
  if (!schema) return sendJson(res, 200, { ok: true, result: answer, usage });
  try {
    return sendJson(res, 200, { ok: true, result: extractJson(answer), usage });
  } catch (parseError) {
    // Keep what came back, so a broken answer can be looked at.
    const raw = path.join(path.dirname(LOG_FILE), `raw-${started}.txt`);
    await fs.writeFile(raw, answer).catch(() => undefined);
    return sendJson(res, 200, { ok: false, error: `AI 답을 읽지 못했어요 (${parseError.message}) — 원문: ${raw}` });
  }
}

/** Handles /__rodin/ai/*; returns false for any other address. */
export async function handleAi(req, res) {
  const url = req.url ?? "";
  if (url === "/__rodin/ai/status" && req.method === "GET") {
    sendJson(res, 200, { available: Boolean(findClaude()), model: MODEL });
    return true;
  }
  if (url === "/__rodin/ai/ask" && req.method === "POST") {
    await ask(req, res);
    return true;
  }
  return false;
}
