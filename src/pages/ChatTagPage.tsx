import { useMemo } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ChatThread } from '@/components/ChatThread';
import { NotesHelpButton } from '@/components/NotesGuide';
import { useFinanceStore } from '@/store';
import { getTagPageRelations, normalizeNoteTitle } from '@/lib/notes-graph';
import { materializeMessages } from '@/lib/notes-messages';
import { tagColor } from '@/lib/tag-color';
import { notifySuccess } from '@/lib/haptics';

function decodeTag(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return normalizeNoteTitle(decodeURIComponent(raw));
  } catch {
    return normalizeNoteTitle(raw);
  }
}

export function ChatTagPage() {
  const navigate = useNavigate();
  const { tag: rawTag } = useParams();
  const tag = decodeTag(rawTag);
  const hydrated = useFinanceStore((s) => s.hydrated);
  const notes = useFinanceStore((s) => s.notes);
  const tagPages = useFinanceStore((s) => s.tagPages);
  const addTagMessage = useFinanceStore((s) => s.addTagMessage);
  const updateTagMessage = useFinanceStore((s) => s.updateTagMessage);
  const removeTagMessage = useFinanceStore((s) => s.removeTagMessage);

  const page = useMemo(() => tagPages.find((p) => p.tag === tag), [tagPages, tag]);
  const messages = useMemo(() => (page ? materializeMessages(page) : []), [page]);
  const rel = useMemo(() => getTagPageRelations(tag, notes), [tag, notes]);
  const c = tagColor(tag);

  if (hydrated && !tag) return <Navigate to="/notes" replace />;

  const openTag = (t: string) => navigate(`/notes/tag/${encodeURIComponent(t)}`);

  const info = (
    <div className="chat-info">
      <div className="tag-page__hint" style={{ color: c.stroke }}>
        🏷 Страница тега как чат — пишите сообщения и кидайте фото
      </div>
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
              <button key={n.id} className="note-chip" onClick={() => navigate(`/notes/${n.id}`)}>
                {n.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="chat-page">
      <div className="chat-head">
        <div className="chat-title chat-title--static" style={{ color: c.stroke }}>
          #{tag}
        </div>
        <div className="chat-head__actions">
          <NotesHelpButton />
        </div>
      </div>

      <ChatThread
        messages={messages}
        notes={notes}
        header={info}
        emptyHint="Страница тега как чат. Напишите сообщение или прикрепите фото."
        onSend={(text, atts) => addTagMessage(tag, text, atts)}
        onEditMessage={(mid, text, atts) => updateTagMessage(tag, mid, text, atts)}
        onDeleteMessage={(mid) => removeTagMessage(tag, mid)}
        onOpenNote={(nid) => navigate(`/notes/${nid}`)}
        onOpenMissing={(t) => {
          const created = useFinanceStore.getState().addNote({ title: t, body: '' });
          notifySuccess();
          navigate(`/notes/${created.id}`);
        }}
        onTag={openTag}
      />
    </div>
  );
}
