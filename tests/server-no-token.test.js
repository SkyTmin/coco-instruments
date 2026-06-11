// Separate file: app config is read at import time, so the no-BOT_TOKEN case
// needs its own import with its own environment.
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

let app;

beforeAll(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-test-notoken-'));
  process.env.UPLOAD_DIR = path.join(dataRoot, 'uploads');
  process.env.STORE_DIR = path.join(dataRoot, 'store');
  process.env.BACKUP_DIR = path.join(dataRoot, 'backups');
  process.env.REMINDERS_FILE = path.join(dataRoot, 'reminders.json');
  delete process.env.BOT_TOKEN;
  ({ app } = await import('../app.js'));
});

describe('without BOT_TOKEN', () => {
  it('refuses webhook updates instead of accepting them unauthenticated', async () => {
    const res = await request(app)
      .post('/api/bot/webhook')
      .send({ message: { chat: { id: 1 }, text: '/backup' } });
    expect(res.status).toBe(503);
  });

  it('store endpoints respond 503 (no token to authenticate against)', async () => {
    const res = await request(app)
      .post('/api/store/get')
      .send({ initData: 'x', keys: ['a'] });
    expect(res.status).toBe(503);
  });
});
