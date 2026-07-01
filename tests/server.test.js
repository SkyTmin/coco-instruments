import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { sign } from '@telegram-apps/init-data-node';

const BOT_TOKEN = '12345:TEST_TOKEN';
const USER_ID = 99;

let app;
let dataRoot;

const initDataFor = (id = USER_ID) =>
  sign({ user: { id, first_name: 'Test' } }, BOT_TOKEN, new Date());

// A 1x1 transparent PNG.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

beforeAll(async () => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-test-'));
  process.env.UPLOAD_DIR = path.join(dataRoot, 'uploads');
  process.env.STORE_DIR = path.join(dataRoot, 'store');
  process.env.BACKUP_DIR = path.join(dataRoot, 'backups');
  process.env.REMINDERS_FILE = path.join(dataRoot, 'reminders.json');
  process.env.BOT_TOKEN = BOT_TOKEN;
  process.env.MAX_UPLOAD_BYTES = '2048';
  process.env.MAX_STORE_BYTES = '2048';
  // Config is read at module top level, so env must be set before this import.
  ({ app } = await import('../app.js'));
});

describe('auth', () => {
  it('rejects requests with bad initData', async () => {
    const res = await request(app)
      .post('/api/store/get')
      .send({ initData: 'user=%7B%22id%22%3A1%7D&hash=deadbeef', keys: ['a'] });
    expect(res.status).toBe(401);
  });

  it('rejects requests without initData', async () => {
    const res = await request(app).post('/api/store/set').send({ key: 'a', value: 1 });
    expect(res.status).toBe(401);
  });

  it('rejects stale initData older than the max age (replay defense)', async () => {
    const stale = sign(
      { user: { id: USER_ID, first_name: 'Test' } },
      BOT_TOKEN,
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    );
    const res = await request(app)
      .post('/api/store/get')
      .send({ initData: stale, keys: ['a'] });
    expect(res.status).toBe(401);
  });
});

describe('backup ownership', () => {
  const adminFile = () => path.join(dataRoot, 'admin.json');
  const clearAdmin = () => {
    try {
      fs.unlinkSync(adminFile());
    } catch {
      /* ignore */
    }
  };

  it('refuses backup requests when no owner is configured', async () => {
    clearAdmin();
    const res = await request(app)
      .post('/api/backup/request')
      .send({ initData: initDataFor(USER_ID) });
    expect(res.status).toBe(409);
    // The request must NOT have claimed ownership as a side effect.
    expect(fs.existsSync(adminFile())).toBe(false);
  });

  it('refuses backup requests from a non-owner', async () => {
    fs.writeFileSync(adminFile(), JSON.stringify({ chatId: '123456', at: Date.now() }));
    const res = await request(app)
      .post('/api/backup/request')
      .send({ initData: initDataFor(USER_ID) });
    expect(res.status).toBe(403);
    clearAdmin();
  });

  it('reports owner=false for a non-owner and true for the owner', async () => {
    fs.writeFileSync(adminFile(), JSON.stringify({ chatId: String(USER_ID), at: Date.now() }));
    const owner = await request(app)
      .post('/api/backup/status')
      .send({ initData: initDataFor(USER_ID) });
    expect(owner.body).toEqual({ owner: true, configured: true });

    const other = await request(app)
      .post('/api/backup/status')
      .send({ initData: initDataFor(4242) });
    expect(other.body).toEqual({ owner: false, configured: true });
    clearAdmin();
  });
});

describe('store', () => {
  it('set / get / remove roundtrip', async () => {
    const initData = initDataFor();
    const value = { hello: 'мир', n: 42 };

    const set = await request(app)
      .post('/api/store/set')
      .send({ initData, key: 'test-key', value });
    expect(set.status).toBe(200);
    expect(set.body.ok).toBe(true);

    const get = await request(app)
      .post('/api/store/get')
      .send({ initData, keys: ['test-key', 'missing'] });
    expect(get.status).toBe(200);
    expect(get.body.values['test-key']).toEqual(value);
    expect(get.body.values.missing).toBeNull();

    const rm = await request(app).post('/api/store/remove').send({ initData, key: 'test-key' });
    expect(rm.status).toBe(200);

    const after = await request(app)
      .post('/api/store/get')
      .send({ initData, keys: ['test-key'] });
    expect(after.body.values['test-key']).toBeNull();
  });

  it('rejects values over MAX_STORE_BYTES', async () => {
    const res = await request(app)
      .post('/api/store/set')
      .send({ initData: initDataFor(), value: 'x'.repeat(4096), key: 'big' });
    expect(res.status).toBe(413);
  });

  it('sanitizes keys so they cannot escape the user dir', async () => {
    const initData = initDataFor();
    const res = await request(app)
      .post('/api/store/set')
      .send({ initData, key: '../../escape', value: 1 });
    expect(res.status).toBe(200);

    const userDir = path.join(process.env.STORE_DIR, String(USER_ID));
    const files = fs.readdirSync(userDir);
    expect(files.some((f) => f.includes('escape'))).toBe(true);
    // Nothing written outside the store root.
    expect(fs.existsSync(path.join(dataRoot, 'escape.json'))).toBe(false);

    const get = await request(app)
      .post('/api/store/get')
      .send({ initData, keys: ['../../escape'] });
    expect(get.body.values['../../escape']).toBe(1);
  });
});

describe('attachments', () => {
  it('stores a small base64 upload', async () => {
    const res = await request(app)
      .post('/api/notes/attachments')
      .send({
        initData: initDataFor(),
        name: 'pic.png',
        type: 'image/png',
        dataUrl: `data:image/png;base64,${TINY_PNG_B64}`,
      });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/uploads\/.+\.png$/);
    const stored = path.join(process.env.UPLOAD_DIR, path.basename(res.body.url));
    expect(fs.existsSync(stored)).toBe(true);
  });

  it('rejects non-base64 data urls', async () => {
    const res = await request(app).post('/api/notes/attachments').send({
      initData: initDataFor(),
      name: 'x.txt',
      dataUrl: 'data:text/plain,hello',
    });
    expect(res.status).toBe(400);
  });

  it('rejects uploads over MAX_UPLOAD_BYTES', async () => {
    const big = Buffer.alloc(4096, 1).toString('base64');
    const res = await request(app)
      .post('/api/notes/attachments')
      .send({
        initData: initDataFor(),
        name: 'big.png',
        type: 'image/png',
        dataUrl: `data:image/png;base64,${big}`,
      });
    expect(res.status).toBe(413);
  });

  it('rejects non-image types (blocks html/svg → stored XSS)', async () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream']) {
      const res = await request(app)
        .post('/api/notes/attachments')
        .send({
          initData: initDataFor(),
          name: 'evil.html',
          type,
          dataUrl: `data:${type};base64,${TINY_PNG_B64}`,
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unsupported_type');
    }
  });

  it('stores under an image extension regardless of the filename', async () => {
    const res = await request(app)
      .post('/api/notes/attachments')
      .send({
        initData: initDataFor(),
        name: 'x.html', // attacker-chosen extension must be ignored
        type: 'image/png',
        dataUrl: `data:image/png;base64,${TINY_PNG_B64}`,
      });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/\.png$/);
    expect(res.body.url).not.toMatch(/\.html/);
  });
});

describe('reminders', () => {
  it('syncs items and clamps fields', async () => {
    const res = await request(app)
      .post('/api/reminders/sync')
      .send({
        initData: initDataFor(),
        reminders: [
          { key: 'p1', name: 'n'.repeat(300), amount: '150', dueDate: '2026-07-01', fireAt: 1 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects drain without the relay secret', async () => {
    const res = await request(app).post('/api/reminders/drain').send({});
    expect(res.status).toBe(401);
  });

  it('rejects ack without the relay secret', async () => {
    const res = await request(app)
      .post('/api/reminders/ack')
      .send({ keys: ['p1'] });
    expect(res.status).toBe(401);
  });

  it('reports health', async () => {
    const res = await request(app).get('/api/reminders/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.hasToken).toBe(true);
  });
});

describe('hardening', () => {
  it('serves /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.uptime).toBe('number');
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-security-policy']).toContain('frame-ancestors');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('rejects webhook calls without the secret header', async () => {
    const res = await request(app)
      .post('/api/bot/webhook')
      .send({ message: { chat: { id: 1 }, text: '/id' } });
    expect(res.status).toBe(401);
  });

  it('rate-limits store writes', async () => {
    const initData = initDataFor(777);
    let limited = false;
    for (let i = 0; i < 130; i++) {
      const res = await request(app).post('/api/store/set').send({ initData, key: 'rl', value: i });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
