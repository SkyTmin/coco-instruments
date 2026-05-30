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
