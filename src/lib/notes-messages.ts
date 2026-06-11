import type { NoteAttachment, NoteCard, NoteMessage } from '@/types';
import { genId } from '@/lib/id';
import { stripImageTokens } from '@/lib/notes-markdown';

/** A note or tag page as a content source for chat messages. */
interface MessageSource {
  messages?: NoteMessage[];
  body?: string;
  attachments?: NoteAttachment[];
  createdAt: number;
}

/** Messages for a note/tag page. Legacy items (only `body`/`attachments`) are
 *  migrated into a single first message — non-destructively, on read. */
export function materializeMessages(src: MessageSource): NoteMessage[] {
  if (src.messages && src.messages.length) return src.messages;
  const text = stripImageTokens(src.body ?? '');
  const attachments = src.attachments ?? [];
  if (!text && !attachments.length) return [];
  return [{ id: genId(), text, attachments, createdAt: src.createdAt }];
}

/** The legacy fields kept in sync with messages: a combined text body (for tag
 *  and wiki-link parsing / the graph) and a flat list of every photo/file. */
export function deriveFromMessages(messages: NoteMessage[]): {
  body: string;
  attachments: NoteAttachment[];
} {
  const body = messages
    .map((m) => {
      const cardText = m.card
        ? [m.card.front.text, m.card.back.text].filter(Boolean).join('\n')
        : '';
      return [m.text.trim(), cardText.trim()].filter(Boolean).join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
  const attachments = messages.flatMap((m) => [
    ...(m.attachments ?? []),
    ...(m.card
      ? [m.card.front.photo, m.card.back.photo].filter((p): p is NoteAttachment => !!p)
      : []),
  ]);
  return { body, attachments };
}

/** Extra payload for a new message (reply / flip-card). */
export interface MessageExtra {
  replyToId?: string;
  card?: NoteCard;
}

export function makeMessage(
  text: string,
  attachments: NoteAttachment[],
  extra?: MessageExtra,
): NoteMessage {
  return {
    id: genId(),
    text: text.trim(),
    attachments,
    createdAt: Date.now(),
    ...(extra?.replyToId ? { replyToId: extra.replyToId } : {}),
    ...(extra?.card ? { card: extra.card } : {}),
  };
}

/** A one-line preview of a message — for the pinned bar and reply quotes. */
export function messageSnippet(m: NoteMessage, max = 70): string {
  const text =
    m.text.trim() ||
    m.card?.front.text?.trim() ||
    m.card?.back.text?.trim() ||
    (m.card ? '🃏 Карточка' : '') ||
    ((m.attachments ?? []).some((a) => a.type.startsWith('image/')) ? '📷 Фото' : '') ||
    ((m.attachments ?? []).length ? '📎 Файл' : '') ||
    'Сообщение';
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
