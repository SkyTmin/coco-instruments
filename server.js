import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

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
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const REMINDERS_FILE =
  process.env.REMINDERS_FILE || path.join(path.dirname(UPLOAD_DIR), 'reminders.json');

/** Validate Telegram initData (HMAC-SHA256). Returns the user object or null. */
function validateInitData(raw, token) {
  if (!raw || !token) return null;
  try {
    const params = new URLSearchParams(raw);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    params.delete('signature');
    const dataCheckString = [...params.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (calc !== hash) return null;
    const userRaw = params.get('user');
    return userRaw ? JSON.parse(userRaw) : null;
  } catch {
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

app.post('/api/reminders/sync', (req, res) => {
  const { initData, tzOffset, prefs, payments } = req.body ?? {};
  const user = validateInitData(initData, BOT_TOKEN);
  if (!user || !user.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const uid = String(user.id);
  const prev = reminders[uid] || {};
  reminders[uid] = {
    chatId: user.id,
    tzOffset: Number(tzOffset) || 0,
    prefs: {
      enabled: !!(prefs && prefs.enabled),
      leadDays: Math.max(0, Math.min(30, Math.round((prefs && prefs.leadDays) || 0))),
      hour: Math.max(0, Math.min(23, Math.round((prefs && prefs.hour) ?? 9))),
      minute: Math.max(0, Math.min(59, Math.round((prefs && prefs.minute) || 0))),
    },
    payments: Array.isArray(payments)
      ? payments.slice(0, 300).map((p) => ({
          key: String(p.key),
          name: String(p.name || '').slice(0, 100),
          date: String(p.date),
          amount: Number(p.amount) || 0,
        }))
      : [],
    sent: prev.sent || {},
    updatedAt: Date.now(),
  };
  saveReminders();
  res.json({ ok: true });
});

app.post('/api/reminders/test', async (req, res) => {
  const user = validateInitData(req.body?.initData, BOT_TOKEN);
  if (!user || !user.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const r = await sendTelegram(
    user.id,
    '🔔 Тест: напоминания о платежах подключены. Так будет приходить уведомление.',
  );
  res.json(r);
});

const ymd = (d) => d.toISOString().slice(0, 10);
const addDaysISO = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};
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

async function checkReminders() {
  const todayUTC = ymd(new Date());
  for (const uid of Object.keys(reminders)) {
    const u = reminders[uid];
    if (!u?.prefs?.enabled || !Array.isArray(u.payments) || !u.payments.length) continue;
    const localNow = new Date(Date.now() + (u.tzOffset || 0) * 60000);
    const localDate = ymd(localNow);
    const localMinutes = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
    if (localMinutes < u.prefs.hour * 60 + u.prefs.minute) continue; // not time yet today
    u.sent = u.sent || {};
    for (const p of u.payments) {
      if (addDaysISO(p.date, -u.prefs.leadDays) !== localDate) continue;
      if (u.sent[p.key]) continue;
      const when =
        u.prefs.leadDays === 0 ? 'сегодня' : u.prefs.leadDays === 1 ? 'завтра' : `через ${u.prefs.leadDays} дн.`;
      const amount = new Intl.NumberFormat('ru-RU').format(Math.round(p.amount));
      const text = `🔔 Платёж ${when}: <b>${escapeHtml(p.name)}</b> — ${amount} ₽ (${formatRuDate(p.date)})`;
      // eslint-disable-next-line no-await-in-loop
      const r = await sendTelegram(u.chatId, text);
      if (r.ok) {
        u.sent[p.key] = p.date;
        saveReminders();
      }
    }
    // prune sent keys for dates older than 3 days
    for (const k of Object.keys(u.sent)) {
      if (u.sent[k] < addDaysISO(todayUTC, -3)) delete u.sent[k];
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
