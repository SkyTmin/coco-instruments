import { Fragment, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Note, NoteAttachment } from '@/types';
import { normalizeNoteTitle } from '@/lib/notes-graph';
import { parseBlocks, safeHref, safeImageSrc } from '@/lib/notes-markdown';
import type { Block, Inline } from '@/lib/notes-markdown';
import { tagColor } from '@/lib/tag-color';

interface Props {
  body: string;
  notes: Note[];
  attachments: NoteAttachment[];
  onOpenNote: (id: string) => void;
  onOpenMissing: (title: string) => void;
  onTag: (tag: string) => void;
  onToggleTask: (index: number) => void;
}

function resolveImage(src: string, attachments: NoteAttachment[]): string | undefined {
  if (src.startsWith('attachment:')) {
    const id = src.slice('attachment:'.length);
    const found = attachments.find((a) => a.id === id);
    return found?.url ?? found?.dataUrl;
  }
  return safeImageSrc(src);
}

export function NoteMarkdown({
  body,
  notes,
  attachments,
  onOpenNote,
  onOpenMissing,
  onTag,
  onToggleTask,
}: Props) {
  const blocks = useMemo(() => parseBlocks(body), [body]);
  const byTitle = useMemo(
    () => new Map(notes.map((n) => [normalizeNoteTitle(n.title), n] as const)),
    [notes],
  );

  const renderInline = (nodes: Inline[]): ReactNode =>
    nodes.map((node, i) => {
      switch (node.t) {
        case 'text':
          return <Fragment key={i}>{node.v}</Fragment>;
        case 'br':
          return <br key={i} />;
        case 'strong':
          return <strong key={i}>{renderInline(node.c)}</strong>;
        case 'em':
          return <em key={i}>{renderInline(node.c)}</em>;
        case 'del':
          return <del key={i}>{renderInline(node.c)}</del>;
        case 'code':
          return (
            <code key={i} className="md-code">
              {node.v}
            </code>
          );
        case 'tag': {
          const tc = tagColor(node.v);
          return (
            <button
              key={i}
              type="button"
              className="md-tag"
              style={{ color: tc.stroke, background: tc.chipBg }}
              onClick={() => onTag(node.v)}
            >
              #{node.v}
            </button>
          );
        }
        case 'link': {
          const href = safeHref(node.href);
          return href ? (
            <a key={i} className="md-link" href={href} target="_blank" rel="noreferrer">
              {node.label}
            </a>
          ) : (
            <Fragment key={i}>{node.label}</Fragment>
          );
        }
        case 'wiki': {
          const found = byTitle.get(normalizeNoteTitle(node.target));
          const label = node.alias || node.target;
          if (found) {
            return (
              <button key={i} type="button" className="md-wiki" onClick={() => onOpenNote(found.id)}>
                {label}
              </button>
            );
          }
          return (
            <button
              key={i}
              type="button"
              className="md-wiki md-wiki--missing"
              onClick={() => onOpenMissing(node.target)}
            >
              {label}
            </button>
          );
        }
        case 'image': {
          const src = resolveImage(node.src, attachments);
          return src ? (
            <img key={i} className="md-inline-img" src={src} alt={node.alt} loading="lazy" />
          ) : (
            <Fragment key={i}>{node.alt}</Fragment>
          );
        }
        default:
          return null;
      }
    });

  const renderBlock = (block: Block, key: number): ReactNode => {
    switch (block.t) {
      case 'h': {
        const Tag = (`h${block.level}` as 'h1' | 'h2' | 'h3');
        return (
          <Tag key={key} className={`md-h md-h${block.level}`}>
            {renderInline(block.c)}
          </Tag>
        );
      }
      case 'p':
        return (
          <p key={key} className="md-p">
            {renderInline(block.c)}
          </p>
        );
      case 'ul':
        return (
          <ul key={key} className="md-ul">
            {block.items.map((item, i) => (
              <li key={i}>{renderInline(item)}</li>
            ))}
          </ul>
        );
      case 'ol':
        return (
          <ol key={key} className="md-ol">
            {block.items.map((item, i) => (
              <li key={i}>{renderInline(item)}</li>
            ))}
          </ol>
        );
      case 'tasks':
        return (
          <ul key={key} className="md-tasks">
            {block.items.map((item) => (
              <li key={item.index} className={item.checked ? 'is-done' : ''}>
                <button
                  type="button"
                  className={`md-task-box${item.checked ? ' is-checked' : ''}`}
                  onClick={() => onToggleTask(item.index)}
                  aria-label={item.checked ? 'Снять отметку' : 'Отметить'}
                >
                  {item.checked && (
                    <svg viewBox="0 0 24 24" width="14" height="14">
                      <path
                        d="M20 6 9 17l-5-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
                <span>{renderInline(item.c)}</span>
              </li>
            ))}
          </ul>
        );
      case 'quote':
        return (
          <blockquote key={key} className="md-quote">
            {renderInline(block.c)}
          </blockquote>
        );
      case 'code':
        return (
          <pre key={key} className="md-pre">
            <code>{block.v}</code>
          </pre>
        );
      case 'img': {
        const src = resolveImage(block.src, attachments);
        if (!src) return null;
        return (
          <a key={key} className="md-img" href={src} target="_blank" rel="noreferrer">
            <img src={src} alt={block.alt} loading="lazy" />
          </a>
        );
      }
      case 'hr':
        return <hr key={key} className="md-hr" />;
      default:
        return null;
    }
  };

  if (!blocks.length) {
    return <p className="md-empty">Пустая заметка</p>;
  }

  return <div className="md-body">{blocks.map(renderBlock)}</div>;
}
