import { describe, expect, it } from 'vitest';
import { deriveFromMessages, makeMessage, materializeMessages } from './notes-messages';

const img = {
  id: 'a1',
  name: 'p.jpg',
  type: 'image/jpeg',
  size: 10,
  url: '/uploads/p.jpg',
  createdAt: 0,
};

describe('notes messages', () => {
  it('migrates a legacy body + attachments into one message (image tokens stripped)', () => {
    const msgs = materializeMessages({
      body: 'Привет #тег\n\n![p](/uploads/p.jpg)',
      attachments: [img],
      createdAt: 5,
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe('Привет #тег');
    expect(msgs[0].attachments).toEqual([img]);
    expect(msgs[0].createdAt).toBe(5);
  });

  it('returns existing messages untouched', () => {
    const m = makeMessage('hi', []);
    expect(materializeMessages({ messages: [m], body: 'ignored', createdAt: 0 })).toEqual([m]);
  });

  it('is empty for an empty source', () => {
    expect(materializeMessages({ body: '', attachments: [], createdAt: 0 })).toEqual([]);
  });

  it('derives the combined body and flat attachments from messages', () => {
    const messages = [makeMessage('первое #t', [img]), makeMessage('второе [[L]]', [])];
    const d = deriveFromMessages(messages);
    expect(d.body).toBe('первое #t\n\nвторое [[L]]');
    expect(d.attachments).toEqual([img]);
  });
});
