import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import { NoteMarkdown } from '@/components/NoteMarkdown';
import { NotePicker } from '@/components/NotePicker';
import { showToast } from '@/components/Toast';
import { ConfirmDialog, Sheet } from '@/components/ui';
import { useCrop } from '@/components/CropProvider';
import {
  IconCheck,
  IconCopy,
  IconHash,
  IconImage,
  IconLink,
  IconPaperclip,
  IconPencil,
  IconPin,
  IconPlus,
  IconReply,
  IconSend,
  IconSwap,
  IconTrash,
} from '@/components/icons';
import type { Note, NoteAttachment, NoteCard, NoteCardSide, NoteMessage } from '@/types';
import {
  attachmentHref,
  fileToAttachment,
  formatBytes,
  MAX_ATTACHMENT_SIZE,
  MAX_ATTACHMENTS,
  MAX_IMAGE_SOURCE_SIZE,
} from '@/lib/images';
import { toggleTaskInBody } from '@/lib/notes-markdown';
import type { MessageExtra } from '@/lib/notes-messages';
import { messageSnippet } from '@/lib/notes-messages';
import { registerEscape } from '@/lib/escape-stack';
import { notifySuccess, notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';

const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const dayFmtYear = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Telegram-like day separator label: Сегодня / Вчера / 3 июня / 3 июня 2025. */
function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  return d.getFullYear() === now.getFullYear() ? dayFmt.format(d) : dayFmtYear.format(d);
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/** Copy text to the clipboard (with a fallback for older webviews). */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const cardSideEmpty = (s: NoteCardSide) => !s.photo && !(s.text ?? '').trim();

// On desktop (mouse/trackpad) Enter sends and Shift+Enter adds a newline, like
// every messenger. On touch keyboards Enter keeps making newlines.
const ENTER_SENDS =
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

interface Props {
  messages: NoteMessage[];
  notes: Note[];
  /** Pinned content shown above the first message (relations, info, …). */
  header?: ReactNode;
  emptyTitle?: string;
  placeholder?: string;
  onSend: (text: string, attachments: NoteAttachment[], extra?: MessageExtra) => void;
  onEditMessage: (
    id: string,
    text: string,
    attachments: NoteAttachment[],
    extra?: MessageExtra,
  ) => void;
  onDeleteMessage: (id: string) => void;
  /** Batch delete (multi-select). Falls back to per-message delete if absent. */
  onDeleteMessages?: (ids: string[]) => void;
  onTogglePin?: (id: string, pinned: boolean) => void;
  /** Builds the copyable [[msg:…]] link for a message (null until possible). */
  messageLink?: (m: NoteMessage) => string | null;
  /** Scroll to this message on mount / when it changes (deep link). */
  focusMessageId?: string | null;
  onOpenNote: (id: string) => void;
  onOpenMissing: (title: string) => void;
  onTag: (tag: string) => void;
  onOpenMessage?: (kind: 'n' | 't', ref: string, messageId: string) => void;
}

interface MenuState {
  msg: NoteMessage;
  rect: { top: number; left: number; width: number; height: number; right: number };
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
  onDeleteMessages,
  onTogglePin,
  messageLink,
  focusMessageId,
  onOpenNote,
  onOpenMissing,
  onTag,
  onOpenMessage,
}: Props) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<NoteAttachment[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<NoteMessage | null>(null);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [linkPicker, setLinkPicker] = useState(false);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<NoteMessage | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  // Natural aspect ratio of each card's photo (front wins) — sizes the card
  // like Telegram sizes photos: tall photo → tall card, wide → wide.
  const [cardARs, setCardARs] = useState<Map<string, number>>(new Map());
  const [cardEditor, setCardEditor] = useState<{ id?: string; card: NoteCard } | null>(null);
  const [pinIndex, setPinIndex] = useState(0);
  // The bubble being long-pressed right now — gets a playful squeeze.
  const [pressingId, setPressingId] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const caretRef = useRef<number | null>(null);
  const highlightTimer = useRef(0);
  const cropImages = useCrop();

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const pinnedMsgs = useMemo(() => messages.filter((m) => m.pinned), [messages]);

  // Keep the latest message in view as the thread grows or on first paint —
  // unless we arrived via a deep link to a specific message.
  const skipAutoScroll = useRef(!!focusMessageId);
  useEffect(() => {
    if (skipAutoScroll.current) {
      skipAutoScroll.current = false;
      return;
    }
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const scrollToMessage = (id: string) => {
    const el = scrollRef.current?.querySelector(`[data-mid="${id}"]`);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightId(id);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightId(null), 1700);
    return true;
  };

  // Deep link: scroll to & flash the target message once it's rendered.
  const lastFocused = useRef<string | null>(null);
  useEffect(() => {
    if (!focusMessageId || lastFocused.current === focusMessageId) return;
    if (!byId.has(focusMessageId)) return;
    lastFocused.current = focusMessageId;
    const t = window.setTimeout(() => scrollToMessage(focusMessageId), 80);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId, byId]);

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

  // Overlays close on Esc / Telegram back, newest first.
  useEffect(() => {
    if (!lightbox) return;
    return registerEscape(() => setLightbox(null));
  }, [lightbox]);
  useEffect(() => {
    if (!menu) return;
    return registerEscape(() => setMenu(null));
  }, [menu]);
  useEffect(() => {
    if (!selected) return;
    return registerEscape(() => setSelected(null));
  }, [selected]);

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
    setReplyTo(null);
    setError('');
  };

  const send = () => {
    const text = draft.trim();
    if (!text && !pending.length) return;
    if (editingId) onEditMessage(editingId, text, pending);
    else onSend(text, pending, replyTo ? { replyToId: replyTo.id } : undefined);
    tapLight();
    resetComposer();
  };

  const startEdit = (m: NoteMessage) => {
    setMenu(null);
    if (m.card) {
      setCardEditor({ id: m.id, card: m.card });
      return;
    }
    setEditingId(m.id);
    setReplyTo(null);
    setDraft(m.text);
    setPending(m.attachments ?? []);
    selectionChanged();
    window.setTimeout(() => textRef.current?.focus(), 0);
  };

  const startReply = (m: NoteMessage) => {
    setMenu(null);
    setEditingId(null);
    setReplyTo(m);
    selectionChanged();
    window.setTimeout(() => textRef.current?.focus(), 0);
  };

  // Deleting always asks first (single via the menu, bulk via the select bar).
  const askRemoveMessage = (m: NoteMessage) => {
    setMenu(null);
    setConfirmDelete(m);
  };

  const removeMessage = (m: NoteMessage) => {
    setConfirmDelete(null);
    if (editingId === m.id) resetComposer();
    onDeleteMessage(m.id);
    notifyWarning();
  };

  const copyMessage = async (m: NoteMessage) => {
    setMenu(null);
    const text =
      m.text.trim() || [m.card?.front.text, m.card?.back.text].filter(Boolean).join('\n\n').trim();
    if (!text) {
      showToast('В сообщении нет текста');
      return;
    }
    const ok = await copyToClipboard(text);
    showToast(ok ? 'Текст скопирован' : 'Не удалось скопировать', ok ? 'info' : 'error');
    if (ok) notifySuccess();
  };

  const copyLink = async (m: NoteMessage) => {
    setMenu(null);
    const link = messageLink?.(m);
    if (!link) return;
    const ok = await copyToClipboard(link);
    showToast(
      ok ? 'Ссылка скопирована — вставьте её в любую заметку' : 'Не удалось скопировать',
      ok ? 'info' : 'error',
    );
    if (ok) notifySuccess();
  };

  const togglePin = (m: NoteMessage) => {
    setMenu(null);
    onTogglePin?.(m.id, !m.pinned);
    notifySuccess();
    if (!m.pinned) showToast('Закреплено');
  };

  const startSelect = (m: NoteMessage) => {
    setMenu(null);
    setSelected(new Set([m.id]));
    selectionChanged();
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      selectionChanged();
      return next;
    });
  };

  const copySelected = async () => {
    if (!selected?.size) return;
    const text = messages
      .filter((m) => selected.has(m.id))
      .map(
        (m) =>
          m.text.trim() || [m.card?.front.text, m.card?.back.text].filter(Boolean).join('\n\n'),
      )
      .filter(Boolean)
      .join('\n\n');
    const ok = await copyToClipboard(text);
    showToast(ok ? 'Скопировано' : 'Не удалось скопировать', ok ? 'info' : 'error');
    if (ok) {
      notifySuccess();
      setSelected(null);
    }
  };

  const deleteSelected = () => {
    if (!selected?.size) return;
    const ids = [...selected];
    if (onDeleteMessages) onDeleteMessages(ids);
    else ids.forEach((id) => onDeleteMessage(id));
    setConfirmBulk(false);
    setSelected(null);
    notifyWarning();
  };

  // Turn a plain message into a flip-card: first photo → front, second → back,
  // the text goes to the front side. Remaining attachments stay on the message.
  const convertToCard = (m: NoteMessage) => {
    setMenu(null);
    const images = (m.attachments ?? []).filter((a) => a.type.startsWith('image/'));
    const rest = (m.attachments ?? []).filter(
      (a) => a.id !== images[0]?.id && a.id !== images[1]?.id,
    );
    const card: NoteCard = {
      front: { text: m.text.trim() || undefined, photo: images[0] },
      back: { photo: images[1] },
    };
    setCardEditor({ id: m.id, card });
    // Stash the leftover attachments so save keeps them.
    cardRest.current = rest;
  };
  const cardRest = useRef<NoteAttachment[]>([]);

  const convertToText = (m: NoteMessage) => {
    setMenu(null);
    if (!m.card) return;
    const text = [m.text.trim(), m.card.front.text?.trim(), m.card.back.text?.trim()]
      .filter(Boolean)
      .join('\n\n');
    const photos = [m.card.front.photo, m.card.back.photo].filter((p): p is NoteAttachment => !!p);
    onEditMessage(m.id, text, [...(m.attachments ?? []), ...photos], { card: undefined });
    notifySuccess();
  };

  const saveCard = (card: NoteCard) => {
    const editorState = cardEditor;
    setCardEditor(null);
    if (!editorState) return;
    if (editorState.id) {
      const m = byId.get(editorState.id);
      onEditMessage(editorState.id, m?.card ? (m?.text ?? '') : '', cardRest.current, { card });
    } else {
      onSend('', [], { card, replyToId: replyTo?.id });
      setReplyTo(null);
    }
    cardRest.current = [];
    notifySuccess();
  };

  const toggleTask = (m: NoteMessage, index: number) => {
    selectionChanged();
    onEditMessage(m.id, toggleTaskInBody(m.text, index), m.attachments ?? []);
  };

  const captureCardAR = (id: string, isFront: boolean, img: HTMLImageElement) => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const ar = img.naturalWidth / img.naturalHeight;
    setCardARs((prev) => {
      if (!isFront && prev.has(id)) return prev; // the front photo wins
      if (prev.get(id) === ar) return prev;
      const next = new Map(prev);
      next.set(id, ar);
      return next;
    });
  };

  /** Card shape: photo's own ratio, clamped; lots of text → closer to 4:3 so
   *  the text has room (the photo then gets blurred side bars, TG-style). */
  const cardAspect = (m: NoteMessage): number | undefined => {
    const ar = cardARs.get(m.id);
    if (!ar) return undefined; // CSS default until the photo loads
    const textLen = Math.max(
      (m.card?.front.text ?? '').trim().length,
      (m.card?.back.text ?? '').trim().length,
    );
    const heavyText = textLen > 60;
    const lo = heavyText ? 0.95 : 0.62;
    const hi = heavyText ? 1.45 : 1.78;
    return Math.min(hi, Math.max(lo, ar));
  };

  const toggleFlip = (id: string) => {
    tapLight();
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cyclePinned = () => {
    if (!pinnedMsgs.length) return;
    tapLight();
    const idx = pinIndex % pinnedMsgs.length;
    scrollToMessage(pinnedMsgs[idx].id);
    setPinIndex((idx + 1) % pinnedMsgs.length);
  };

  // Long-press a bubble → Telegram-style overlay menu near the message.
  const press = useRef<{ id: string; x: number; y: number; fired: boolean } | null>(null);
  const longPressTimer = useRef(0);
  const onBubbleDown = (m: NoteMessage, e: ReactPointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    press.current = { id: m.id, x: e.clientX, y: e.clientY, fired: false };
    window.clearTimeout(longPressTimer.current);
    setPressingId(m.id); // squeeze while holding
    longPressTimer.current = window.setTimeout(() => {
      if (!press.current) return;
      press.current.fired = true;
      setPressingId(null);
      if (selected) {
        toggleSelected(m.id);
        return;
      }
      const r = el.getBoundingClientRect();
      setMenu({
        msg: m,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height, right: r.right },
      });
      selectionChanged();
    }, 420);
  };
  const onBubbleMove = (e: ReactPointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) {
      window.clearTimeout(longPressTimer.current);
      press.current = null;
      setPressingId(null);
    }
  };
  const onBubbleUp = () => {
    window.clearTimeout(longPressTimer.current);
    setPressingId(null);
  };
  const onBubbleClickCapture = (m: NoteMessage, e: ReactMouseEvent) => {
    if (press.current?.fired) {
      e.preventDefault();
      e.stopPropagation();
      press.current = null;
      return;
    }
    press.current = null;
    if (selected) {
      e.preventDefault();
      e.stopPropagation();
      toggleSelected(m.id);
    }
  };

  /** The bubble's inner content — reused by the overlay clone. */
  const renderBubbleContent = (m: NoteMessage, interactive: boolean) => {
    const images = (m.attachments ?? []).filter((a) => a.type.startsWith('image/'));
    const filesOnly = (m.attachments ?? []).filter((a) => !a.type.startsWith('image/'));
    const replied = m.replyToId ? byId.get(m.replyToId) : undefined;
    return (
      <>
        {m.replyToId && (
          <button
            type="button"
            className="chat-quote"
            onClick={() => {
              if (!interactive) return;
              if (replied) scrollToMessage(replied.id);
            }}
          >
            <span className="chat-quote__bar" />
            <span className="chat-quote__text">
              {replied ? messageSnippet(replied) : 'Сообщение удалено'}
            </span>
          </button>
        )}
        {m.card && (
          <div
            className={`chat-card${flipped.has(m.id) ? ' is-flipped' : ''}`}
            style={cardAspect(m) ? ({ '--card-ar': cardAspect(m) } as CSSProperties) : undefined}
            onClick={(e) => {
              // In the long-press overlay only the ⟲ button flips — a tap on
              // the card there is for selecting/copying text.
              if (!interactive) return;
              if ((e.target as HTMLElement).closest('a, button:not(.chat-card__hint)')) return;
              toggleFlip(m.id);
            }}
          >
            <div className="chat-card__inner">
              {(['front', 'back'] as const).map((sideKey) => {
                const side = m.card![sideKey];
                return (
                  <div key={sideKey} className={`chat-card__face chat-card__${sideKey}`}>
                    {side.photo && (
                      <div
                        className="chat-card__media"
                        onClick={(e) => {
                          // In the long-press overlay a tap on the photo opens
                          // it fullscreen (in chat the tap keeps flipping).
                          if (interactive) return;
                          e.stopPropagation();
                          setLightbox(attachmentHref(side.photo!) || null);
                        }}
                      >
                        {/* Blurred copy fills the bars when the photo's shape
                            differs from the card's — like Telegram. */}
                        <img
                          className="chat-card__bg"
                          src={attachmentHref(side.photo)}
                          alt=""
                          aria-hidden
                          loading="lazy"
                        />
                        <img
                          className="chat-card__img"
                          src={attachmentHref(side.photo)}
                          alt=""
                          loading="lazy"
                          onLoad={(e) => captureCardAR(m.id, sideKey === 'front', e.currentTarget)}
                        />
                      </div>
                    )}
                    {(side.text ?? '').trim() ? (
                      <div className="chat-card__text">
                        <NoteMarkdown
                          body={side.text!}
                          notes={notes}
                          attachments={[]}
                          onOpenNote={onOpenNote}
                          onOpenMissing={onOpenMissing}
                          onTag={onTag}
                          onToggleTask={() => {}}
                          onOpenMessage={onOpenMessage}
                        />
                      </div>
                    ) : (
                      !side.photo && <div className="chat-card__empty">Пустая сторона</div>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="chat-card__hint"
              onClick={(e) => {
                e.stopPropagation();
                toggleFlip(m.id);
              }}
              aria-label="Перевернуть карточку"
            >
              <IconSwap size={14} />
            </button>
          </div>
        )}
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
              onOpenMessage={onOpenMessage}
            />
          </div>
        )}
        <div className="chat-bubble__time">
          {m.pinned && <IconPin size={11} />}
          {m.editedAt
            ? `изм. ${timeFmt.format(new Date(m.editedAt))}`
            : timeFmt.format(new Date(m.createdAt))}
        </div>
      </>
    );
  };

  // ---- overlay menu geometry -----------------------------------------------
  const menuView = (() => {
    if (!menu) return null;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const vw = window.innerWidth;
    const m = menu.msg;
    const actions: Array<{
      key: string;
      label: string;
      icon: ReactNode;
      danger?: boolean;
      onClick: () => void;
    }> = [
      {
        key: 'reply',
        label: 'Ответить',
        icon: <IconReply size={18} />,
        onClick: () => startReply(m),
      },
      {
        key: 'copy',
        label: 'Копировать',
        icon: <IconCopy size={18} />,
        onClick: () => void copyMessage(m),
      },
      ...(messageLink?.(m)
        ? [
            {
              key: 'link',
              label: 'Копировать ссылку',
              icon: <IconLink size={18} />,
              onClick: () => void copyLink(m),
            },
          ]
        : []),
      ...(onTogglePin
        ? [
            {
              key: 'pin',
              label: m.pinned ? 'Открепить' : 'Закрепить',
              icon: <IconPin size={18} />,
              onClick: () => togglePin(m),
            },
          ]
        : []),
      {
        key: 'edit',
        label: 'Изменить',
        icon: <IconPencil size={18} />,
        onClick: () => startEdit(m),
      },
      m.card
        ? {
            key: 'uncard',
            label: 'Сделать текстом',
            icon: <IconSwap size={18} />,
            onClick: () => convertToText(m),
          }
        : {
            key: 'card',
            label: 'В карточку',
            icon: <IconSwap size={18} />,
            onClick: () => convertToCard(m),
          },
      {
        key: 'select',
        label: 'Выбрать',
        icon: <IconCheck size={18} />,
        onClick: () => startSelect(m),
      },
      {
        key: 'delete',
        label: 'Удалить',
        icon: <IconTrash size={18} />,
        danger: true,
        onClick: () => askRemoveMessage(m),
      },
    ];
    const menuH = actions.length * 44 + 14;
    const margin = 12;
    const cloneMaxH = Math.max(120, vh - menuH - 100);
    const cloneH = Math.min(menu.rect.height, cloneMaxH);
    let top = menu.rect.top;
    const maxTop = vh - (cloneH + menuH + margin * 2);
    if (top > maxTop) top = Math.max(64, maxTop);
    if (top < 64) top = 64;
    const menuTop = top + cloneH + 8;
    const right = Math.max(10, vw - menu.rect.right);
    return (
      <div className="chat-menu-overlay" onClick={() => setMenu(null)}>
        <div
          className="chat-bubble chat-bubble--clone"
          style={{ top, right, width: menu.rect.width, maxHeight: cloneMaxH }}
          onClick={(e) => e.stopPropagation()}
        >
          {renderBubbleContent(m, false)}
        </div>
        <div
          className="chat-menu"
          style={{ top: menuTop, right }}
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map((a) => (
            <button
              key={a.key}
              className={`chat-menu__item${a.danger ? ' is-danger' : ''}`}
              onClick={a.onClick}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      </div>
    );
  })();

  return (
    <>
      {selected ? (
        <div className="chat-selectbar">
          <button
            className="chat-selectbar__close"
            onClick={() => setSelected(null)}
            aria-label="Отменить выбор"
          >
            ×
          </button>
          <span className="chat-selectbar__count">
            Выбрано: <em key={selected.size}>{selected.size}</em>
          </span>
          <div className="chat-selectbar__actions">
            <button
              onClick={() => void copySelected()}
              disabled={!selected.size}
              aria-label="Копировать выбранные"
            >
              <IconCopy size={18} />
            </button>
            <button
              className="is-danger"
              onClick={() => selected.size && setConfirmBulk(true)}
              disabled={!selected.size}
              aria-label="Удалить выбранные"
            >
              <IconTrash size={18} />
            </button>
          </div>
        </div>
      ) : (
        pinnedMsgs.length > 0 && (
          <button className="chat-pinned" onClick={cyclePinned}>
            <IconPin size={14} />
            <span className="chat-pinned__body">
              <span className="chat-pinned__label">
                Закреплено
                {pinnedMsgs.length > 1
                  ? ` · ${(pinIndex % pinnedMsgs.length) + 1}/${pinnedMsgs.length}`
                  : ''}
              </span>
              <span className="chat-pinned__snippet" key={pinIndex % pinnedMsgs.length}>
                {messageSnippet(pinnedMsgs[pinIndex % pinnedMsgs.length])}
              </span>
            </span>
          </button>
        )
      )}

      <div className="chat-scroll" ref={scrollRef}>
        {header}
        {!messages.length && (
          <div className="chat-empty">
            <div className="chat-empty__icon">💭</div>
            <div className="chat-empty__title">{emptyTitle ?? 'Ваше пространство для мыслей'}</div>
            <div className="chat-empty__hint">
              Пишите как в личном чате с собой — мысль за мыслью. Внизу: <b>＋</b> добавит фото,
              тег, связь или задачу, <b>➤</b> отправит.
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Fragment key={m.id}>
            {(i === 0 || !sameDay(messages[i - 1].createdAt, m.createdAt)) && (
              <div className="chat-day">
                <span>{dayLabel(m.createdAt)}</span>
              </div>
            )}
            <div
              data-mid={m.id}
              className={`chat-bubble${m.card ? ' chat-bubble--card' : ''}${
                selected?.has(m.id) ? ' is-selected' : ''
              }${highlightId === m.id ? ' is-flash' : ''}${selected ? ' in-select' : ''}${
                pressingId === m.id ? ' is-pressing' : ''
              }`}
              onPointerDown={(e) => onBubbleDown(m, e)}
              onPointerMove={onBubbleMove}
              onPointerUp={onBubbleUp}
              onPointerCancel={onBubbleUp}
              onClickCapture={(e) => onBubbleClickCapture(m, e)}
            >
              {selected && (
                <span className={`chat-select-dot${selected.has(m.id) ? ' is-on' : ''}`}>
                  {selected.has(m.id) && <IconCheck size={12} />}
                </span>
              )}
              {renderBubbleContent(m, true)}
            </div>
          </Fragment>
        ))}
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
        {replyTo && !editingId && (
          <div className="chat-editing chat-editing--reply">
            <IconReply size={15} />
            <span className="chat-editing__snippet">{messageSnippet(replyTo)}</span>
            <button
              className="chat-editing__cancel"
              onClick={() => setReplyTo(null)}
              aria-label="Отменить ответ"
            >
              ×
            </button>
          </div>
        )}
        {error && <div className="notes-error">{error}</div>}
        {pending.length > 0 && (
          <div className="chat-pending">
            {pending.map((a) => (
              <div
                key={a.id}
                className={`chat-pending__item${a.type.startsWith('image/') ? '' : ' is-file'}`}
              >
                {a.type.startsWith('image/') ? (
                  <img src={attachmentHref(a)} alt={a.name} />
                ) : (
                  <IconPaperclip size={18} />
                )}
                <button
                  onClick={() => setPending((p) => p.filter((x) => x.id !== a.id))}
                  aria-label="Убрать"
                >
                  <IconTrash size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="chat-input__row">
          <button
            className="chat-plus"
            onClick={() => {
              tapLight();
              setShowActions(true);
            }}
            aria-label="Добавить фото, тег, связь"
          >
            <IconPlus size={22} />
          </button>
          <textarea
            ref={textRef}
            className="chat-text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && ENTER_SENDS) {
                e.preventDefault();
                send();
              } else if (e.key === 'Escape' && (editingId || replyTo)) {
                resetComposer();
              }
            }}
            placeholder={placeholder ?? 'Новая мысль…'}
            rows={1}
          />
          <button
            className="chat-send"
            onClick={send}
            disabled={!draft.trim() && !pending.length}
            aria-label="Отправить"
          >
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
            <button
              onClick={() => {
                setShowActions(false);
                imageRef.current?.click();
              }}
            >
              <span className="chat-actions__ic">
                <IconImage size={20} />
              </span>{' '}
              Фото
            </button>
            <button
              onClick={() => {
                setShowActions(false);
                setCardEditor({ card: { front: {}, back: {} } });
              }}
            >
              <span className="chat-actions__ic">
                <IconSwap size={20} />
              </span>{' '}
              Карточка
            </button>
            <button
              onClick={() => {
                setShowActions(false);
                fileRef.current?.click();
              }}
            >
              <span className="chat-actions__ic">
                <IconPaperclip size={20} />
              </span>{' '}
              Файл
            </button>
            <button
              onClick={() => {
                setShowActions(false);
                setLinkPicker(true);
              }}
            >
              <span className="chat-actions__ic">
                <IconLink size={20} />
              </span>{' '}
              Связать с заметкой
            </button>
            <button
              onClick={() => {
                setShowActions(false);
                insert('#');
              }}
            >
              <span className="chat-actions__ic">
                <IconHash size={20} />
              </span>{' '}
              Добавить тег
            </button>
            <button
              onClick={() => {
                setShowActions(false);
                insert('- [ ] ');
              }}
            >
              <span className="chat-actions__ic">
                <IconCheck size={20} />
              </span>{' '}
              Задача
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

      {menuView}

      {cardEditor && (
        <CardEditor
          initial={cardEditor.card}
          onClose={() => {
            setCardEditor(null);
            cardRest.current = [];
          }}
          onSave={saveCard}
        />
      )}

      {confirmBulk && selected && (
        <ConfirmDialog
          title={`Удалить ${selected.size} сообщ.?`}
          message="Выбранные сообщения исчезнут из заметки."
          onClose={() => setConfirmBulk(false)}
          onConfirm={deleteSelected}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Удалить сообщение?"
          message={`«${messageSnippet(confirmDelete, 60)}» исчезнет из заметки.`}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => removeMessage(confirmDelete)}
        />
      )}

      {lightbox && (
        <div className="chat-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </>
  );
}

/** Two-sided flip-card editor: front/back, each side photo and/or text. */
function CardEditor({
  initial,
  onClose,
  onSave,
}: {
  initial: NoteCard;
  onClose: () => void;
  onSave: (card: NoteCard) => void;
}) {
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [card, setCard] = useState<NoteCard>(initial);
  const photoRef = useRef<HTMLInputElement | null>(null);
  const cropImages = useCrop();
  const [busy, setBusy] = useState(false);

  const cur = card[side];
  const patchSide = (patch: Partial<NoteCardSide>) =>
    setCard((c) => ({ ...c, [side]: { ...c[side], ...patch } }));

  const pickPhoto = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const picked = await cropImages([files[0]]);
      if (picked.length) patchSide({ photo: await fileToAttachment(picked[0]) });
    } catch {
      showToast('Фото не добавилось — слишком большое?', 'error');
    } finally {
      setBusy(false);
    }
  };

  const canSave = !cardSideEmpty(card.front) || !cardSideEmpty(card.back);

  return (
    <Sheet title="Карточка" onClose={onClose}>
      <p className="card-editor__lead">
        Две стороны, как у флешкарты: в чате видна лицевая, тап переворачивает на обратную.
      </p>
      <div className="calc-seg card-editor__seg">
        <button
          type="button"
          className={`calc-seg__opt${side === 'front' ? ' is-active' : ''}`}
          onClick={() => {
            selectionChanged();
            setSide('front');
          }}
        >
          Лицевая{cardSideEmpty(card.front) ? '' : ' ✓'}
        </button>
        <button
          type="button"
          className={`calc-seg__opt${side === 'back' ? ' is-active' : ''}`}
          onClick={() => {
            selectionChanged();
            setSide('back');
          }}
        >
          Обратная{cardSideEmpty(card.back) ? '' : ' ✓'}
        </button>
      </div>

      <div className="card-editor__photo">
        {cur.photo ? (
          <div className="card-editor__preview">
            <img src={attachmentHref(cur.photo)} alt="" />
            <button
              className="card-editor__remove"
              onClick={() => patchSide({ photo: undefined })}
              aria-label="Убрать фото"
            >
              <IconTrash size={15} />
            </button>
          </div>
        ) : (
          <button
            className="card-editor__add"
            disabled={busy}
            onClick={() => photoRef.current?.click()}
          >
            <IconImage size={20} /> {busy ? 'Загрузка…' : 'Добавить фото стороны'}
          </button>
        )}
      </div>

      <textarea
        className="input card-editor__text"
        value={cur.text ?? ''}
        onChange={(e) => patchSide({ text: e.target.value })}
        placeholder={side === 'front' ? 'Текст лицевой стороны…' : 'Текст обратной стороны…'}
        rows={3}
      />

      <button
        className="btn btn--primary btn--block"
        disabled={!canSave}
        onClick={() => onSave(card)}
      >
        Сохранить карточку
      </button>

      <input
        ref={photoRef}
        hidden
        type="file"
        accept="image/*"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          void pickPhoto(e.target.files);
          e.target.value = '';
        }}
      />
    </Sheet>
  );
}
