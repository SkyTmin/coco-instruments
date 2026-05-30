import { describe, expect, it } from 'vitest';
import type { Note } from '@/types';
import {
  buildNoteGraph,
  filterNoteGraph,
  getNoteRelations,
  normalizeNoteTitle,
  parseNoteTags,
  parseWikiLinks,
} from './notes-graph';

function note(id: string, title: string, body: string): Note {
  return { id, title, body, createdAt: 0, updatedAt: 0 };
}

describe('notes graph', () => {
  it('parses wiki links, aliases, headings and tags', () => {
    expect(parseWikiLinks('[[Проект]] [[Идея|алиас]] [[План#май]] [[Проект]]')).toEqual([
      'Проект',
      'Идея',
      'План',
    ]);
    expect(parseNoteTags('Текст #идея и (#дом-2), но не C#')).toEqual(['идея', 'дом-2']);
  });

  it('builds note, missing and tag nodes', () => {
    const graph = buildNoteGraph([
      note('a', 'Проект', 'Связан с [[Идея]] и [[Нет файла]] #работа'),
      note('b', 'Идея', 'Обратно к [[Проект]]'),
    ]);

    expect(graph.nodes.some((node) => node.id === 'a' && node.degree > 0)).toBe(true);
    expect(graph.nodes.some((node) => node.id === `missing:${normalizeNoteTitle('Нет файла')}`)).toBe(true);
    expect(graph.nodes.some((node) => node.id === 'tag:работа')).toBe(true);
    expect(graph.links.filter((link) => link.kind === 'wiki')).toHaveLength(3);
  });

  it('returns outgoing links and backlinks for the active note', () => {
    const notes = [
      note('a', 'Проект', 'Связан с [[Идея]] и [[Пусто]]'),
      note('b', 'Идея', 'Назад к [[Проект]]'),
    ];
    const relations = getNoteRelations(notes[0], notes);

    expect(relations.outgoing.map((item) => item.title)).toEqual(['Идея']);
    expect(relations.backlinks.map((item) => item.title)).toEqual(['Идея']);
    expect(relations.missing).toEqual(['Пусто']);
  });

  it('filters local graph by depth', () => {
    const notes = [
      note('a', 'A', '[[B]]'),
      note('b', 'B', '[[C]]'),
      note('c', 'C', ''),
    ];
    const graph = buildNoteGraph(notes);
    const local = filterNoteGraph(graph, {
      mode: 'local',
      activeId: 'a',
      depth: 1,
      showMissing: true,
      showTags: true,
      query: '',
    });

    expect(local.nodes.map((node) => node.label).sort()).toEqual(['A', 'B']);
  });
});
