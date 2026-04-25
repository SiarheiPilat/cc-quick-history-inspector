import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// SSE clients
const sseClients = new Set();
function sseBroadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch {}
  }
}

let watchDebounce = null;
function scheduleChange(filename) {
  clearTimeout(watchDebounce);
  watchDebounce = setTimeout(() => sseBroadcast('change', { file: filename, ts: Date.now() }), 250);
}

function startWatchers(projectsDir, plansDir) {
  try {
    fs.watch(projectsDir, { recursive: true }, (_e, filename) => {
      if (filename && filename.endsWith('.jsonl')) scheduleChange(filename);
    });
    console.log('watching:', projectsDir);
  } catch (e) { console.warn('cannot watch projects dir:', e.message); }
  try {
    fs.watch(plansDir, { recursive: false }, (_e, filename) => {
      if (filename && filename.endsWith('.md')) scheduleChange(filename);
    });
    console.log('watching:', plansDir);
  } catch (e) { console.warn('cannot watch plans dir:', e.message); }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5757;
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const PLANS_DIR = path.join(CLAUDE_DIR, 'plans');

async function loadPlans() {
  const map = new Map(); // slug -> { file, mtime, content }
  let entries = [];
  try { entries = await fsp.readdir(PLANS_DIR); } catch { return map; }
  await Promise.all(entries.map(async (f) => {
    if (!f.endsWith('.md')) return;
    const full = path.join(PLANS_DIR, f);
    try {
      const st = await fsp.stat(full);
      const slug = f.replace(/\.md$/, '');
      map.set(slug, { file: full, mtime: st.mtimeMs, slug });
    } catch {}
  }));
  return map;
}

async function readPlanContent(slug) {
  const p = path.join(PLANS_DIR, slug + '.md');
  try { return await fsp.readFile(p, 'utf8'); } catch { return null; }
}

function parseLine(line) {
  if (!line || line[0] !== '{') return null;
  try { return JSON.parse(line); } catch { return null; }
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = [];
    for (const c of content) {
      if (c && c.type === 'text' && typeof c.text === 'string') texts.push(c.text);
    }
    return texts.join('\n');
  }
  return '';
}

function summarizeToolInput(name, input) {
  if (!input || typeof input !== 'object') return '';
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return (input.description ? input.description + ' — ' : '') + (input.command || '').replace(/\s+/g, ' ').slice(0, 160);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return input.file_path || input.path || '';
    case 'Glob':
      return input.pattern || '';
    case 'Grep':
      return (input.pattern || '') + (input.path ? ' in ' + input.path : '');
    case 'WebFetch':
      return input.url || '';
    case 'WebSearch':
      return input.query || '';
    case 'Skill':
      return input.skill || '';
    case 'Agent':
    case 'Task':
      return input.description || input.subagent_type || '';
    case 'TodoWrite':
      return Array.isArray(input.todos) ? input.todos.length + ' todos' : '';
    default: {
      // best-effort: pick first short string field
      for (const k of Object.keys(input)) {
        const v = input[k];
        if (typeof v === 'string' && v.length < 200) return v;
      }
      return '';
    }
  }
}

function extractToolUses(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const c of content) {
    if (c && c.type === 'tool_use' && c.name) {
      out.push({ name: c.name, summary: summarizeToolInput(c.name, c.input) });
    }
  }
  return out;
}

const NOISE_TAGS = [
  'system-reminder', 'command-name', 'command-message', 'command-args',
  'local-command-stdout', 'local-command-stderr', 'local-command-caveat',
  'task-notification', 'user-prompt-submit-hook',
];

function cleanUserText(text) {
  if (typeof text !== 'string') return '';
  let t = text;
  for (const tag of NOISE_TAGS) {
    const re = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'g');
    t = t.replace(re, '');
  }
  // also strip leading "Caveat:" line blocks
  t = t.replace(/^Caveat: The messages below were generated[\s\S]*?(\n\n|$)/m, '');
  return t.trim();
}

async function loadSession(filePath, plansMap) {
  let raw;
  try { raw = await fsp.readFile(filePath, 'utf8'); } catch { return null; }
  const lines = raw.split(/\r?\n/);
  const messages = [];
  let meta = { sessionId: null, cwd: null, slug: null, started: null, ended: null, version: null };
  for (const line of lines) {
    const obj = parseLine(line);
    if (!obj) continue;
    if (obj.sessionId && !meta.sessionId) meta.sessionId = obj.sessionId;
    if (obj.cwd) meta.cwd = obj.cwd;
    if (obj.slug) meta.slug = obj.slug;
    if (obj.version) meta.version = obj.version;
    if (obj.timestamp) {
      if (!meta.started || obj.timestamp < meta.started) meta.started = obj.timestamp;
      if (!meta.ended || obj.timestamp > meta.ended) meta.ended = obj.timestamp;
    }
    if (obj.type === 'user' && obj.message && obj.message.role === 'user') {
      // skip pure tool_result wrappers
      if (Array.isArray(obj.message.content) && obj.message.content.every(c => c && c.type === 'tool_result')) continue;
      const raw = extractText(obj.message.content);
      const cleaned = cleanUserText(raw);
      const kind = cleaned ? 'user' : 'noise';
      messages.push({
        kind,
        ts: obj.timestamp,
        text: cleaned || raw.trim().slice(0, 400),
        uuid: obj.uuid,
        permissionMode: obj.permissionMode || null,
      });
    } else if (obj.type === 'assistant' && obj.message && obj.message.role === 'assistant') {
      const text = extractText(obj.message.content).trim();
      const tools = extractToolUses(obj.message.content);
      if (!text && tools.length === 0) continue;
      messages.push({
        kind: 'assistant',
        ts: obj.timestamp,
        text,
        tools,
        uuid: obj.uuid,
      });
    }
  }
  if (messages.length === 0 && !meta.slug) return null;
  const plan = meta.slug && plansMap.has(meta.slug) ? plansMap.get(meta.slug) : null;
  messages.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  const firstUser = messages.find(m => m.kind === 'user');
  const userCount = messages.filter(m => m.kind === 'user').length;
  return {
    id: meta.sessionId || path.basename(filePath, '.jsonl'),
    file: filePath,
    cwd: meta.cwd,
    slug: meta.slug,
    started: meta.started,
    ended: meta.ended,
    version: meta.version,
    messageCount: userCount,
    firstPrompt: (firstUser?.text || '').slice(0, 200),
    messages,
    hasPlan: !!plan,
    planMtime: plan ? new Date(plan.mtime).toISOString() : null,
  };
}

async function loadAll() {
  const plansMap = await loadPlans();
  let projects = [];
  let projectDirs = [];
  try { projectDirs = await fsp.readdir(PROJECTS_DIR); } catch { return { projects: [], plansLoose: [] }; }

  await Promise.all(projectDirs.map(async (proj) => {
    const projPath = path.join(PROJECTS_DIR, proj);
    let stat; try { stat = await fsp.stat(projPath); } catch { return; }
    if (!stat.isDirectory()) return;
    let files = [];
    try { files = await fsp.readdir(projPath); } catch { return; }
    const sessions = [];
    await Promise.all(files.map(async (f) => {
      if (!f.endsWith('.jsonl')) return;
      const s = await loadSession(path.join(projPath, f), plansMap);
      if (s) sessions.push(s);
    }));
    sessions.sort((a, b) => (b.ended || '').localeCompare(a.ended || ''));
    if (sessions.length === 0) return;
    const cwdName = sessions.find(s => s.cwd)?.cwd;
    projects.push({
      key: proj,
      name: cwdName || prettyProjectName(proj),
      sessions,
      latest: sessions[0]?.ended || null,
    });
  }));

  projects.sort((a, b) => (b.latest || '').localeCompare(a.latest || ''));

  // plans not bound to any session in this scan
  const usedSlugs = new Set();
  for (const p of projects) for (const s of p.sessions) if (s.slug) usedSlugs.add(s.slug);
  const plansLoose = [...plansMap.values()].filter(p => !usedSlugs.has(p.slug))
    .map(p => ({ slug: p.slug, mtime: p.mtime }));

  return { projects, plansLoose };
}

function prettyProjectName(key) {
  // best-effort: replace -- with : and - with /
  // keys look like "C--GitHub-QOL-projects-foo"
  return key.replace(/^C--/, 'C:/').replace(/-/g, '/').replace(/\/\//g, '-');
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/') {
      const html = await fsp.readFile(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (url.pathname === '/api/data') {
      const data = await loadAll();
      send(res, 200, data);
      return;
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      res.write('event: hello\ndata: {}\n\n');
      sseClients.add(res);
      const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
      req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
      return;
    }
    if (url.pathname === '/api/plan') {
      const slug = url.searchParams.get('slug');
      if (!slug || /[\\/]/.test(slug)) return send(res, 400, { error: 'bad slug' });
      const content = await readPlanContent(slug);
      if (content == null) return send(res, 404, { error: 'not found' });
      send(res, 200, { slug, content });
      return;
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`cc-quick-history-inspector → http://localhost:${PORT}`);
  console.log(`scanning: ${PROJECTS_DIR}`);
  startWatchers(PROJECTS_DIR, PLANS_DIR);
});
