import { describe, expect, it } from 'vitest';
import {
  deriveFromMessages,
  makeMessage,
  materializeMessages,
  messageSnippet,
} from './notes-messages';

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

describe('chat 2.0 messages', () => {
  it('keeps reply and card via makeMessage extra', () => {
    const card = { front: { text: 'A' }, back: { text: 'B' } };
    const m = makeMessage('', [], { replyToId: 'r1', card });
    expect(m.replyToId).toBe('r1');
    expect(m.card).toEqual(card);
  });

  it('derives card text into the body (for tags/links/graph)', () => {
    const m = makeMessage('', [], {
      card: { front: { text: 'лицо #тема' }, back: { text: 'оборот [[Связь]]' } },
    });
    const d = deriveFromMessages([m]);
    expect(d.body).toContain('лицо #тема');
    expect(d.body).toContain('оборот [[Связь]]');
  });

  it('derives card photos into the flat attachments', () => {
    const m = makeMessage('', [], { card: { front: { photo: img }, back: {} } });
    expect(deriveFromMessages([m]).attachments).toEqual([img]);
  });

  it('builds a one-line snippet for text, cards and photos', () => {
    expect(messageSnippet(makeMessage('многострочный\nтекст', []))).toBe('многострочный текст');
    expect(messageSnippet(makeMessage('', [], { card: { front: {}, back: {} } }))).toBe(
      '🃏 Карточка',
    );
    expect(messageSnippet(makeMessage('', [img]))).toBe('📷 Фото');
    expect(messageSnippet(makeMessage('х'.repeat(100), []))).toHaveLength(70);
  });
});
