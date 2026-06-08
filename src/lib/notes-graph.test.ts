import { describe, expect, it } from 'vitest';
import type { Note } from '@/types';
import {
  buildNoteGraph,
  buildOverviewGraph,
  filterNoteGraph,
  getNoteRelations,
  layoutNoteGraph,
  normalizeNoteTitle,
  parseNoteTags,
  parseWikiLinks,
  personNodeId,
} from './notes-graph';

function note(id: string, title: string, body: string, listId?: string): Note {
  return { id, title, body, listId, createdAt: 0, updatedAt: 0 };
}

describe('overview graph (notebooks)', () => {
  const lists = [{ id: 'health', name: 'Здоровье', createdAt: 0, updatedAt: 0 }];
  const notes = [
    note('a1', 'Горло', '#таблетки [[Насморк]]', 'health'),
    note('a2', 'Насморк', '#капли', 'health'),
    note('l1', 'Идея', 'смотри [[Горло]]'), // loose (no list)
  ];
  const g = buildOverviewGraph(notes, lists);

  it('collapses a list into one node with a note count', () => {
    const listNode = g.nodes.find((n) => n.id === 'list:health');
    expect(listNode?.kind).toBe('list');
    expect(listNode?.count).toBe(2);
    // member notes are NOT individual nodes
    expect(g.nodes.some((n) => n.id === 'a1')).toBe(false);
    expect(g.nodes.some((n) => n.id === 'a2')).toBe(false);
  });

  it('keeps loose notes and redirects links to list nodes', () => {
    expect(g.nodes.some((n) => n.id === 'l1' && n.kind === 'note')).toBe(true);
    // loose note → note inside the list → link points at the list node
    expect(g.links.some((l) => l.source === 'l1' && l.target === 'list:health' && l.kind === 'wiki')).toBe(true);
    // wiki between two notes of the same list collapses to a self-link → dropped
    expect(g.links.some((l) => l.source === 'list:health' && l.target === 'list:health')).toBe(false);
    // the list connects to the tags of its notes
    expect(g.links.some((l) => l.source === 'list:health' && l.kind === 'tag')).toBe(true);
    expect(g.nodes.some((n) => n.id === 'tag:таблетки')).toBe(true);
  });
});

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

  it('lays out nodes without overlaps and inside the stage', () => {
    const notes = [
      note('a', 'Хаб', '[[B]] [[C]] [[D]] #тег'),
      note('b', 'B', '[[C]] #тег'),
      note('c', 'C', '[[D]]'),
      note('d', 'D', ''),
      note('e', 'E', '[[Хаб]]'),
    ];
    const graph = buildNoteGraph(notes);
    const size = { width: 480, height: 600 };
    const points = layoutNoteGraph(graph, 'a', size);

    expect(points.length).toBe(graph.nodes.length);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(point.r - 0.01);
      expect(point.x).toBeLessThanOrEqual(size.width - point.r + 0.01);
      expect(point.y).toBeGreaterThanOrEqual(point.r - 0.01);
      expect(point.y).toBeLessThanOrEqual(size.height - point.r + 0.01);
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i];
        const b = points[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        // Collision resolution guarantees nodes never hard-overlap.
        expect(distance).toBeGreaterThanOrEqual(a.r + b.r - 0.5);
      }
    }
  });

  it('adds people, gifts, promises and linked notes to the graph', () => {
    const graph = buildNoteGraph([note('n1', 'Кофе', '#уют')], {
      people: [
        {
          id: 'p1',
          name: 'Аня',
          category: 'friend',
          closeness: 4,
          description: 'Подруга',
          tags: ['кофе'],
          favorite: true,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      gifts: [
        {
          id: 'g1',
          personId: 'p1',
          title: 'Книга',
          status: 'idea',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      promises: [
        {
          id: 'pr1',
          personId: 'p1',
          title: 'Скинуть ссылку',
          status: 'open',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      conversations: [],
      meetIdeas: [],
      relations: [],
      noteLinks: [{ id: 'ln1', personId: 'p1', noteId: 'n1', createdAt: 0 }],
    });

    expect(graph.nodes.some((node) => node.id === personNodeId('p1') && node.kind === 'person')).toBe(true);
    expect(graph.nodes.some((node) => node.kind === 'gift' && node.label === 'Книга')).toBe(true);
    expect(graph.nodes.some((node) => node.kind === 'promise' && node.label === 'Скинуть ссылку')).toBe(true);
    expect(graph.links.some((link) => link.kind === 'person-note' && link.target === 'n1')).toBe(true);
  });
});
