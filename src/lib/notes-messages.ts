import type { NoteAttachment, NoteMessage } from '@/types';
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
    .map((m) => m.text.trim())
    .filter(Boolean)
    .join('\n\n');
  const attachments = messages.flatMap((m) => m.attachments ?? []);
  return { body, attachments };
}

export function makeMessage(text: string, attachments: NoteAttachment[]): NoteMessage {
  return { id: genId(), text: text.trim(), attachments, createdAt: Date.now() };
}
