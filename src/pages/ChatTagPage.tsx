import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ChatThread } from '@/components/ChatThread';
import { NotesGuide } from '@/components/NotesGuide';
import { Sheet } from '@/components/ui';
import { IconDots } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { getTagPageRelations, normalizeNoteTitle } from '@/lib/notes-graph';
import { materializeMessages } from '@/lib/notes-messages';
import { notifySuccess, tapLight } from '@/lib/haptics';

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

  const [menu, setMenu] = useState(false);
  const [guide, setGuide] = useState(false);
  const [taggedSheet, setTaggedSheet] = useState(false);

  if (hydrated && !tag) return <Navigate to="/notes" replace />;

  const openTag = (t: string) => navigate(`/notes/tag/${encodeURIComponent(t)}`);

  return (
    <div className="chat-page">
      <div className="chat-head">
        <div className="chat-title chat-title--static note-meta__tag-title">#{tag}</div>
        <button className="icon-btn" onClick={() => { tapLight(); setMenu(true); }} aria-label="Меню тега">
          <IconDots size={20} />
        </button>
      </div>

      <div className="note-meta">
        {rel.parent && (
          <button className="note-meta__chip note-meta__tag" onClick={() => openTag(rel.parent as string)}>
            ↑ #{rel.parent}
          </button>
        )}
        {rel.children.map((ch) => (
          <button key={ch} className="note-meta__chip note-meta__tag" onClick={() => openTag(ch)}>
            #{ch}
          </button>
        ))}
        {rel.tagged.length > 0 && (
          <button className="note-meta__chip note-meta__links" onClick={() => { tapLight(); setTaggedSheet(true); }}>
            📝 С этим тегом · {rel.tagged.length}
          </button>
        )}
      </div>

      <ChatThread
        messages={messages}
        notes={notes}
        emptyTitle={`Тема «${tag}»`}
        placeholder="Мысль по теме…"
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

      {menu && (
        <Sheet title={`#${tag}`} onClose={() => setMenu(false)}>
          <div className="stack">
            <p className="links-lead">Это страница тега — общее пространство для всего, что помечено #{tag}.</p>
            <button className="btn btn--ghost btn--block" onClick={() => { setMenu(false); setGuide(true); }}>
              Как это работает
            </button>
          </div>
        </Sheet>
      )}

      {guide && <NotesGuide onClose={() => setGuide(false)} />}

      {taggedSheet && (
        <Sheet title={`Заметки с тегом #${tag}`} onClose={() => setTaggedSheet(false)}>
          <div className="sheet-list">
            {rel.tagged.map((n) => (
              <button key={n.id} className="flow-row" onClick={() => { setTaggedSheet(false); navigate(`/notes/${n.id}`); }}>
                <span className="flow-row__name">{n.title}</span>
                <span className="flow-row__amount">›</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
