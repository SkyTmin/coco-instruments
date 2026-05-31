import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog, Screen } from '@/components/ui';
import { NoteMarkdown } from '@/components/NoteMarkdown';
import { IconCheck, IconImage, IconPaperclip, IconPencil, IconTrash } from '@/components/icons';
import type { NoteAttachment } from '@/types';
import { useFinanceStore } from '@/store';
import { genId } from '@/lib/id';
import { getNoteRelations, normalizeNoteTitle } from '@/lib/notes-graph';
import { countTasks, toggleTaskInBody } from '@/lib/notes-markdown';
import { notifySuccess, notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';
import { noteDateFmt } from '@/pages/NotesPage';

const MAX_ATTACHMENT_SIZE = 3 * 1024 * 1024;
const MAX_IMAGE_SOURCE_SIZE = 12 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;
const IMAGE_MAX_SIDE = 1800;
const AUTOSAVE_MS = 700;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

function attachmentHref(attachment: NoteAttachment): string {
  return attachment.url ?? attachment.dataUrl ?? '';
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('file-read-failed'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas-failed'))), type, quality);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image-load-failed'));
    };
    img.src = url;
  });
}

function jpegName(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpg';
}

async function compressImage(file: File): Promise<{ blob: Blob; name: string; type: string }> {
  const img = await loadImage(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-context-failed');
  ctx.drawImage(img, 0, 0, width, height);

  for (const quality of [0.86, 0.76, 0.66, 0.56]) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (blob.size <= MAX_ATTACHMENT_SIZE) {
      return { blob, name: jpegName(file.name), type: 'image/jpeg' };
    }
  }
  throw new Error('image-too-large');
}

async function fileToAttachment(file: File): Promise<NoteAttachment> {
  const isImage = file.type.startsWith('image/');
  if (isImage && file.size > MAX_IMAGE_SOURCE_SIZE) throw new Error('image-source-too-large');
  if (!isImage && file.size > MAX_ATTACHMENT_SIZE) throw new Error('file-too-large');

  const prepared =
    isImage && file.type !== 'image/svg+xml' && file.type !== 'image/gif'
      ? await compressImage(file)
      : { blob: file, name: file.name, type: file.type || 'application/octet-stream' };
  if (prepared.blob.size > MAX_ATTACHMENT_SIZE) throw new Error('file-too-large');

  const dataUrl = await readAsDataUrl(prepared.blob);
  const uploaded = await uploadAttachment({
    name: prepared.name,
    type: prepared.type,
    size: prepared.blob.size,
    dataUrl,
  });

  return {
    id: genId(),
    name: prepared.name,
    type: prepared.type,
    size: prepared.blob.size,
    url: uploaded?.url,
    dataUrl: uploaded ? undefined : dataUrl,
    createdAt: Date.now(),
  };
}

async function uploadAttachment(input: {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}): Promise<{ url: string } | null> {
  try {
    const res = await fetch('/api/notes/attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return null;
    const json = (await res.json()) as { url?: string };
    return json.url ? { url: json.url } : null;
  } catch {
    return null;
  }
}

function imageToken(attachment: NoteAttachment): string {
  return `![${attachment.name}](${attachmentHref(attachment) || `attachment:${attachment.id}`})`;
}

function appendImageTokens(body: string, images: NoteAttachment[]): string {
  if (!images.length) return body;
  const insert = images.map(imageToken).join('\n');
  return body.trim() ? `${body.trimEnd()}\n\n${insert}\n` : `${insert}\n`;
}

function removeImageFromBody(body: string, attachment: NoteAttachment): string {
  const id = attachment.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = attachment.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body
    .replace(new RegExp(`\\n?\\s*!\\[[^\\]]*\\]\\(attachment:${id}\\)\\s*\\n?`, 'g'), '\n')
    .replace(new RegExp(`\\n?\\s*!\\[${name}\\]\\([^)]*\\)\\s*\\n?`, 'g'), '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart();
}

const emptyAttachments: NoteAttachment[] = [];

export function NoteEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const notes = useFinanceStore((s) => s.notes);
  const existing = useFinanceStore((s) => (id ? s.getNote(id) : undefined));
  const hydrated = useFinanceStore((s) => s.hydrated);
  const addNote = useFinanceStore((s) => s.addNote);
  const updateNote = useFinanceStore((s) => s.updateNote);
  const removeNote = useFinanceStore((s) => s.removeNote);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [attachments, setAttachments] = useState<NoteAttachment[]>(existing?.attachments ?? []);
  const [mode, setMode] = useState<'view' | 'edit'>(id ? 'view' : 'edit');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [wiki, setWiki] = useState<{ start: number; query: string } | null>(null);

  // Refs that mirror state so the unmount flush can read the latest values.
  const latest = useRef({ title, body, attachments });
  latest.current = { title, body, attachments };
  const loadedId = useRef<string | undefined>(undefined);
  const currentId = useRef<string | undefined>(id);
  const deleted = useRef(false);
  const savedSnapshot = useRef(JSON.stringify({ title, body, attachments }));
  const pendingCaret = useRef<number | null>(null);

  // Load a note's content into local state. Runs on the first hydration and
  // whenever we navigate to a *different* note — but never for our own
  // autosave (which only updates the note we already have loaded), so edits in
  // progress are never clobbered.
  useEffect(() => {
    if (!id || !existing) return;
    if (existing.id === loadedId.current) return;
    loadedId.current = existing.id;
    currentId.current = existing.id;
    setTitle(existing.title);
    setBody(existing.body);
    setAttachments(existing.attachments ?? emptyAttachments);
    setMode('view');
    savedSnapshot.current = JSON.stringify({
      title: existing.title,
      body: existing.body,
      attachments: existing.attachments ?? emptyAttachments,
    });
  }, [existing, id]);

  const normalizedTitle = normalizeNoteTitle(title);
  const hasDuplicate = useMemo(
    () =>
      notes.some(
        (item) => item.id !== currentId.current && normalizeNoteTitle(item.title) === normalizedTitle,
      ),
    [notes, normalizedTitle],
  );

  const snapshot = JSON.stringify({ title, body, attachments });
  const dirty = snapshot !== savedSnapshot.current;
  const canPersist = normalizedTitle.length > 0 && !hasDuplicate;

  // Persist the latest content (creates the note on first valid save). A no-op
  // when nothing changed, so merely viewing a note never bumps its timestamp.
  const persist = () => {
    if (deleted.current) return;
    const { title: t, body: b, attachments: a } = latest.current;
    const snap = JSON.stringify({ title: t, body: b, attachments: a });
    if (snap === savedSnapshot.current) return;
    const trimmed = t.trim();
    const key = normalizeNoteTitle(t);
    if (!key) return; // a title is required to save
    const state = useFinanceStore.getState();
    const dup = state.notes.some(
      (n) => n.id !== currentId.current && normalizeNoteTitle(n.title) === key,
    );
    if (dup) return;
    if (currentId.current) {
      state.updateNote(currentId.current, { title: trimmed, body: b, attachments: a });
    } else {
      const created = state.addNote({ title: trimmed, body: b, attachments: a });
      currentId.current = created.id;
      loadedId.current = created.id;
      navigate(`/notes/${created.id}`, { replace: true });
    }
    savedSnapshot.current = snap;
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // Debounced autosave while editing.
  useEffect(() => {
    if (mode !== 'edit' || !dirty || !canPersist) return;
    const timer = window.setTimeout(() => persistRef.current(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [snapshot, mode, dirty, canPersist]);

  // Flush once more on unmount (covers a fast Back-press before the debounce).
  useEffect(() => {
    return () => persistRef.current();
  }, []);

  // Auto-grow the textarea.
  useLayoutEffect(() => {
    if (mode !== 'edit') return;
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(220, el.scrollHeight)}px`;
  }, [body, mode]);

  // Restore the caret after a programmatic body edit (toolbar / autocomplete).
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    const el = bodyRef.current;
    if (el) {
      const pos = pendingCaret.current;
      el.focus();
      el.setSelectionRange(pos, pos);
    }
    pendingCaret.current = null;
  });

  const note = id ? existing : undefined;
  const relations = useMemo(() => getNoteRelations(note, notes), [note, notes]);

  if (id && hydrated && !existing && !deleted.current) return <Navigate to="/notes" replace />;

  // ---- wiki-link autocomplete ----------------------------------------------
  const syncWiki = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const open = /\[\[([^\]\n]*)$/.exec(before);
    setWiki(open ? { start: open.index + 2, query: open[1] } : null);
  };

  const wikiSuggestions = useMemo(() => {
    if (!wiki) return [];
    const q = normalizeNoteTitle(wiki.query);
    return notes
      .filter((n) => n.id !== currentId.current && (!q || normalizeNoteTitle(n.title).includes(q)))
      .slice(0, 6);
  }, [wiki, notes]);

  const applyWiki = (chosen: string) => {
    if (!wiki) return;
    const end = wiki.start + wiki.query.length;
    const next = `${body.slice(0, wiki.start)}${chosen}]]${body.slice(end)}`;
    pendingCaret.current = wiki.start + chosen.length + 2;
    setBody(next);
    setWiki(null);
    selectionChanged();
  };

  // ---- formatting toolbar ---------------------------------------------------
  const surround = (before: string, after = before) => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const selected = body.slice(start, end);
    const next = `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`;
    pendingCaret.current = selected ? start + before.length + selected.length + after.length : start + before.length;
    setBody(next);
    selectionChanged();
  };

  const prefixLine = (prefix: string) => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const lineStart = body.lastIndexOf('\n', start - 1) + 1;
    const next = `${body.slice(0, lineStart)}${prefix}${body.slice(lineStart)}`;
    pendingCaret.current = start + prefix.length;
    setBody(next);
    selectionChanged();
  };

  const insertWiki = () => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const next = `${body.slice(0, start)}[[]]${body.slice(start)}`;
    pendingCaret.current = start + 2;
    setBody(next);
    setWiki({ start: start + 2, query: '' });
    selectionChanged();
  };

  // ---- attachments ----------------------------------------------------------
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setAttachmentError('');
    const next = [...attachments];
    const insertedImages: NoteAttachment[] = [];
    for (const file of Array.from(files)) {
      if (next.length >= MAX_ATTACHMENTS) {
        setAttachmentError(`Максимум ${MAX_ATTACHMENTS} вложений`);
        notifyWarning();
        break;
      }
      try {
        const attachment = await fileToAttachment(file);
        next.push(attachment);
        if (attachment.type.startsWith('image/')) insertedImages.push(attachment);
      } catch {
        const limit = file.type.startsWith('image/') ? MAX_IMAGE_SOURCE_SIZE : MAX_ATTACHMENT_SIZE;
        setAttachmentError(
          `${file.name}: исходник больше ${formatBytes(limit)} или не сжался до ${formatBytes(MAX_ATTACHMENT_SIZE)}`,
        );
        notifyWarning();
      }
    }
    setAttachments(next);
    setBody((value) => appendImageTokens(value, insertedImages));
    selectionChanged();
  };

  const removeAttachment = (attachmentId: string) => {
    const attachment = attachments.find((item) => item.id === attachmentId);
    setAttachments((items) => items.filter((item) => item.id !== attachmentId));
    if (attachment?.type.startsWith('image/')) {
      setBody((value) => removeImageFromBody(value, attachment));
    }
    selectionChanged();
  };

  // ---- actions --------------------------------------------------------------
  const toggleTask = (index: number) => {
    selectionChanged();
    const next = toggleTaskInBody(body, index);
    setBody(next);
    // Tasks toggle from the reading view — persist immediately.
    latest.current = { ...latest.current, body: next };
    window.setTimeout(() => persistRef.current(), 0);
  };

  const openNote = (noteId: string) => {
    persistRef.current();
    navigate(`/notes/${noteId}`);
  };

  const openMissing = (linkTitle: string) => {
    persistRef.current();
    const created = useFinanceStore.getState().addNote({ title: linkTitle, body: '' });
    notifySuccess();
    navigate(`/notes/${created.id}`);
  };

  const finishEditing = () => {
    if (!canPersist) {
      notifyWarning();
      return;
    }
    persistRef.current();
    notifySuccess();
    setMode('view');
    setWiki(null);
  };

  const deleteNote = () => {
    deleted.current = true;
    if (currentId.current) removeNote(currentId.current);
    currentId.current = undefined;
    loadedId.current = undefined;
    savedSnapshot.current = JSON.stringify({ title: '', body: '', attachments: [] });
    setConfirmDelete(false);
    notifySuccess();
    navigate('/notes', { replace: true });
  };

  const imageAttachments = attachments.filter((a) => a.type.startsWith('image/'));
  const fileAttachments = attachments.filter((a) => !a.type.startsWith('image/'));
  const hasTasks = countTasks(body) > 0;

  const subtitle =
    mode === 'edit'
      ? hasDuplicate
        ? 'Название занято'
        : dirty
          ? 'Сохранение…'
          : 'Сохранено'
      : note
        ? noteDateFmt.format(new Date(note.updatedAt))
        : 'Черновик';

  return (
    <Screen
      title={mode === 'edit' ? (title.trim() || 'Новая заметка') : title.trim() || 'Заметка'}
      subtitle={subtitle}
      action={
        <div className="notes-editor-actions">
          {mode === 'view' ? (
            <button
              className="icon-btn notes-edit"
              onClick={() => {
                tapLight();
                setMode('edit');
              }}
              aria-label="Редактировать"
            >
              <IconPencil size={20} />
            </button>
          ) : (
            <button
              className="icon-btn notes-save"
              onClick={finishEditing}
              disabled={!canPersist}
              aria-label="Готово"
            >
              <IconCheck size={21} />
            </button>
          )}
          {(note || currentId.current) && (
            <button
              className="icon-btn notes-delete"
              onClick={() => setConfirmDelete(true)}
              aria-label="Удалить"
            >
              <IconTrash size={20} />
            </button>
          )}
        </div>
      }
    >
      <div className="note-editor-page">
        {mode === 'edit' ? (
          <>
            <input
              className="note-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Название"
              autoFocus={!id}
            />
            {hasDuplicate && <div className="notes-error">Такое название уже есть</div>}

            <textarea
              ref={bodyRef}
              className="note-body-input"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                syncWiki(e.target.value, e.target.selectionStart ?? e.target.value.length);
              }}
              onClick={(e) => syncWiki(body, e.currentTarget.selectionStart ?? body.length)}
              onKeyUp={(e) => syncWiki(body, e.currentTarget.selectionStart ?? body.length)}
              placeholder="Пишите заметку. Связь: [[Проект]], тег: #идея, задача: - [ ] дело"
              rows={1}
            />
          </>
        ) : (
          <NoteMarkdown
            body={body}
            notes={notes}
            attachments={attachments}
            onOpenNote={openNote}
            onOpenMissing={openMissing}
            onTag={(tag) => {
              persistRef.current();
              navigate(`/notes?q=${encodeURIComponent('#' + tag)}`);
            }}
            onToggleTask={toggleTask}
          />
        )}

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
        {attachmentError && <div className="notes-error">{attachmentError}</div>}

        {mode === 'edit' && imageAttachments.length > 0 && (
          <div className="note-thumbs">
            {imageAttachments.map((attachment) => (
              <div key={attachment.id} className="note-thumb">
                <img src={attachmentHref(attachment)} alt={attachment.name} />
                <button onClick={() => removeAttachment(attachment.id)} aria-label="Убрать">
                  <IconTrash size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        {fileAttachments.length > 0 && (
          <div className="note-attachments">
            {fileAttachments.map((attachment) => (
              <div key={attachment.id} className="note-attachment">
                <IconPaperclip size={20} />
                <div className="note-attachment__meta">
                  <a href={attachmentHref(attachment)} target="_blank" rel="noreferrer">
                    {attachment.name}
                  </a>
                  <span>{formatBytes(attachment.size)}</span>
                </div>
                <a
                  className="note-attachment__download"
                  href={attachmentHref(attachment)}
                  download={attachment.name}
                >
                  Скачать
                </a>
                {mode === 'edit' && (
                  <button className="icon-btn" onClick={() => removeAttachment(attachment.id)} aria-label="Убрать">
                    <IconTrash size={17} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {mode === 'view' && hasTasks && <TaskProgress body={body} />}

        {note && (relations.outgoing.length > 0 || relations.backlinks.length > 0 || relations.missing.length > 0) && (
          <div className="notes-relations notes-relations--editor">
            {relations.outgoing.length > 0 && (
              <div className="notes-relation-row">
                <span>Ссылки</span>
                <div>
                  {relations.outgoing.map((item) => (
                    <button key={item.id} className="note-chip" onClick={() => openNote(item.id)}>
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {relations.backlinks.length > 0 && (
              <div className="notes-relation-row">
                <span>Обратные</span>
                <div>
                  {relations.backlinks.map((item) => (
                    <button key={item.id} className="note-chip" onClick={() => openNote(item.id)}>
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {relations.missing.length > 0 && (
              <div className="notes-relation-row">
                <span>Без файла</span>
                <div>
                  {relations.missing.map((item) => (
                    <button key={item} className="note-chip note-chip--new" onClick={() => openMissing(item)}>
                      + {item}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {mode === 'edit' && (
          <div className="note-foot">
            {wiki && wikiSuggestions.length > 0 && (
              <div className="wiki-suggest">
                {wikiSuggestions.map((n) => (
                  <button key={n.id} className="wiki-suggest__item" onClick={() => applyWiki(n.title)}>
                    <span className="wiki-suggest__icon">[[</span>
                    {n.title}
                  </button>
                ))}
              </div>
            )}
            <div className="note-toolbar">
              <button className="md-tool" onClick={() => surround('**')} aria-label="Жирный">
                <b>B</b>
              </button>
              <button className="md-tool" onClick={() => surround('*')} aria-label="Курсив">
                <i>I</i>
              </button>
              <button className="md-tool" onClick={() => prefixLine('## ')} aria-label="Заголовок">
                H
              </button>
              <button className="md-tool" onClick={() => prefixLine('- ')} aria-label="Список">
                •
              </button>
              <button className="md-tool" onClick={() => prefixLine('- [ ] ')} aria-label="Задача">
                ☑
              </button>
              <button className="md-tool" onClick={insertWiki} aria-label="Связь">
                [[ ]]
              </button>
              <span className="note-toolbar__spacer" />
              <button className="md-tool" onClick={() => imageRef.current?.click()} aria-label="Фото">
                <IconImage size={17} />
              </button>
              <button className="md-tool" onClick={() => fileRef.current?.click()} aria-label="Файл">
                <IconPaperclip size={17} />
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Удалить заметку?"
          message={`«${title.trim() || 'Без названия'}» исчезнет из базы.`}
          onClose={() => setConfirmDelete(false)}
          onConfirm={deleteNote}
        />
      )}
    </Screen>
  );
}

function TaskProgress({ body }: { body: string }) {
  const lines = body.split('\n');
  const total = lines.filter((l) => /^\s*[-*]\s+\[[ xX]\]/.test(l)).length;
  const done = lines.filter((l) => /^\s*[-*]\s+\[[xX]\]/.test(l)).length;
  if (!total) return null;
  const percent = Math.round((done / total) * 100);
  return (
    <div className="task-progress">
      <div className="task-progress__bar">
        <div className="task-progress__fill" style={{ width: `${percent}%` }} />
      </div>
      <span>
        {done}/{total}
      </span>
    </div>
  );
}
