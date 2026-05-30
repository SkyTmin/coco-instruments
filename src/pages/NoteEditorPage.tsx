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

const MAX_ATTACHMENT_SIZE = 1.5 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

function fileToAttachment(file: File): Promise<NoteAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('file-read-failed'));
    reader.onload = () => {
      resolve({
        id: genId(),
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl: String(reader.result ?? ''),
        createdAt: Date.now(),
      });
    };
    reader.readAsDataURL(file);
  });
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
    for (const file of Array.from(files)) {
      if (next.length >= MAX_ATTACHMENTS) {
        setAttachmentError(`Максимум ${MAX_ATTACHMENTS} вложений`);
        notifyWarning();
        break;
      }
      if (file.size > MAX_ATTACHMENT_SIZE) {
        setAttachmentError(`${file.name}: больше ${formatBytes(MAX_ATTACHMENT_SIZE)}`);
        notifyWarning();
        continue;
      }
      next.push(await fileToAttachment(file));
    }
    setAttachments(next);
    selectionChanged();
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((items) => items.filter((item) => item.id !== attachmentId));
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

        {attachments.length > 0 && (
          <div className="note-attachments">
            {attachments.map((attachment) => {
              const isImage = attachment.type.startsWith('image/');
              return (
                <div key={attachment.id} className={isImage ? 'note-attachment is-image' : 'note-attachment'}>
                  {isImage ? (
                    <img src={attachment.dataUrl} alt={attachment.name} />
                  ) : (
                    <IconPaperclip size={20} />
                  )}
                  <div className="note-attachment__meta">
                    <a href={attachment.dataUrl} download={attachment.name}>
                      {attachment.name}
                    </a>
                    <span>{formatBytes(attachment.size)}</span>
                  </div>
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
