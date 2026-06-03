import type { Conversation, Gift, MeetIdea, Note, Person, PersonNoteLink, PersonPromise, PersonRelation } from '@/types';

export type NoteGraphNodeKind = 'note' | 'missing' | 'tag' | 'person' | 'gift' | 'promise' | 'event';
export type NoteGraphLinkKind =
  | 'wiki'
  | 'tag'
  | 'person-note'
  | 'person-gift'
  | 'person-promise'
  | 'person-event'
  | 'person-relation';

export interface NoteGraphNode {
  id: string;
  kind: NoteGraphNodeKind;
  label: string;
  note?: Note;
  person?: Person;
  degree: number;
  incoming: number;
  outgoing: number;
}

export interface NoteGraphLink {
  id: string;
  source: string;
  target: string;
  kind: NoteGraphLinkKind;
}

export interface NoteGraph {
  nodes: NoteGraphNode[];
  links: NoteGraphLink[];
}

export interface NoteRelations {
  outgoing: Note[];
  missing: string[];
  backlinks: Note[];
  tags: string[];
}

export interface NoteGraphPoint extends NoteGraphNode {
  x: number;
  y: number;
  r: number;
}

export const GRAPH_VIEW_BOX = { width: 520, height: 330 };

export interface PeopleGraphData {
  people: Person[];
  gifts: Gift[];
  promises: PersonPromise[];
  conversations: Conversation[];
  meetIdeas: MeetIdea[];
  relations: PersonRelation[];
  noteLinks: PersonNoteLink[];
}

const WIKI_LINK_RE = /\[\[([^[\]]+?)\]\]/g;
const TAG_RE = /(^|[^#\p{L}\p{N}_-])#([\p{L}\p{N}_][\p{L}\p{N}_-]{0,31})/gu;

export const personNodeId = (personId: string) => `person:${personId}`;
export const giftNodeId = (giftId: string) => `gift:${giftId}`;
export const promiseNodeId = (promiseId: string) => `promise:${promiseId}`;
export const eventNodeId = (kind: 'conversation' | 'meet', id: string) => `event:${kind}:${id}`;

export function normalizeNoteTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function parseWikiLinks(body: string): string[] {
  const links: string[] = [];
  for (const match of body.matchAll(WIKI_LINK_RE)) {
    const raw = match[1].split('|')[0].split('#')[0].trim();
    if (raw) links.push(raw);
  }
  return unique(links);
}

export function parseNoteTags(body: string): string[] {
  const tags: string[] = [];
  for (const match of body.matchAll(TAG_RE)) {
    const raw = match[2].trim().toLocaleLowerCase('ru-RU');
    if (raw) tags.push(raw);
  }
  return unique(tags);
}

export function buildNoteGraph(notes: Note[], peopleData?: PeopleGraphData): NoteGraph {
  const nodes = new Map<string, NoteGraphNode>();
  const links = new Map<string, NoteGraphLink>();
  const byTitle = new Map<string, Note>();

  for (const note of notes) {
    const key = normalizeNoteTitle(note.title);
    if (key && !byTitle.has(key)) byTitle.set(key, note);
    nodes.set(note.id, {
      id: note.id,
      kind: 'note',
      label: note.title,
      note,
      degree: 0,
      incoming: 0,
      outgoing: 0,
    });
  }

  const addLink = (source: string, target: string, kind: NoteGraphLink['kind']) => {
    if (source === target) return;
    const id = `${source}->${target}:${kind}`;
    if (!links.has(id)) links.set(id, { id, source, target, kind });
  };

  const ensureTagNode = (tag: string) => {
    const tagId = `tag:${tag}`;
    if (!nodes.has(tagId)) {
      nodes.set(tagId, {
        id: tagId,
        kind: 'tag',
        label: `#${tag}`,
        degree: 0,
        incoming: 0,
        outgoing: 0,
      });
    }
    return tagId;
  };

  for (const note of notes) {
    for (const title of parseWikiLinks(note.body)) {
      const target = byTitle.get(normalizeNoteTitle(title));
      if (target) {
        addLink(note.id, target.id, 'wiki');
        continue;
      }
      const missingId = `missing:${normalizeNoteTitle(title)}`;
      if (!nodes.has(missingId)) {
        nodes.set(missingId, {
          id: missingId,
          kind: 'missing',
          label: title,
          degree: 0,
          incoming: 0,
          outgoing: 0,
        });
      }
      addLink(note.id, missingId, 'wiki');
    }

    for (const tag of parseNoteTags(note.body)) {
      const tagId = ensureTagNode(tag);
      addLink(note.id, tagId, 'tag');
    }
  }

  if (peopleData) {
    const peopleById = new Map(peopleData.people.map((person) => [person.id, person]));

    for (const person of peopleData.people) {
      const id = personNodeId(person.id);
      nodes.set(id, {
        id,
        kind: 'person',
        label: person.name,
        person,
        degree: 0,
        incoming: 0,
        outgoing: 0,
      });
      for (const tag of person.tags) addLink(id, ensureTagNode(tag.toLocaleLowerCase('ru-RU')), 'tag');
    }

    for (const link of peopleData.noteLinks) {
      if (!peopleById.has(link.personId) || !nodes.has(link.noteId)) continue;
      addLink(personNodeId(link.personId), link.noteId, 'person-note');
    }

    for (const gift of peopleData.gifts) {
      if (!peopleById.has(gift.personId)) continue;
      const id = giftNodeId(gift.id);
      nodes.set(id, {
        id,
        kind: 'gift',
        label: gift.title,
        degree: 0,
        incoming: 0,
        outgoing: 0,
      });
      addLink(personNodeId(gift.personId), id, 'person-gift');
    }

    for (const promise of peopleData.promises) {
      if (!peopleById.has(promise.personId)) continue;
      const id = promiseNodeId(promise.id);
      nodes.set(id, {
        id,
        kind: 'promise',
        label: promise.title,
        degree: 0,
        incoming: 0,
        outgoing: 0,
      });
      addLink(personNodeId(promise.personId), id, 'person-promise');
    }

    for (const conversation of peopleData.conversations) {
      if (!peopleById.has(conversation.personId)) continue;
      const id = eventNodeId('conversation', conversation.id);
      nodes.set(id, {
        id,
        kind: 'event',
        label: conversation.title,
        degree: 0,
        incoming: 0,
        outgoing: 0,
      });
      addLink(personNodeId(conversation.personId), id, 'person-event');
    }

    for (const meet of peopleData.meetIdeas) {
      if (!peopleById.has(meet.personId)) continue;
      const id = eventNodeId('meet', meet.id);
      nodes.set(id, {
        id,
        kind: 'event',
        label: meet.title,
        degree: 0,
        incoming: 0,
        outgoing: 0,
      });
      addLink(personNodeId(meet.personId), id, 'person-event');
    }

    for (const relation of peopleData.relations) {
      if (!peopleById.has(relation.fromPersonId) || !peopleById.has(relation.toPersonId)) continue;
      addLink(personNodeId(relation.fromPersonId), personNodeId(relation.toPersonId), 'person-relation');
    }
  }

  for (const link of links.values()) {
    const source = nodes.get(link.source);
    const target = nodes.get(link.target);
    if (!source || !target) continue;
    source.outgoing += 1;
    source.degree += 1;
    target.incoming += 1;
    target.degree += 1;
  }

  return { nodes: Array.from(nodes.values()), links: Array.from(links.values()) };
}

export function getNoteRelations(note: Note | undefined, notes: Note[]): NoteRelations {
  if (!note) return { outgoing: [], missing: [], backlinks: [], tags: [] };
  const byTitle = new Map(notes.map((item) => [normalizeNoteTitle(item.title), item]));
  const outgoing: Note[] = [];
  const missing: string[] = [];

  for (const title of parseWikiLinks(note.body)) {
    const target = byTitle.get(normalizeNoteTitle(title));
    if (target && target.id !== note.id) outgoing.push(target);
    else missing.push(title);
  }

  const ownKey = normalizeNoteTitle(note.title);
  const backlinks = notes.filter((candidate) => {
    if (candidate.id === note.id) return false;
    return parseWikiLinks(candidate.body).some((title) => normalizeNoteTitle(title) === ownKey);
  });

  return {
    outgoing,
    missing,
    backlinks,
    tags: parseNoteTags(note.body),
  };
}

export function filterNoteGraph(
  graph: NoteGraph,
  options: {
    mode: 'global' | 'local';
    activeId?: string;
    depth: number;
    showMissing: boolean;
    showTags: boolean;
    showPeople?: boolean;
    showDetails?: boolean;
    query: string;
  },
): NoteGraph {
  const query = normalizeNoteTitle(options.query);
  const allowed = new Set<string>();
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  if (options.mode === 'local' && options.activeId && nodeById.has(options.activeId)) {
    allowed.add(options.activeId);
    let frontier = [options.activeId];
    for (let step = 0; step < options.depth; step++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const link of graph.links) {
          const neighbor =
            link.source === id ? link.target : link.target === id ? link.source : undefined;
          if (neighbor && !allowed.has(neighbor)) {
            allowed.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
  } else {
    for (const node of graph.nodes) allowed.add(node.id);
  }

  const nodes = graph.nodes.filter((node) => {
    if (!allowed.has(node.id)) return false;
    if (!options.showMissing && node.kind === 'missing') return false;
    if (!options.showTags && node.kind === 'tag') return false;
    if (options.showPeople === false && node.kind === 'person') return false;
    if (options.showPeople === false && ['gift', 'promise', 'event'].includes(node.kind)) return false;
    if (options.showDetails === false && ['gift', 'promise', 'event'].includes(node.kind)) return false;
    if (!query) return true;
    const body = node.note?.body ?? '';
    const person = node.person ? `${node.person.description ?? ''} ${node.person.tags.join(' ')}` : '';
    return normalizeNoteTitle(`${node.label} ${body} ${person}`).includes(query);
  });

  const visible = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    links: graph.links.filter((link) => visible.has(link.source) && visible.has(link.target)),
  };
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function layoutNoteGraph(graph: NoteGraph, activeId?: string): NoteGraphPoint[] {
  const { width, height } = GRAPH_VIEW_BOX;
  const centerX = width / 2;
  const centerY = height / 2;
  const nodes = graph.nodes.map((node, index) => {
    const angle = ((hash(node.id) % 360) / 180) * Math.PI;
    const ring = 78 + ((index % 4) * 23);
    const baseRadius =
      node.kind === 'person' ? 16 : node.kind === 'gift' || node.kind === 'promise' || node.kind === 'event' ? 8 : 10;
    return {
      ...node,
      x: centerX + Math.cos(angle) * ring,
      y: centerY + Math.sin(angle) * ring,
      r: Math.min(node.kind === 'person' ? 28 : 24, baseRadius + node.degree * 2.1 + (node.id === activeId ? 4 : 0)),
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (let tick = 0; tick < 80; tick++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x || 0.01;
        const dy = a.y - b.y || 0.01;
        const distanceSq = dx * dx + dy * dy;
        const minDistance = a.r + b.r + 34;
        if (distanceSq > minDistance * minDistance) continue;
        const distance = Math.sqrt(distanceSq);
        const force = (minDistance - distance) * 0.018;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        a.x += fx;
        a.y += fy;
        b.x -= fx;
        b.y -= fy;
      }
    }

    for (const link of graph.links) {
      const source = byId.get(link.source);
      const target = byId.get(link.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const preferred =
        link.kind === 'tag'
          ? 82
          : link.kind === 'person-relation'
            ? 132
            : link.kind.startsWith('person-')
              ? 106
              : 112;
      const force = (distance - preferred) * 0.025;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      source.x += fx;
      source.y += fy;
      target.x -= fx;
      target.y -= fy;
    }

    for (const node of nodes) {
      const centerForce = node.id === activeId ? 0.08 : 0.018;
      node.x += (centerX - node.x) * centerForce;
      node.y += (centerY - node.y) * centerForce;
      node.x = Math.max(36, Math.min(width - 36, node.x));
      node.y = Math.max(38, Math.min(height - 38, node.y));
    }
  }

  return nodes;
}
