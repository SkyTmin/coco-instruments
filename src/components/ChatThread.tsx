import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { NoteMarkdown } from '@/components/NoteMarkdown';
import { NotePicker } from '@/components/NotePicker';
import { Sheet } from '@/components/ui';
import { useCrop } from '@/components/CropProvider';
import { IconCheck, IconHash, IconImage, IconLink, IconPaperclip, IconPencil, IconPlus, IconSend, IconTrash } from '@/components/icons';
import type { Note, NoteAttachment, NoteMessage } from '@/types';
import {
  attachmentHref,
  fileToAttachment,
  formatBytes,
  MAX_ATTACHMENT_SIZE,
  MAX_ATTACHMENTS,
  MAX_IMAGE_SOURCE_SIZE,
} from '@/lib/images';
import { toggleTaskInBody } from '@/lib/notes-markdown';
import { notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';

const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

interface Props {
  messages: NoteMessage[];
  notes: Note[];
  /** Pinned content shown above the first message (relations, info, …). */
  header?: ReactNode;
  emptyTitle?: string;
  placeholder?: string;
  onSend: (text: string, attachments: NoteAttachment[]) => void;
  onEditMessage: (id: string, text: string, attachments: NoteAttachment[]) => void;
  onDeleteMessage: (id: string) => void;
  onOpenNote: (id: string) => void;
  onOpenMissing: (title: string) => void;
  onTag: (tag: string) => void;
}

export function ChatThread({
  messages,
  notes,
  header,
  emptyTitle,
  placeholder,
  onSend,
  onEditMessage,
  onDeleteMessage,
  onOpenNote,
  onOpenMissing,
  onTag,
}: Props) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<NoteAttachment[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [menuMsg, setMenuMsg] = useState<NoteMessage | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [linkPicker, setLinkPicker] = useState(false);

  const endRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const caretRef = useRef<number | null>(null);
  const cropImages = useCrop();

  // Keep the latest message in view as the thread grows or on first paint.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  // Follow the visual viewport so the composer stays above the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => document.documentElement.style.setProperty('--chat-vh', `${vv.height}px`);
    apply();
    vv.addEventListener('resize', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      document.documentElement.style.removeProperty('--chat-vh');
    };
  }, []);

  // Auto-grow the composer + restore caret after a programmatic insert.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(150, Math.max(22, el.scrollHeight))}px`;
    if (caretRef.current !== null) {
      el.focus();
      el.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
  }, [draft]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    const picked = await cropImages(Array.from(files));
    if (!picked.length) return;
    const next = [...pending];
    for (const file of picked) {
      if (next.length >= MAX_ATTACHMENTS) {
        setError(`Максимум ${MAX_ATTACHMENTS} вложений в сообщении`);
        notifyWarning();
        break;
      }
      try {
        next.push(await fileToAttachment(file));
      } catch {
        const limit = file.type.startsWith('image/') ? MAX_IMAGE_SOURCE_SIZE : MAX_ATTACHMENT_SIZE;
        setError(`${file.name}: больше ${formatBytes(limit)} или не сжалось`);
        notifyWarning();
      }
    }
    setPending(next);
    selectionChanged();
  };

  const insert = (snippet: string) => {
    const el = textRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    caretRef.current = start + snippet.length;
    setDraft(draft.slice(0, start) + snippet + draft.slice(end));
    selectionChanged();
  };

  const resetComposer = () => {
    setDraft('');
    setPending([]);
    setEditingId(null);
    setError('');
  };

  const send = () => {
    const text = draft.trim();
    if (!text && !pending.length) return;
    if (editingId) onEditMessage(editingId, text, pending);
    else onSend(text, pending);
    tapLight();
    resetComposer();
  };

  const startEdit = (m: NoteMessage) => {
    setMenuMsg(null);
    setEditingId(m.id);
    setDraft(m.text);
    setPending(m.attachments ?? []);
    selectionChanged();
    window.setTimeout(() => textRef.current?.focus(), 0);
  };

  const removeMessage = (m: NoteMessage) => {
    setMenuMsg(null);
    if (editingId === m.id) resetComposer();
    onDeleteMessage(m.id);
  };

  const toggleTask = (m: NoteMessage, index: number) => {
    selectionChanged();
    onEditMessage(m.id, toggleTaskInBody(m.text, index), m.attachments ?? []);
  };

  // Long-press a bubble → actions; swallow the click that would otherwise fire.
  const press = useRef<{ id: string; x: number; y: number; fired: boolean } | null>(null);
  const longPressTimer = useRef(0);
  const onBubbleDown = (m: NoteMessage, e: ReactPointerEvent) => {
    press.current = { id: m.id, x: e.clientX, y: e.clientY, fired: false };
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      if (press.current) {
        press.current.fired = true;
        setMenuMsg(m);
        selectionChanged();
      }
    }, 450);
  };
  const onBubbleMove = (e: ReactPointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) {
      window.clearTimeout(longPressTimer.current);
      press.current = null;
    }
  };
  const onBubbleUp = () => window.clearTimeout(longPressTimer.current);
  const onBubbleClickCapture = (e: ReactMouseEvent) => {
    if (press.current?.fired) {
      e.preventDefault();
      e.stopPropagation();
    }
    press.current = null;
  };

  return (
    <>
      <div className="chat-scroll">
        {header}
        {!messages.length && (
          <div className="chat-empty">
            <div className="chat-empty__icon">💭</div>
            <div className="chat-empty__title">{emptyTitle ?? 'Ваше пространство для мыслей'}</div>
            <div className="chat-empty__hint">
              Пишите как в личном чате с собой — мысль за мыслью. Внизу: <b>＋</b> добавит фото, тег, связь
              или задачу, <b>➤</b> отправит.
            </div>
          </div>
        )}
        {messages.map((m) => {
          const images = (m.attachments ?? []).filter((a) => a.type.startsWith('image/'));
          const filesOnly = (m.attachments ?? []).filter((a) => !a.type.startsWith('image/'));
          return (
            <div
              key={m.id}
              className="chat-bubble"
              onPointerDown={(e) => onBubbleDown(m, e)}
              onPointerMove={onBubbleMove}
              onPointerUp={onBubbleUp}
              onPointerCancel={onBubbleUp}
              onClickCapture={onBubbleClickCapture}
            >
              {images.length > 0 && (
                <div className={`chat-photos chat-photos--${Math.min(images.length, 3)}`}>
                  {images.map((a) => (
                    <img
                      key={a.id}
                      src={attachmentHref(a)}
                      alt={a.name}
                      loading="lazy"
                      onClick={() => setLightbox(attachmentHref(a) || null)}
                    />
                  ))}
                </div>
              )}
              {filesOnly.map((a) => (
                <a key={a.id} className="chat-file" href={attachmentHref(a)} download={a.name}>
                  <IconPaperclip size={18} />
                  <span className="chat-file__name">{a.name}</span>
                  <span className="chat-file__size">{formatBytes(a.size)}</span>
                </a>
              ))}
              {m.text.trim() && (
                <div className="chat-bubble__text">
                  <NoteMarkdown
                    body={m.text}
                    notes={notes}
                    attachments={m.attachments ?? []}
                    onOpenNote={onOpenNote}
                    onOpenMissing={onOpenMissing}
                    onTag={onTag}
                    onToggleTask={(index) => toggleTask(m, index)}
                  />
                </div>
              )}
              <div className="chat-bubble__time">
                {m.editedAt ? 'изм. · ' : ''}
                {timeFmt.format(new Date(m.createdAt))}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="chat-input">
        {editingId && (
          <div className="chat-editing">
            <IconPencil size={15} /> Редактирование мысли
            <button className="chat-editing__cancel" onClick={resetComposer} aria-label="Отменить">
              ×
            </button>
          </div>
        )}
        {error && <div className="notes-error">{error}</div>}
        {pending.length > 0 && (
          <div className="chat-pending">
            {pending.map((a) => (
              <div key={a.id} className={`chat-pending__item${a.type.startsWith('image/') ? '' : ' is-file'}`}>
                {a.type.startsWith('image/') ? <img src={attachmentHref(a)} alt={a.name} /> : <IconPaperclip size={18} />}
                <button onClick={() => setPending((p) => p.filter((x) => x.id !== a.id))} aria-label="Убрать">
                  <IconTrash size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="chat-input__row">
          <button className="chat-plus" onClick={() => { tapLight(); setShowActions(true); }} aria-label="Добавить фото, тег, связь">
            <IconPlus size={22} />
          </button>
          <textarea
            ref={textRef}
            className="chat-text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder ?? 'Новая мысль…'}
            rows={1}
          />
          <button className="chat-send" onClick={send} disabled={!draft.trim() && !pending.length} aria-label="Отправить">
            <IconSend size={20} />
          </button>
        </div>
        <input
          ref={imageRef}
          hidden
          type="file"
          accept="image/*"
          multiple
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={fileRef}
          hidden
          type="file"
          multiple
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* "＋" quick actions — discoverable instead of cryptic syntax. */}
      {showActions && (
        <Sheet title="Добавить" onClose={() => setShowActions(false)}>
          <div className="chat-actions">
            <button onClick={() => { setShowActions(false); imageRef.current?.click(); }}>
              <span className="chat-actions__ic"><IconImage size={20} /></span> Фото
            </button>
            <button onClick={() => { setShowActions(false); fileRef.current?.click(); }}>
              <span className="chat-actions__ic"><IconPaperclip size={20} /></span> Файл
            </button>
            <button onClick={() => { setShowActions(false); setLinkPicker(true); }}>
              <span className="chat-actions__ic"><IconLink size={20} /></span> Связать с заметкой
            </button>
            <button onClick={() => { setShowActions(false); insert('#'); }}>
              <span className="chat-actions__ic"><IconHash size={20} /></span> Добавить тег
            </button>
            <button onClick={() => { setShowActions(false); insert('- [ ] '); }}>
              <span className="chat-actions__ic"><IconCheck size={20} /></span> Задача
            </button>
          </div>
        </Sheet>
      )}

      {linkPicker && (
        <NotePicker
          notes={notes}
          onClose={() => setLinkPicker(false)}
          onPick={(n) => {
            insert(`[[${n.title}]] `);
            setLinkPicker(false);
          }}
        />
      )}

      {menuMsg && (
        <Sheet title="Мысль" onClose={() => setMenuMsg(null)}>
          <div className="stack">
            <button className="btn btn--ghost btn--block" onClick={() => startEdit(menuMsg)}>
              <IconPencil size={17} /> Изменить
            </button>
            <button className="btn btn--danger btn--block" onClick={() => removeMessage(menuMsg)}>
              <IconTrash size={17} /> Удалить
            </button>
          </div>
        </Sheet>
      )}

      {lightbox && (
        <div className="chat-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </>
  );
}
