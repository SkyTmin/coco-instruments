import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { validate as validateInitDataSig } from '@telegram-apps/init-data-node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const PUBLIC_UPLOAD_PATH = '/uploads';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 3 * 1024 * 1024);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Per-user app-data store (reliable persistence). Lives next to uploads so it
// survives deploys (the app checkout is reset, /var/lib/coco is not).
const STORE_DIR = process.env.STORE_DIR || path.join(path.dirname(UPLOAD_DIR), 'store');
const MAX_STORE_BYTES = Number(process.env.MAX_STORE_BYTES || 2 * 1024 * 1024);
fs.mkdirSync(STORE_DIR, { recursive: true });

// Everything worth keeping lives under DATA_ROOT (/var/lib/coco) — that's what
// the backups archive and restore.sh restores.
const DATA_ROOT = path.dirname(UPLOAD_DIR);
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_ROOT, 'backups');
const ADMIN_FILE = path.join(DATA_ROOT, 'admin.json');
const LOG_FILE = path.join(DATA_ROOT, 'errors.log');
const MAX_LOG_BYTES = 256 * 1024;
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Atomic file write (temp + rename) so a crash mid-write can't corrupt data.
function writeFileAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function writeJsonAtomic(file, obj) {
  writeFileAtomic(file, JSON.stringify(obj));
}

// Append a line to the rotating error log (kept small; rides along in backups).
function appendLog(line) {
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
    const size = fs.statSync(LOG_FILE).size;
    if (size > MAX_LOG_BYTES * 2) {
      const buf = fs.readFileSync(LOG_FILE);
      writeFileAtomic(LOG_FILE, buf.subarray(buf.length - MAX_LOG_BYTES));
    }
  } catch {
    /* logging must never throw */
  }
}

// Tiny in-memory rate limiter (per key, sliding window).
const rateBuckets = new Map();
function rateLimit(keyId, max, windowMs) {
  const now = Date.now();
  const hits = (rateBuckets.get(keyId) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  rateBuckets.set(keyId, hits);
  return hits.length <= max;
}

// The backup recipient: a configured admin chat id, or the first person to send
// /backup to the bot (it's a personal bot — first come claims it).
function getAdminChatId() {
  const env = (process.env.ADMIN_CHAT_ID || '').trim();
  if (env) return env;
  try {
    return String(JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')).chatId || '') || null;
  } catch {
    return null;
  }
}
function setAdminChatId(chatId) {
  try {
    writeJsonAtomic(ADMIN_FILE, { chatId: String(chatId), at: Date.now() });
  } catch {
    /* non-fatal */
  }
}

app.use(express.json({ limit: '8mb' }));

function safeName(name = 'file') {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || 'file';
}

function extensionFromType(type = '') {
  if (type === 'image/jpeg') return '.jpg';
  if (type === 'image/png') return '.png';
  if (type === 'image/webp') return '.webp';
  if (type === 'image/gif') return '.gif';
  if (type === 'application/pdf') return '.pdf';
  return '';
}

app.post('/api/notes/attachments', (req, res) => {
  const { initData, name, type, dataUrl } = req.body ?? {};
  const user = authReminder(initData, res);
  if (!user) return;
  if (!rateLimit(`upload:${user.id}`, 60, 60_000)) {
    res.status(429).json({ error: 'rate_limited' });
    return;
  }
  if (typeof name !== 'string' || typeof dataUrl !== 'string') {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }

  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match?.[2]) {
    res.status(400).json({ error: 'expected_base64_data_url' });
    return;
  }

  const contentType = typeof type === 'string' && type ? type : match[1] || 'application/octet-stream';
  const buffer = Buffer.from(match[3], 'base64');
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
    res.status(413).json({ error: 'file_too_large', maxBytes: MAX_UPLOAD_BYTES });
    return;
  }

  const ext = path.extname(name) || extensionFromType(contentType);
  const id = crypto.randomUUID();
  const fileName = `${id}-${safeName(path.basename(name, ext))}${ext}`;
  writeFileAtomic(path.join(UPLOAD_DIR, fileName), buffer);

  res.json({
    id,
    name,
    type: contentType,
    size: buffer.length,
    url: `${PUBLIC_UPLOAD_PATH}/${fileName}`,
  });
});

app.use(PUBLIC_UPLOAD_PATH, express.static(UPLOAD_DIR, {
  immutable: true,
  maxAge: '365d',
}));

// ---------------------------------------------------------------------------
// Payment reminders. The Mini App syncs its upcoming payments + preferences
// here; a 1-minute scheduler messages the user via the bot at the chosen time.
// Requires BOT_TOKEN in the environment (set by deploy/setup.sh).
// ---------------------------------------------------------------------------
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const REMINDERS_FILE =
  process.env.REMINDERS_FILE || path.join(path.dirname(UPLOAD_DIR), 'reminders.json');
const WEBHOOK_SECRET = BOT_TOKEN
  ? crypto.createHash('sha256').update(BOT_TOKEN).digest('hex').slice(0, 48)
  : '';
const RELAY_SECRET = BOT_TOKEN
  ? crypto.createHash('sha256').update(`relay:${BOT_TOKEN}`).digest('hex').slice(0, 48)
  : '';
// Secret for the localhost backup trigger (used by the systemd timer).
const BACKUP_SECRET = BOT_TOKEN
  ? crypto.createHash('sha256').update(`backup:${BOT_TOKEN}`).digest('hex').slice(0, 48)
  : '';
// Optional GitHub token (fine-grained PAT, Actions: read+write) so the VPS can
// trigger the delivery workflow on demand — GitHub's own `schedule` is too slow.
const GH_TOKEN = (process.env.GH_DISPATCH_TOKEN || '').trim();
const GH_REPO = process.env.GH_REPO || 'SkyTmin/coco-instruments';
const GH_REF = process.env.GH_REF || 'prod';
let lastDispatch = 0;
let lastDispatchInfo = null;

/**
 * Authenticate a reminder request using Telegram's official validator (handles
 * the hash + signature correctly). Sets a specific error and returns null on failure.
 */
function authReminder(raw, res) {
  if (!BOT_TOKEN) {
    res.status(503).json({ error: 'server_no_token' });
    return null;
  }
  try {
    validateInitDataSig(raw, BOT_TOKEN, { expiresIn: 0 });
  } catch (e) {
    res.status(401).json({ error: 'bad_init_data', detail: String(e?.message || e).slice(0, 120) });
    return null;
  }
  try {
    const user = JSON.parse(new URLSearchParams(raw).get('user') || 'null');
    if (!user || !user.id) {
      res.status(401).json({ error: 'no_user' });
      return null;
    }
    return user;
  } catch {
    res.status(401).json({ error: 'no_user' });
    return null;
  }
}

let reminders = {};
try {
  reminders = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
} catch {
  reminders = {};
}
let remSaveTimer = null;
function saveReminders() {
  clearTimeout(remSaveTimer);
  remSaveTimer = setTimeout(() => {
    try {
      writeJsonAtomic(REMINDERS_FILE, reminders);
    } catch (e) {
      console.error('reminders save failed', e);
    }
  }, 500);
}

async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN) return { ok: false, error: 'no_token' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, error: j.description };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function sendDocument(chatId, filePath, caption) {
  if (!BOT_TOKEN) return { ok: false, error: 'no_token' };
  try {
    const data = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption);
    form.append('document', new Blob([data]), path.basename(filePath));
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, error: j.description };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ---- Backups: archive all data, keep a rotated copy, deliver to the admin ----
function createBackupArchive() {
  return new Promise((resolve, reject) => {
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const out = path.join(BACKUP_DIR, `coco-backup-${ts}.tar.gz`);
    const entries = ['store', 'uploads', 'reminders.json', 'admin.json', 'errors.log'].filter((e) =>
      fs.existsSync(path.join(DATA_ROOT, e)),
    );
    if (!entries.length) return reject(new Error('nothing-to-backup'));
    const tar = spawn('tar', ['-czf', out, '-C', DATA_ROOT, ...entries]);
    tar.on('error', reject);
    tar.on('close', (code) => {
      if (code !== 0) return reject(new Error(`tar-exit-${code}`));
      try {
        fs.copyFileSync(out, path.join(BACKUP_DIR, 'latest.tar.gz')); // stable name for fetching
      } catch {
        /* non-fatal */
      }
      resolve(out);
    });
  });
}

function pruneBackups(keep = 14) {
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('coco-backup-') && f.endsWith('.tar.gz'))
      .sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
    }
  } catch {
    /* non-fatal */
  }
}

let lastBackupAt = 0;
async function runBackup(deliverTo) {
  let archive;
  try {
    archive = await createBackupArchive();
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
  pruneBackups();
  lastBackupAt = Date.now();
  const sizeMb = (fs.statSync(archive).size / 1048576).toFixed(2);
  if (!deliverTo) return { ok: true, archive, size: sizeMb, sent: false };
  const sent = await sendDocument(
    deliverTo,
    archive,
    `🗄 Резервная копия Coco · ${sizeMb} МБ · ${new Date().toLocaleString('ru-RU')}\n` +
      `Перенос на новый сервер: положи файл рядом и запусти deploy/restore.sh <файл>.`,
  );
  return { ok: true, archive, size: sizeMb, sent: sent.ok, deliverError: sent.error };
}

/** Ask GitHub Actions to run the delivery workflow now (throttled to once / 90s). */
async function triggerRelay() {
  if (!GH_TOKEN) {
    lastDispatchInfo = { ok: false, error: 'no_gh_token', at: new Date().toISOString() };
    return lastDispatchInfo;
  }
  const now = Date.now();
  if (now - lastDispatch < 90_000) return { ok: true, throttled: true };
  lastDispatch = now;
  try {
    const r = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/reminders.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'coco-reminders',
        },
        body: JSON.stringify({ ref: GH_REF }),
      },
    );
    let detail;
    if (r.status !== 204) {
      detail = (await r.text().catch(() => '')).slice(0, 200);
      lastDispatch = 0; // let it retry sooner on failure
    }
    lastDispatchInfo = { ok: r.status === 204, status: r.status, detail, at: new Date().toISOString() };
    return lastDispatchInfo;
  } catch (e) {
    lastDispatch = 0;
    lastDispatchInfo = { ok: false, error: String(e).slice(0, 200), at: new Date().toISOString() };
    return lastDispatchInfo;
  }
}

// Ask GitHub Actions to make + deliver a backup now (the runner can reach
// Telegram even when the VPS can't). Throttled.
let lastBackupDispatch = 0;
async function triggerBackup() {
  if (!GH_TOKEN) return { ok: false, error: 'no_gh_token' };
  const now = Date.now();
  if (now - lastBackupDispatch < 30_000) return { ok: true, throttled: true };
  lastBackupDispatch = now;
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/backup.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'coco-backup',
      },
      body: JSON.stringify({ ref: GH_REF }),
    });
    if (r.status !== 204) {
      lastBackupDispatch = 0;
      return { ok: false, status: r.status, detail: (await r.text().catch(() => '')).slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    lastBackupDispatch = 0;
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

// The app sends reminders as ABSOLUTE fire timestamps (computed on the device
// in its local/Moscow time), so the server needs no timezone math.
app.post('/api/reminders/sync', (req, res) => {
  const { initData, reminders: items } = req.body ?? {};
  const user = authReminder(initData, res);
  if (!user) return;
  const uid = String(user.id);
  const prev = reminders[uid] || {};
  reminders[uid] = {
    chatId: user.id,
    items: Array.isArray(items)
      ? items.slice(0, 300).map((p) => ({
          key: String(p.key),
          name: String(p.name || '').slice(0, 100),
          amount: Number(p.amount) || 0,
          dueDate: String(p.dueDate || ''),
          fireAt: Number(p.fireAt) || 0,
        }))
      : [],
    testItems: prev.testItems || [], // preserved across syncs (used by the test button)
    sent: prev.sent || {},
    claimed: prev.claimed || {},
    updatedAt: Date.now(),
  };
  saveReminders();
  res.json({ ok: true });
});

app.post('/api/reminders/test', async (req, res) => {
  const user = authReminder(req.body?.initData, res);
  if (!user) return;
  const text = '🔔 Тест: напоминания подключены. Так будет приходить уведомление о платеже.';
  // Try sending directly from the VPS first (instant if it can reach Telegram).
  const direct = await sendTelegram(user.id, text);
  if (direct.ok) {
    res.json({ ok: true });
    return;
  }
  // Otherwise queue it for the GitHub Actions relay (which can reach Telegram).
  const uid = String(user.id);
  const u = reminders[uid] || { chatId: user.id, items: [], testItems: [], sent: {}, claimed: {} };
  u.chatId = user.id;
  u.testItems = (u.testItems || []).slice(-4);
  u.testItems.push({ key: `test:${Date.now()}`, text, fireAt: Date.now() - 1000 });
  reminders[uid] = u;
  saveReminders();
  const relay = await triggerRelay(); // poke GitHub to deliver within ~1 min
  res.json({ ok: true, queued: true, dispatched: relay.ok, directError: direct.error });
});

// Diagnostics (no secrets): shows whether the bot token reached the server and
// how many users have synced reminders. Open in a browser to check.
app.get('/api/reminders/health', (req, res) => {
  res.json({
    ok: true,
    hasToken: !!BOT_TOKEN,
    hasWebhookSecret: !!WEBHOOK_SECRET,
    hasDispatchToken: !!GH_TOKEN,
    lastDispatch: lastDispatchInfo,
    users: Object.keys(reminders).length,
    serverTime: new Date().toISOString(),
  });
});

// Telegram webhook → greet on /start (and any message). Sending this reply also
// confirms the user is reachable, so scheduled reminders can be delivered.
// One-time tokens for serving a backup archive to Telegram by URL (the VPS often
// can't reach Telegram outbound, so we answer the webhook with a method and let
// Telegram FETCH the file from our public domain).
const backupTokens = new Map();
function publicBase(req) {
  return process.env.PUBLIC_URL || `https://${req.get('host')}`;
}

app.post('/api/bot/webhook', async (req, res) => {
  if (WEBHOOK_SECRET && req.get('X-Telegram-Bot-Api-Secret-Token') !== WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }
  const msg = req.body?.message;
  const chatId = msg?.chat?.id;
  const text = String(msg?.text || '').trim();
  if (!chatId) return res.sendStatus(200);

  // Reply by returning the method in the webhook response — works even when the
  // VPS can't open outbound connections to api.telegram.org.
  const reply = (t) =>
    res.json({ method: 'sendMessage', chat_id: chatId, text: t, parse_mode: 'HTML', disable_web_page_preview: true });

  if (/^\/id\b/.test(text)) {
    return reply(`Ваш chat id: <b>${chatId}</b>`);
  }

  if (/^\/backup\b/.test(text)) {
    let admin = getAdminChatId();
    if (!admin) {
      setAdminChatId(chatId); // personal bot: the first /backup claims the owner
      admin = String(chatId);
    }
    if (String(admin) !== String(chatId)) {
      return reply('Бэкапы доступны только администратору бота.');
    }
    try {
      const archive = await createBackupArchive();
      pruneBackups();
      const token = crypto.randomBytes(24).toString('hex');
      backupTokens.set(token, { file: archive, exp: Date.now() + 10 * 60_000 });
      const sizeMb = (fs.statSync(archive).size / 1048576).toFixed(2);
      return res.json({
        method: 'sendDocument',
        chat_id: chatId,
        document: `${publicBase(req)}/api/backup/file/${token}`,
        caption: `🗄 Резервная копия Coco · ${sizeMb} МБ · ${new Date().toLocaleString('ru-RU')}`,
      });
    } catch (e) {
      return reply(`Не удалось сделать бэкап (${escapeHtml(String(e?.message || e))}).`);
    }
  }

  return reply(
    'Привет! 👋 Это <b>Coco</b>. Открой приложение кнопкой меню (слева от поля ввода) — ' +
      'и я буду напоминать тебе о платежах прямо здесь.\n\n' +
      'Команды: /backup — прислать резервную копию, /id — узнать свой chat id.',
  );
});

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const formatRuDate = (iso) => {
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  } catch {
    return iso;
  }
};
const whenLabel = (dueDate) => {
  if (!dueDate) return '';
  const days = Math.ceil((Date.parse(`${dueDate}T00:00:00Z`) - Date.now()) / 86400000);
  if (days <= 0) return ' сегодня';
  if (days === 1) return ' завтра';
  if (days >= 2 && days <= 4) return ` через ${days} дня`;
  return ` через ${days} дн.`;
};
const buildText = (p) => {
  const amount = new Intl.NumberFormat('ru-RU').format(Math.round(p.amount));
  const datePart = p.dueDate ? ` (${formatRuDate(p.dueDate)})` : '';
  return `🔔 Платёж${whenLabel(p.dueDate)}: <b>${escapeHtml(p.name)}</b> — ${amount} ₽${datePart}`;
};

/** Due, not-yet-sent reminders across all users. Skips items claimed in the last 10 min. */
function dueItemsFor(now, claim) {
  const out = [];
  for (const uid of Object.keys(reminders)) {
    const u = reminders[uid];
    if (!u) continue;
    u.sent = u.sent || {};
    u.claimed = u.claimed || {};
    const all = [...(u.items || []), ...(u.testItems || [])];
    for (const p of all) {
      if (!p.fireAt || p.fireAt > now || now - p.fireAt > 2 * 86400000) continue;
      if (u.sent[p.key]) continue;
      if (u.claimed[p.key] && now - u.claimed[p.key] < 10 * 60000) continue;
      if (claim) u.claimed[p.key] = now;
      out.push({ uid, chatId: u.chatId, key: p.key, text: p.text || buildText(p) });
    }
  }
  return out;
}

// GitHub Actions pulls due reminders and sends them from a non-RU runner
// (Russian servers often can't reach api.telegram.org directly).
app.post('/api/reminders/drain', (req, res) => {
  if (!RELAY_SECRET || req.get('X-Relay-Secret') !== RELAY_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const items = dueItemsFor(Date.now(), true).slice(0, 100);
  if (items.length) saveReminders();
  res.json({ items });
});

app.post('/api/reminders/ack', (req, res) => {
  if (!RELAY_SECRET || req.get('X-Relay-Secret') !== RELAY_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
  const now = Date.now();
  for (const uid of Object.keys(reminders)) {
    const u = reminders[uid];
    if (!u) continue;
    u.sent = u.sent || {};
    for (const k of keys) {
      if (u.claimed && u.claimed[k]) {
        u.sent[k] = now;
        delete u.claimed[k];
      }
    }
    for (const k of Object.keys(u.sent)) if (now - u.sent[k] > 7 * 86400000) delete u.sent[k];
  }
  saveReminders();
  res.json({ ok: true });
});

// Fallback: also try to send directly from the VPS (works if it can reach Telegram).
async function checkReminders() {
  const now = Date.now();
  const due = dueItemsFor(now, false);
  if (!due.length) return;
  // Preferred: have GitHub deliver (the VPS usually can't reach Telegram).
  if (GH_TOKEN) {
    await triggerRelay();
    return;
  }
  // Fallback: send directly (works only if the VPS can reach api.telegram.org).
  for (const item of due) {
    // eslint-disable-next-line no-await-in-loop
    const r = await sendTelegram(item.chatId, item.text);
    if (r.ok) {
      const u = reminders[item.uid];
      if (u) {
        u.sent = u.sent || {};
        u.sent[item.key] = now;
        saveReminders();
      }
    }
  }
}

if (BOT_TOKEN) {
  setInterval(() => checkReminders().catch((e) => console.error('reminders tick', e)), 60_000);
  console.log('Reminders scheduler active');
} else {
  console.log('Reminders disabled (no BOT_TOKEN set)');
}

// ---------------------------------------------------------------------------
// Per-user key-value store — reliable persistence for the app's data. The Mini
// App writes here so nothing is lost when Telegram CloudStorage is unavailable
// or the webview wipes localStorage. Authenticated by Telegram initData; each
// user can only read/write their own folder.
// ---------------------------------------------------------------------------
function storeKeyName(key) {
  return String(key || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);
}
function userStoreDir(userId) {
  const safe = String(userId).replace(/[^0-9]/g, '').slice(0, 32) || '0';
  return path.join(STORE_DIR, safe);
}

app.post('/api/store/get', (req, res) => {
  const { initData, keys } = req.body ?? {};
  const user = authReminder(initData, res);
  if (!user) return;
  const dir = userStoreDir(user.id);
  const values = {};
  if (Array.isArray(keys)) {
    for (const key of keys.slice(0, 64)) {
      try {
        values[key] = JSON.parse(fs.readFileSync(path.join(dir, storeKeyName(key) + '.json'), 'utf8'));
      } catch {
        values[key] = null;
      }
    }
  }
  res.json({ ok: true, values });
});

app.post('/api/store/set', (req, res) => {
  const { initData, key, value } = req.body ?? {};
  const user = authReminder(initData, res);
  if (!user) return;
  if (!key) return res.status(400).json({ error: 'no_key' });
  const str = JSON.stringify(value ?? null);
  if (str.length > MAX_STORE_BYTES) return res.status(413).json({ error: 'too_large' });
  const dir = userStoreDir(user.id);
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomic(path.join(dir, storeKeyName(key) + '.json'), str);
  } catch {
    return res.status(500).json({ error: 'write_failed' });
  }
  res.json({ ok: true });
});

app.post('/api/store/remove', (req, res) => {
  const { initData, key } = req.body ?? {};
  const user = authReminder(initData, res);
  if (!user) return;
  try {
    fs.unlinkSync(path.join(userStoreDir(user.id), storeKeyName(key) + '.json'));
  } catch {
    /* already gone */
  }
  res.json({ ok: true });
});

// Localhost backup trigger (called by the systemd daily timer). Protected by a
// secret derived from BOT_TOKEN so it can't be hit through the public proxy.
app.post('/api/backup/run', async (req, res) => {
  if (!BACKUP_SECRET || req.get('X-Backup-Secret') !== BACKUP_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const result = await runBackup(getAdminChatId());
  res.json(result);
});

// The app asks for a backup here (reliable: app → VPS always works). It records
// the requesting user as the backup recipient and kicks the GitHub runner, which
// makes the archive on the VPS and delivers it to that user in Telegram.
app.post('/api/backup/request', async (req, res) => {
  const user = authReminder(req.body?.initData, res);
  if (!user) return;
  setAdminChatId(user.id);
  const dispatched = await triggerBackup();
  res.json({ ok: true, dispatched: dispatched.ok, error: dispatched.error });
});

// Is this user the backup owner? (Used to show the backup control only to the
// owner.) True for the configured admin, or for anyone while none is set yet.
app.post('/api/backup/status', (req, res) => {
  const user = authReminder(req.body?.initData, res);
  if (!user) return;
  const admin = getAdminChatId();
  res.json({ owner: !admin || String(admin) === String(user.id), configured: !!admin });
});

// Client error reports → rotating errors.log (ships in backups). Rate-limited.
app.post('/api/log', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(`log:${ip}`, 40, 60_000)) return res.sendStatus(429);
  const { message, stack, url, kind, initData } = req.body ?? {};
  let uid = '';
  if (initData && BOT_TOKEN) {
    try {
      validateInitDataSig(initData, BOT_TOKEN, { expiresIn: 0 });
      uid = String(JSON.parse(new URLSearchParams(initData).get('user') || 'null')?.id || '');
    } catch {
      /* unauthenticated report — still logged */
    }
  }
  appendLog(
    JSON.stringify({
      t: new Date().toISOString(),
      kind: String(kind || 'error').slice(0, 24),
      uid,
      url: String(url || '').slice(0, 200),
      msg: String(message || '').slice(0, 400),
      stack: String(stack || '').slice(0, 1200),
    }),
  );
  res.json({ ok: true });
});

// Telegram fetches a freshly-made backup here via a single-use, short-lived
// token (handed to it in the /backup webhook reply). Random token + 10-min TTL.
app.get('/api/backup/file/:token', (req, res) => {
  const entry = backupTokens.get(req.params.token);
  if (!entry || entry.exp < Date.now() || !fs.existsSync(entry.file)) {
    return res.sendStatus(404);
  }
  res.download(entry.file, path.basename(entry.file));
});

// Serve the built Vite app (run `npm run build` first to produce dist/).
const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir));

// SPA fallback: any non-asset route returns index.html so client-side routing works.
app.get('*', (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
