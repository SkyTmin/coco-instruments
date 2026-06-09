import { describe, expect, it } from 'vitest';
import type { Note } from '@/types';
import {
  buildListGraph,
  buildNoteGraph,
  buildOverviewGraph,
  buildPeopleGraph,
  collapseDependencies,
  filterNoteGraph,
  getNoteRelations,
  getTagPageRelations,
  layoutNoteGraph,
  normalizeNoteTitle,
  parseNoteTags,
  parseWikiLinks,
  personNodeId,
  tagAncestry,
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
  });

  it('draws no tag nodes in the overview (tags live inside lists)', () => {
    expect(g.nodes.some((n) => n.kind === 'tag')).toBe(false);
    expect(g.links.some((l) => l.kind === 'tag')).toBe(false);
  });
});


describe('overview graph — people', () => {
  const lists = [{ id: 'health', name: 'Здоровье', createdAt: 0, updatedAt: 0 }];
  const notes = [note('l1', 'Идея', 'про Аню'), note('a1', 'Горло', '', 'health')];
  const people = [
    { id: 'p1', name: 'Аня', category: 'friend' as const, closeness: 3 as const, tags: [], favorite: false, createdAt: 0, updatedAt: 0 },
  ];
  const noteLinks = [{ id: 'ln1', personId: 'p1', noteId: 'l1', createdAt: 0 }];
  const g = buildOverviewGraph(notes, lists, people, noteLinks);

  it('collapses everyone into one "people" node linked to referencing notes', () => {
    const peopleNode = g.nodes.find((n) => n.id === 'people:all');
    expect(peopleNode?.kind).toBe('people');
    expect(peopleNode?.count).toBe(1);
    expect(g.links.some((l) => l.source === 'l1' && l.target === 'people:all' && l.kind === 'person-note')).toBe(true);
    // individual people are NOT separate nodes in the overview
    expect(g.nodes.some((n) => n.id === 'person:p1')).toBe(false);
  });

  it('omits the people node when there are no people', () => {
    const bare = buildOverviewGraph(notes, lists);
    expect(bare.nodes.some((n) => n.id === 'people:all')).toBe(false);
  });
});

describe('people graph (the "Люди" view)', () => {
  const people = [
    { id: 'p1', name: 'Аня', category: 'friend' as const, closeness: 3 as const, tags: [], favorite: false, createdAt: 0, updatedAt: 0 },
  ];
  const notes = [note('a1', 'Звонок Ане', ''), note('a2', 'Несвязанная заметка', '')];
  const data = {
    people,
    gifts: [],
    promises: [],
    conversations: [],
    meetIdeas: [],
    relations: [],
    noteLinks: [{ id: 'ln1', personId: 'p1', noteId: 'a1', createdAt: 0 }],
  };
  const g = buildPeopleGraph(notes, data);

  it('keeps people and only the notes linked to them', () => {
    expect(g.nodes.some((n) => n.id === personNodeId('p1'))).toBe(true);
    expect(g.nodes.some((n) => n.id === 'a1')).toBe(true);
    // a note not linked to anyone is left out of the people view
    expect(g.nodes.some((n) => n.id === 'a2')).toBe(false);
    expect(g.links.some((l) => l.kind === 'person-note' && l.target === 'a1')).toBe(true);
  });

  it('drops the note once its last person link is removed', () => {
    const detached = buildPeopleGraph(notes, { ...data, noteLinks: [] });
    expect(detached.nodes.some((n) => n.id === 'a1')).toBe(false);
    expect(detached.nodes.some((n) => n.id === personNodeId('p1'))).toBe(true);
  });
});

describe('collapse dependencies', () => {
  it('hides a note’s downstream dependencies, keeps the note and its parents', () => {
    // A -> B -> C ; collapsing B hides C (its dependency), keeps A (points to B).
    const graph = buildNoteGraph([note('a', 'A', '[[B]]'), note('b', 'B', '[[C]]'), note('c', 'C', '')]);
    const out = collapseDependencies(graph, new Set(['b']));
    expect(out.nodes.some((n) => n.id === 'b')).toBe(true);
    expect(out.nodes.some((n) => n.id === 'a')).toBe(true);
    expect(out.nodes.some((n) => n.id === 'c')).toBe(false);
  });

  it('keeps dependencies shared with another visible note', () => {
    const graph = buildNoteGraph([note('b', 'B', '[[C]]'), note('c', 'C', ''), note('d', 'D', '[[C]]')]);
    const out = collapseDependencies(graph, new Set(['b']));
    expect(out.nodes.some((n) => n.id === 'c')).toBe(true);
  });

  it('hides a private tag of a collapsed note', () => {
    const graph = buildNoteGraph([note('a', 'A', '#личное'), note('b', 'B', '#общее #личное')]);
    const out = collapseDependencies(graph, new Set(['b']));
    // #общее is private to B → hidden; #личное shared with A → stays
    expect(out.nodes.some((n) => n.id === 'tag:общее')).toBe(false);
    expect(out.nodes.some((n) => n.id === 'tag:личное')).toBe(true);
  });

  it('is a no-op when nothing is collapsed', () => {
    const graph = buildNoteGraph([note('a', 'A', '[[B]]')]);
    expect(collapseDependencies(graph, new Set())).toBe(graph);
  });
});

describe('tag pages', () => {
  const notes = [
    note('h', 'здоровье', 'Заметки о здоровье'),
    note('n1', 'Горло', '#здоровье/горло болит'),
    note('n2', 'Простуда', '#здоровье и #здоровье/нос'),
    note('n3', 'Работа', '#работа'),
  ];

  it('lists direct sub-topics and notes tagged with it', () => {
    const rel = getTagPageRelations('здоровье', notes);
    expect(rel.isTag).toBe(true);
    expect(rel.parent).toBeUndefined();
    expect(rel.children).toEqual(['здоровье/горло', 'здоровье/нос']);
    // tagged with exactly #здоровье
    expect(rel.tagged.map((n) => n.id)).toContain('n2');
    // a note with only the sub-tag #здоровье/горло is not "tagged" by the parent
    expect(rel.tagged.map((n) => n.id)).not.toContain('n1');
  });

  it('reports the parent topic of a sub-topic page', () => {
    const rel = getTagPageRelations('здоровье/горло', notes);
    expect(rel.parent).toBe('здоровье');
    expect(rel.children).toEqual([]);
    expect(rel.tagged.map((n) => n.id)).toContain('n1');
  });

  it('is not a tag page for an unused title', () => {
    expect(getTagPageRelations('случайное', notes).isTag).toBe(false);
  });
});

describe('hierarchical tags', () => {
  it('parses nested tags and trims stray slashes', () => {
    expect(parseNoteTags('#здоровье/горло болит, #а//б/ и #x но не #')).toEqual(['здоровье/горло', 'а/б', 'x']);
    expect(parseNoteTags('#дом-2 и C# не тег')).toEqual(['дом-2']);
  });

  it('expands a tag into its ancestor chain', () => {
    expect(tagAncestry('a/b/c')).toEqual(['a', 'a/b', 'a/b/c']);
    expect(tagAncestry('one')).toEqual(['one']);
  });

  it('links a note to the leaf tag and chains parent → child', () => {
    const graph = buildNoteGraph([note('n', 'T', '#здоровье/горло')]);
    expect(graph.nodes.some((x) => x.id === 'tag:здоровье')).toBe(true);
    expect(graph.nodes.some((x) => x.id === 'tag:здоровье/горло')).toBe(true);
    expect(graph.links.some((l) => l.source === 'n' && l.target === 'tag:здоровье/горло' && l.kind === 'tag')).toBe(true);
    expect(
      graph.links.some((l) => l.source === 'tag:здоровье' && l.target === 'tag:здоровье/горло' && l.kind === 'tag'),
    ).toBe(true);
  });
});

describe('list graph (Map of Content)', () => {
  const list = { id: 'health', name: 'Здоровье', createdAt: 0, updatedAt: 0 };
  const notes = [note('a1', 'Горло', '[[Насморк]]', 'health'), note('a2', 'Насморк', '', 'health')];
  const g = buildListGraph(list, notes);

  it('adds the notebook as a hub linked to every note', () => {
    const hub = g.nodes.find((n) => n.id === 'list:health');
    expect(hub?.kind).toBe('list');
    expect(hub?.count).toBe(2);
    expect(g.links.filter((l) => l.source === 'list:health' && l.kind === 'list')).toHaveLength(2);
    expect(hub?.degree).toBe(2);
  });

  it('keeps the notes and their wiki links intact', () => {
    expect(g.nodes.some((n) => n.id === 'a1' && n.kind === 'note')).toBe(true);
    expect(g.links.some((l) => l.source === 'a1' && l.target === 'a2' && l.kind === 'wiki')).toBe(true);
  });

  it('excludes index spokes from the local-graph neighbourhood', () => {
    // From a1 at depth 1: its wiki neighbour a2 is reached, but NOT the hub
    // (index links are not real adjacency), so the hub stays out of the local view.
    const local = filterNoteGraph(g, {
      mode: 'local',
      activeId: 'a1',
      depth: 1,
      showMissing: true,
      showTags: true,
      query: '',
    });
    expect(local.nodes.some((n) => n.id === 'a2')).toBe(true);
    expect(local.nodes.some((n) => n.id === 'list:health')).toBe(false);
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
