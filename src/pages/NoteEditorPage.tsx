import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog, Screen } from '@/components/ui';
import { IconCheck, IconImage, IconPaperclip, IconTrash } from '@/components/icons';
import type { NoteAttachment } from '@/types';
import { useFinanceStore } from '@/store';
import { genId } from '@/lib/id';
import { getNoteRelations, normalizeNoteTitle } from '@/lib/notes-graph';
import { notifySuccess, notifyWarning, selectionChanged } from '@/lib/haptics';
import { noteDateFmt } from '@/pages/NotesPage';

const MAX_ATTACHMENT_SIZE = 3 * 1024 * 1024;
const MAX_IMAGE_SOURCE_SIZE = 12 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;
const IMAGE_MAX_SIDE = 1800;

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

function removeAttachmentToken(body: string, attachmentId: string): string {
  const escaped = attachmentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body
    .replace(new RegExp(`\\n?\\s*!\\[[^\\]]*\\]\\(attachment:${escaped}\\)\\s*\\n?`, 'g'), '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart();
}

function removeMarkdownImageByName(body: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body
    .replace(new RegExp(`\\n?\\s*!\\[${escaped}\\]\\([^)]*\\)\\s*\\n?`, 'g'), '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart();
}

export function NoteEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = !id;
  const notes = useFinanceStore((s) => s.notes);
  const existing = useFinanceStore((s) => (id ? s.getNote(id) : undefined));
  const addNote = useFinanceStore((s) => s.addNote);
  const updateNote = useFinanceStore((s) => s.updateNote);
  const removeNote = useFinanceStore((s) => s.removeNote);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [attachments, setAttachments] = useState<NoteAttachment[]>(existing?.attachments ?? []);
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const note = existing;

  useEffect(() => {
    if (isNew || !existing) return;
    setTitle(existing.title);
    setBody(existing.body);
    setAttachments(existing.attachments ?? []);
  }, [existing, isNew]);

  const relations = useMemo(() => getNoteRelations(note, notes), [note, notes]);
  const normalizedTitle = normalizeNoteTitle(title);
  const hasDuplicate = notes.some(
    (item) => item.id !== note?.id && normalizeNoteTitle(item.title) === normalizedTitle,
  );

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(240, el.scrollHeight)}px`;
  }, [body]);

  if (!isNew && !existing) return <Navigate to="/notes" replace />;

  const attachmentsChanged =
    JSON.stringify(attachments) !== JSON.stringify(existing?.attachments ?? []);
  const dirty =
    isNew ||
    title !== (existing?.title ?? '') ||
    body !== (existing?.body ?? '') ||
    attachmentsChanged;
  const canSave = normalizedTitle.length > 0 && !hasDuplicate && dirty;

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
      setBody((value) => removeMarkdownImageByName(removeAttachmentToken(value, attachmentId), attachment.name));
    }
    selectionChanged();
  };

  const deleteNote = () => {
    if (existing?.id) removeNote(existing.id);
    setConfirmDelete(false);
    notifySuccess();
    navigate('/notes', { replace: true });
  };

  const save = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || hasDuplicate) {
      notifyWarning();
      return;
    }
    if (isNew) {
      const created = addNote({ title: trimmedTitle, body, attachments });
      notifySuccess();
      navigate(`/notes/${created.id}`, { replace: true });
      return;
    }
    if (existing) updateNote(existing.id, { title: trimmedTitle, body, attachments });
    notifySuccess();
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1200);
  };

  const openMissing = (linkTitle: string) => {
    const created = addNote({ title: linkTitle, body: '' });
    notifySuccess();
    navigate(`/notes/${created.id}`, { replace: true });
  };

  const imageAttachments = attachments.filter((attachment) => attachment.type.startsWith('image/'));
  const fileAttachments = attachments.filter((attachment) => !attachment.type.startsWith('image/'));

  return (
    <Screen
      title={isNew ? 'Новая заметка' : title.trim() || 'Заметка'}
      subtitle={
        savedFlash
          ? 'Сохранено'
          : hasDuplicate
            ? 'Название занято'
            : dirty
              ? 'Есть изменения'
              : note
                ? noteDateFmt.format(new Date(note.updatedAt))
                : 'Черновик'
      }
      action={
        <div className="notes-editor-actions">
          <button
            className="icon-btn notes-save"
            onClick={save}
            disabled={!canSave}
            aria-label="Сохранить"
          >
            <IconCheck size={21} />
          </button>
          {note && (
            <button className="icon-btn notes-delete" onClick={() => setConfirmDelete(true)} aria-label="Удалить">
              <IconTrash size={20} />
            </button>
          )}
        </div>
      }
    >
      <div className="note-editor-page">
        <input
          className="note-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название"
          autoFocus
        />
        {hasDuplicate && <div className="notes-error">Такое название уже есть</div>}

        <textarea
          ref={bodyRef}
          className="note-body-input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Пишите заметку. Связь: [[Проект]], тег: #идея"
          rows={1}
        />

        <div className="notes-attach-bar">
          <button className="notes-attach-btn" onClick={() => imageRef.current?.click()}>
            <IconImage size={18} />
            Фото
          </button>
          <button className="notes-attach-btn" onClick={() => fileRef.current?.click()}>
            <IconPaperclip size={18} />
            Файл
          </button>
          <span>{attachments.length}/{MAX_ATTACHMENTS}</span>
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
        {attachmentError && <div className="notes-error">{attachmentError}</div>}

        {imageAttachments.length > 0 && (
          <div className="note-inline-photos">
            {imageAttachments.map((attachment) => (
              <figure key={attachment.id} className="note-inline-photo">
                <img src={attachmentHref(attachment)} alt={attachment.name} />
                <figcaption>
                  <span>{attachment.name} · {formatBytes(attachment.size)}</span>
                  <div>
                    <a href={attachmentHref(attachment)} target="_blank" rel="noreferrer">
                      Открыть
                    </a>
                    <a href={attachmentHref(attachment)} download={attachment.name}>
                      Скачать
                    </a>
                    <button onClick={() => removeAttachment(attachment.id)}>Убрать</button>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        {fileAttachments.length > 0 && (
          <div className="note-attachments">
            {fileAttachments.map((attachment) => {
              return (
                <div key={attachment.id} className="note-attachment">
                  <IconPaperclip size={20} />
                  <div className="note-attachment__meta">
                    <a href={attachmentHref(attachment)} target="_blank" rel="noreferrer">
                      {attachment.name}
                    </a>
                    <span>{formatBytes(attachment.size)}</span>
                  </div>
                  <a className="note-attachment__download" href={attachmentHref(attachment)} download={attachment.name}>
                    Скачать
                  </a>
                  <button className="icon-btn" onClick={() => removeAttachment(attachment.id)} aria-label="Убрать">
                    <IconTrash size={17} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {note && (
          <div className="notes-relations notes-relations--editor">
            <div className="notes-relation-row">
              <span>Исходящие</span>
              <div>
                {relations.outgoing.length ? (
                  relations.outgoing.map((item) => (
                    <button key={item.id} className="note-chip" onClick={() => navigate(`/notes/${item.id}`)}>
                      {item.title}
                    </button>
                  ))
                ) : (
                  <em>нет</em>
                )}
              </div>
            </div>
            <div className="notes-relation-row">
              <span>Обратные</span>
              <div>
                {relations.backlinks.length ? (
                  relations.backlinks.map((item) => (
                    <button key={item.id} className="note-chip" onClick={() => navigate(`/notes/${item.id}`)}>
                      {item.title}
                    </button>
                  ))
                ) : (
                  <em>нет</em>
                )}
              </div>
            </div>
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
