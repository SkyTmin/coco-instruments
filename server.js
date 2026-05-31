import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { validate as validateInitDataSig } from '@telegram-apps/init-data-node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const PUBLIC_UPLOAD_PATH = '/uploads';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 3 * 1024 * 1024);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
  const { name, type, dataUrl } = req.body ?? {};
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
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);

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
      fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders));
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
    sent: prev.sent || {},
    updatedAt: Date.now(),
  };
  saveReminders();
  res.json({ ok: true });
});

app.post('/api/reminders/test', async (req, res) => {
  const user = authReminder(req.body?.initData, res);
  if (!user) return;
  const r = await sendTelegram(
    user.id,
    '🔔 Тест: напоминания о платежах подключены. Так будет приходить уведомление.',
  );
  res.json(r);
});

// Diagnostics (no secrets): shows whether the bot token reached the server and
// how many users have synced reminders. Open in a browser to check.
app.get('/api/reminders/health', (req, res) => {
  res.json({
    ok: true,
    hasToken: !!BOT_TOKEN,
    hasWebhookSecret: !!WEBHOOK_SECRET,
    users: Object.keys(reminders).length,
    serverTime: new Date().toISOString(),
  });
});

// Telegram webhook → greet on /start (and any message). Sending this reply also
// confirms the user is reachable, so scheduled reminders can be delivered.
app.post('/api/bot/webhook', (req, res) => {
  if (WEBHOOK_SECRET && req.get('X-Telegram-Bot-Api-Secret-Token') !== WEBHOOK_SECRET) {
    res.sendStatus(401);
    return;
  }
  const chatId = req.body?.message?.chat?.id;
  if (chatId) {
    void sendTelegram(
      chatId,
      'Привет! 👋 Это <b>Coco</b>. Открой приложение кнопкой меню (слева от поля ввода) — ' +
        'и я буду напоминать тебе о платежах прямо здесь.',
    );
  }
  res.sendStatus(200);
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
    if (!u || !Array.isArray(u.items)) continue;
    u.sent = u.sent || {};
    u.claimed = u.claimed || {};
    for (const p of u.items) {
      if (!p.fireAt || p.fireAt > now || now - p.fireAt > 2 * 86400000) continue;
      if (u.sent[p.key]) continue;
      if (u.claimed[p.key] && now - u.claimed[p.key] < 10 * 60000) continue;
      if (claim) u.claimed[p.key] = now;
      out.push({ uid, chatId: u.chatId, key: p.key, text: buildText(p) });
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
  for (const item of dueItemsFor(now, false)) {
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
