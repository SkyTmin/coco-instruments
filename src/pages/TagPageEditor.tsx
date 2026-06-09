import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { NoteMarkdown } from '@/components/NoteMarkdown';
import { useCrop } from '@/components/CropProvider';
import { IconCheck, IconImage, IconPaperclip, IconPencil, IconTrash } from '@/components/icons';
import type { NoteAttachment } from '@/types';
import { useFinanceStore } from '@/store';
import {
  attachmentHref,
  fileToAttachment,
  formatBytes,
  MAX_ATTACHMENT_SIZE,
  MAX_ATTACHMENTS,
  MAX_IMAGE_SOURCE_SIZE,
} from '@/lib/images';
import { getTagPageRelations, normalizeNoteTitle } from '@/lib/notes-graph';
import { countTasks, toggleTaskInBody } from '@/lib/notes-markdown';
import { tagColor } from '@/lib/tag-color';
import { notifySuccess, notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';
import { NotesHelpButton } from '@/components/NotesGuide';

const AUTOSAVE_MS = 700;

function imageToken(a: NoteAttachment): string {
  return `![${a.name}](${attachmentHref(a) || `attachment:${a.id}`})`;
}
function appendImageTokens(body: string, images: NoteAttachment[]): string {
  if (!images.length) return body;
  const insert = images.map(imageToken).join('\n');
  return body.trim() ? `${body.trimEnd()}\n\n${insert}\n` : `${insert}\n`;
}
function removeImageFromBody(body: string, a: NoteAttachment): string {
  const id = a.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body
    .replace(new RegExp(`\\n?\\s*!\\[[^\\]]*\\]\\(attachment:${id}\\)\\s*\\n?`, 'g'), '\n')
    .replace(new RegExp(`\\n?\\s*!\\[${name}\\]\\([^)]*\\)\\s*\\n?`, 'g'), '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart();
}

const emptyAttachments: NoteAttachment[] = [];

function decodeTag(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return normalizeNoteTitle(decodeURIComponent(raw));
  } catch {
    return normalizeNoteTitle(raw);
  }
}

export function TagPageEditor() {
  const navigate = useNavigate();
  const { tag: rawTag } = useParams();
  const tag = decodeTag(rawTag);
  const hydrated = useFinanceStore((s) => s.hydrated);
  const notes = useFinanceStore((s) => s.notes);
  const tagPages = useFinanceStore((s) => s.tagPages);
  const upsertTagPage = useFinanceStore((s) => s.upsertTagPage);

  const page = useMemo(() => tagPages.find((p) => p.tag === tag), [tagPages, tag]);

  const [body, setBody] = useState(page?.body ?? '');
  const [attachments, setAttachments] = useState<NoteAttachment[]>(page?.attachments ?? emptyAttachments);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [attachmentError, setAttachmentError] = useState('');

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const loadedTag = useRef<string | null>(null);

  const latest = useRef({ body, attachments });
  latest.current = { body, attachments };
  const savedSnapshot = useRef(JSON.stringify({ body: page?.body ?? '', attachments: page?.attachments ?? [] }));

  // Load the stored page once it (and hydration) are available, or start a fresh
  // one in edit mode. Never re-clobbers edits in progress (guarded by loadedTag).
  useEffect(() => {
    if (!tag || !hydrated || loadedTag.current === tag) return;
    loadedTag.current = tag;
    setBody(page?.body ?? '');
    setAttachments(page?.attachments ?? emptyAttachments);
    savedSnapshot.current = JSON.stringify({ body: page?.body ?? '', attachments: page?.attachments ?? [] });
    setMode(page ? 'view' : 'edit');
  }, [tag, hydrated, page]);

  const snapshot = JSON.stringify({ body, attachments });
  const dirty = snapshot !== savedSnapshot.current;

  const persist = () => {
    const snap = JSON.stringify({ body: latest.current.body, attachments: latest.current.attachments });
    if (snap === savedSnapshot.current || !tag) return;
    upsertTagPage(tag, { body: latest.current.body, attachments: latest.current.attachments });
    savedSnapshot.current = snap;
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;

  useEffect(() => {
    if (mode !== 'edit' || !dirty) return;
    const t = window.setTimeout(() => persistRef.current(), AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [snapshot, mode, dirty]);

  useEffect(() => () => persistRef.current(), []);

  useLayoutEffect(() => {
    if (mode !== 'edit') return;
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(220, el.scrollHeight)}px`;
  }, [body, mode]);

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

  const rel = useMemo(() => getTagPageRelations(tag, notes), [tag, notes]);
  const cropImages = useCrop();

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setAttachmentError('');
    const picked = await cropImages(Array.from(files));
    if (!picked.length) return;
    const next = [...attachments];
    const inserted: NoteAttachment[] = [];
    for (const file of picked) {
      if (next.length >= MAX_ATTACHMENTS) {
        setAttachmentError(`Максимум ${MAX_ATTACHMENTS} вложений`);
        notifyWarning();
        break;
      }
      try {
        const a = await fileToAttachment(file);
        next.push(a);
        if (a.type.startsWith('image/')) inserted.push(a);
      } catch {
        const limit = file.type.startsWith('image/') ? MAX_IMAGE_SOURCE_SIZE : MAX_ATTACHMENT_SIZE;
        setAttachmentError(`${file.name}: исходник больше ${formatBytes(limit)} или не сжался до ${formatBytes(MAX_ATTACHMENT_SIZE)}`);
        notifyWarning();
      }
    }
    setAttachments(next);
    setBody((v) => appendImageTokens(v, inserted));
    selectionChanged();
  };

  const removeAttachment = (attachmentId: string) => {
    const a = attachments.find((x) => x.id === attachmentId);
    setAttachments((items) => items.filter((x) => x.id !== attachmentId));
    if (a?.type.startsWith('image/')) setBody((v) => removeImageFromBody(v, a));
    selectionChanged();
  };

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

  const toggleTask = (index: number) => {
    selectionChanged();
    const next = toggleTaskInBody(body, index);
    setBody(next);
    latest.current = { ...latest.current, body: next };
    window.setTimeout(() => persistRef.current(), 0);
  };

  const openNote = (noteId: string) => {
    persistRef.current();
    navigate(`/notes/${noteId}`);
  };
  const openMissing = (title: string) => {
    persistRef.current();
    const created = useFinanceStore.getState().addNote({ title, body: '' });
    notifySuccess();
    navigate(`/notes/${created.id}`);
  };
  const openTag = (t: string) => {
    persistRef.current();
    navigate(`/notes/tag/${encodeURIComponent(t)}`);
  };
  const finishEditing = () => {
    persistRef.current();
    notifySuccess();
    setMode('view');
  };

  if (hydrated && !tag) return <Navigate to="/notes" replace />;

  const imageAttachments = attachments.filter((a) => a.type.startsWith('image/'));
  const fileAttachments = attachments.filter((a) => !a.type.startsWith('image/'));
  const hasTasks = countTasks(body) > 0;
  const c = tagColor(tag);

  return (
    <Screen
      title={`#${tag}`}
      subtitle="Страница тега"
      action={
        <div className="notes-editor-actions">
          <NotesHelpButton />
          {mode === 'view' ? (
            <button
              className="icon-btn notes-edit notes-edit--text"
              onClick={() => {
                tapLight();
                setMode('edit');
              }}
              aria-label="Редактировать"
            >
              <IconPencil size={20} />
              <span>Править</span>
            </button>
          ) : (
            <button className="icon-btn notes-save" onClick={finishEditing} aria-label="Готово">
              <IconCheck size={21} />
            </button>
          )}
        </div>
      }
    >
      <div className="note-editor-page">
        <div className="tag-page__hint" style={{ color: c.stroke }}>
          🏷 Страница тега — пишите и добавляйте фото; ниже подтемы и заметки с этим тегом
        </div>

        {mode === 'edit' ? (
          <textarea
            ref={bodyRef}
            className="note-body-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Опишите тему. Связь: [[Заметка]], подтема: #тема/подтема, задача: - [ ] дело"
            rows={1}
            autoFocus={!page}
          />
        ) : body.trim() || attachments.length ? (
          <NoteMarkdown
            body={body}
            notes={notes}
            attachments={attachments}
            onOpenNote={openNote}
            onOpenMissing={openMissing}
            onTag={openTag}
            onToggleTask={toggleTask}
          />
        ) : (
          <div className="muted" style={{ padding: '8px 0' }}>
            Пока пусто. Нажмите «Править», чтобы описать тему.
          </div>
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
            {imageAttachments.map((a) => (
              <div key={a.id} className="note-thumb">
                <img src={attachmentHref(a)} alt={a.name} />
                <button onClick={() => removeAttachment(a.id)} aria-label="Убрать">
                  <IconTrash size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        {fileAttachments.length > 0 && (
          <div className="note-attachments">
            {fileAttachments.map((a) => (
              <div key={a.id} className="note-attachment">
                <IconPaperclip size={20} />
                <div className="note-attachment__meta">
                  <a href={attachmentHref(a)} target="_blank" rel="noreferrer">
                    {a.name}
                  </a>
                  <span>{formatBytes(a.size)}</span>
                </div>
                <a className="note-attachment__download" href={attachmentHref(a)} download={a.name}>
                  Скачать
                </a>
                {mode === 'edit' && (
                  <button className="icon-btn" onClick={() => removeAttachment(a.id)} aria-label="Убрать">
                    <IconTrash size={17} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {mode === 'view' && hasTasks && <TaskProgress body={body} />}

        {(rel.parent || rel.children.length > 0 || rel.tagged.length > 0) && (
          <div className="notes-relations notes-relations--editor">
            {rel.parent && (
              <div className="notes-relation-row">
                <span>Тема</span>
                <div>
                  <button
                    className="note-chip"
                    style={{ color: tagColor(rel.parent).stroke, background: tagColor(rel.parent).chipBg }}
                    onClick={() => openTag(rel.parent as string)}
                  >
                    #{rel.parent}
                  </button>
                </div>
              </div>
            )}
            {rel.children.length > 0 && (
              <div className="notes-relation-row">
                <span>Подтемы</span>
                <div>
                  {rel.children.map((ch) => (
                    <button
                      key={ch}
                      className="note-chip"
                      style={{ color: tagColor(ch).stroke, background: tagColor(ch).chipBg }}
                      onClick={() => openTag(ch)}
                    >
                      #{ch}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {rel.tagged.length > 0 && (
              <div className="notes-relation-row">
                <span>С этим тегом</span>
                <div>
                  {rel.tagged.map((n) => (
                    <button key={n.id} className="note-chip" onClick={() => openNote(n.id)}>
                      {n.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {mode === 'edit' && (
          <div className="note-foot">
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
