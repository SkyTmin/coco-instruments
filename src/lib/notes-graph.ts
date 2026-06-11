import type {
  Conversation,
  Gift,
  MeetIdea,
  Note,
  NoteList,
  Person,
  PersonNoteLink,
  PersonPromise,
  PersonRelation,
} from '@/types';

export type NoteGraphNodeKind =
  | 'note'
  | 'missing'
  | 'tag'
  | 'person'
  | 'gift'
  | 'promise'
  | 'event'
  | 'list'
  | 'people';
export type NoteGraphLinkKind =
  | 'wiki'
  | 'tag'
  | 'list'
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
  /** For 'list' nodes: the notebook and how many notes it holds. */
  list?: NoteList;
  count?: number;
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
  /** Live velocity carried by the cooling simulation. */
  vx: number;
  vy: number;
}

export interface GraphSize {
  width: number;
  height: number;
}

/** Default coordinate space (portrait — matches the tall mobile stage). The
 *  page measures the real stage and overrides this so the graph fills it. */
export const GRAPH_VIEW_BOX: GraphSize = { width: 480, height: 600 };

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
// Tags may be hierarchical, Obsidian-style: #парент/чайлд/внук.
const TAG_RE = /(^|[^#\p{L}\p{N}_-])#([\p{L}\p{N}_][\p{L}\p{N}_/-]{0,63})/gu;

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
    // Normalise hierarchy: lowercase, collapse `//`, drop leading/trailing `/`.
    const raw = match[2]
      .toLocaleLowerCase('ru-RU')
      .replace(/\/{2,}/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .trim();
    if (raw) tags.push(raw);
  }
  return unique(tags);
}

/** Ancestor chain of a hierarchical tag (Obsidian-style `#parent/child`):
 *  `a/b/c` → `['a', 'a/b', 'a/b/c']`. A flat tag returns just itself. */
export function tagAncestry(tag: string): string[] {
  const parts = tag.split('/').filter(Boolean);
  const chain: string[] = [];
  let prefix = '';
  for (const part of parts) {
    prefix = prefix ? `${prefix}/${part}` : part;
    chain.push(prefix);
  }
  return chain;
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

  // Hierarchical tags: link the source to the full-path tag, then chain
  // parent → child so a top-level tag becomes a hub over its sub-tags.
  const addTag = (fromId: string, tag: string) => {
    const chain = tagAncestry(tag);
    if (!chain.length) return;
    addLink(fromId, ensureTagNode(tag), 'tag');
    for (let i = 1; i < chain.length; i++)
      addLink(ensureTagNode(chain[i - 1]), ensureTagNode(chain[i]), 'tag');
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

    for (const tag of parseNoteTags(note.body)) addTag(note.id, tag);
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
      for (const tag of person.tags) addTag(id, tag.toLocaleLowerCase('ru-RU'));
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
      addLink(
        personNodeId(relation.fromPersonId),
        personNodeId(relation.toPersonId),
        'person-relation',
      );
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

export const PEOPLE_NODE_ID = 'people:all';

/** Top-level notes graph: each list is a single node, plus the loose (unlisted)
 *  notes and their tags / wiki links. Links pointing at a note inside a list are
 *  redirected to that list's node, so a whole notebook reads as one circle. All
 *  people collapse into one "Люди" node (tap to open the full people graph),
 *  connected to every note/notebook that references someone. */
export function buildOverviewGraph(
  notes: Note[],
  lists: NoteList[],
  people: Person[] = [],
  noteLinks: PersonNoteLink[] = [],
): NoteGraph {
  const listById = new Map(lists.map((l) => [l.id, l]));
  const repId = (note: Note) =>
    note.listId && listById.has(note.listId) ? `list:${note.listId}` : note.id;

  const nodes = new Map<string, NoteGraphNode>();
  const links = new Map<string, NoteGraphLink>();
  const byTitle = new Map<string, Note>();
  for (const note of notes) {
    const key = normalizeNoteTitle(note.title);
    if (key && !byTitle.has(key)) byTitle.set(key, note);
  }

  const counts = new Map<string, number>();
  for (const note of notes) {
    if (note.listId && listById.has(note.listId))
      counts.set(note.listId, (counts.get(note.listId) ?? 0) + 1);
  }
  for (const list of lists) {
    nodes.set(`list:${list.id}`, {
      id: `list:${list.id}`,
      kind: 'list',
      label: list.emoji ? `${list.emoji} ${list.name}` : list.name,
      list,
      count: counts.get(list.id) ?? 0,
      degree: 0,
      incoming: 0,
      outgoing: 0,
    });
  }
  for (const note of notes) {
    if (note.listId && listById.has(note.listId)) continue;
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
  // Tags are an inside-the-list detail (they show in a list's own graph and on
  // tag pages), so the overview stays high-level: lists, loose notes and people.
  for (const note of notes) {
    const src = repId(note);
    for (const title of parseWikiLinks(note.body)) {
      const target = byTitle.get(normalizeNoteTitle(title));
      if (target) {
        addLink(src, repId(target), 'wiki');
        continue;
      }
      const missingId = `missing:${normalizeNoteTitle(title)}`;
      if (!nodes.has(missingId))
        nodes.set(missingId, {
          id: missingId,
          kind: 'missing',
          label: title,
          degree: 0,
          incoming: 0,
          outgoing: 0,
        });
      addLink(src, missingId, 'wiki');
    }
  }

  // All people collapse into one node; connect it to whatever references them.
  if (people.length) {
    nodes.set(PEOPLE_NODE_ID, {
      id: PEOPLE_NODE_ID,
      kind: 'people',
      label: '👥 Люди',
      count: people.length,
      degree: 0,
      incoming: 0,
      outgoing: 0,
    });
    const repById = new Map(notes.map((note) => [note.id, repId(note)]));
    for (const link of noteLinks) {
      const src = repById.get(link.noteId);
      if (src) addLink(src, PEOPLE_NODE_ID, 'person-note');
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

/** A single notebook's inner graph with the notebook itself as a central index
 *  ("Map of Content"): the list node links to every note, so the notebook reads
 *  as a hub and loose notes are never stranded — while wiki/tag links still pull
 *  their own clusters together. */
export function buildListGraph(list: NoteList, notes: Note[]): NoteGraph {
  const base = buildNoteGraph(notes);
  const hubId = `list:${list.id}`;
  const hub: NoteGraphNode = {
    id: hubId,
    kind: 'list',
    label: list.emoji ? `${list.emoji} ${list.name}` : list.name,
    list,
    count: notes.length,
    degree: 0,
    incoming: 0,
    outgoing: 0,
  };
  const nodes = [hub, ...base.nodes];
  const links = base.links.slice();
  for (const note of notes) {
    links.push({ id: `${hubId}->${note.id}:list`, source: hubId, target: note.id, kind: 'list' });
  }
  // Recompute degrees over the augmented graph.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    node.degree = 0;
    node.incoming = 0;
    node.outgoing = 0;
  }
  for (const link of links) {
    const source = byId.get(link.source);
    const target = byId.get(link.target);
    if (!source || !target) continue;
    source.outgoing += 1;
    source.degree += 1;
    target.incoming += 1;
    target.degree += 1;
  }
  return { nodes, links };
}

/** People-focused graph (the "Люди" view): every person — with their gifts,
 *  promises, events and inter-person relations — plus ONLY the notes actually
 *  linked to someone. Unrelated notes are left out, so detaching a person from
 *  a note also removes that note from this view. */
export function buildPeopleGraph(notes: Note[], peopleData: PeopleGraphData): NoteGraph {
  const linkedNoteIds = new Set(peopleData.noteLinks.map((link) => link.noteId));
  const peopleNotes = notes.filter((note) => linkedNoteIds.has(note.id));
  const graph = buildNoteGraph(peopleNotes, peopleData);

  // A people-note may [[link]] to a note outside the circle — that would show
  // as a dashed "missing" placeholder. Drop those so the view stays about people.
  const drop = new Set(
    graph.nodes.filter((node) => node.kind === 'missing').map((node) => node.id),
  );
  if (!drop.size) return graph;

  const nodes = graph.nodes.filter((node) => !drop.has(node.id));
  for (const node of nodes) {
    node.degree = 0;
    node.incoming = 0;
    node.outgoing = 0;
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const links = graph.links.filter((link) => byId.has(link.source) && byId.has(link.target));
  for (const link of links) {
    const source = byId.get(link.source);
    const target = byId.get(link.target);
    if (!source || !target) continue;
    source.outgoing += 1;
    source.degree += 1;
    target.incoming += 1;
    target.degree += 1;
  }
  return { nodes, links };
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

export interface TagPageRelations {
  /** This title is used as a tag somewhere, or has sub-topics → it's a tag page. */
  isTag: boolean;
  /** Parent topic, if the title is itself a sub-topic (`здоровье/горло` → `здоровье`). */
  parent?: string;
  /** Direct sub-topics one level down (`здоровье` → `здоровье/горло`, `здоровье/нос`). */
  children: string[];
  /** Notes carrying this exact tag in their body. */
  tagged: Note[];
}

/** A tag behaves like a page: this gathers everything that page should show —
 *  its sub-topics, its parent topic, and every note tagged with it. */
export function getTagPageRelations(title: string, notes: Note[]): TagPageRelations {
  const key = normalizeNoteTitle(title);
  if (!key) return { isTag: false, children: [], tagged: [] };
  const childSet = new Set<string>();
  const tagged = new Map<string, Note>();
  const prefix = `${key}/`;

  for (const note of notes) {
    for (const tag of parseNoteTags(note.body)) {
      if (tag === key) tagged.set(note.id, note);
      if (tag.startsWith(prefix)) {
        // Keep only the next segment down so we list direct children, not grandchildren.
        const directChild = key + '/' + tag.slice(prefix.length).split('/')[0];
        childSet.add(directChild);
      }
    }
  }

  const parent = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : undefined;
  const children = Array.from(childSet).sort((a, b) => a.localeCompare(b, 'ru'));
  return {
    isTag: tagged.size > 0 || children.length > 0,
    parent,
    children,
    tagged: Array.from(tagged.values()),
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
          // Index spokes (notebook → every note) aren't real adjacency — skip
          // them so a local graph reflects genuine links, not the MOC hub.
          if (link.kind === 'list') continue;
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
    if (options.showPeople === false && ['gift', 'promise', 'event'].includes(node.kind))
      return false;
    if (options.showDetails === false && ['gift', 'promise', 'event'].includes(node.kind))
      return false;
    if (!query) return true;
    const body = node.note?.body ?? '';
    const person = node.person
      ? `${node.person.description ?? ''} ${node.person.tags.join(' ')}`
      : '';
    return normalizeNoteTitle(`${node.label} ${body} ${person}`).includes(query);
  });

  const visible = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    links: graph.links.filter((link) => visible.has(link.source) && visible.has(link.target)),
  };
}

/** Hide the "dependency closure" of every collapsed node — the things it points
 *  to (wiki-links, tags) that only exist because of it. A node is hidden when
 *  every edge pointing AT it comes from a collapsed-or-hidden node; nodes that
 *  merely link to the collapsed node (its parents) and shared nodes stay. */
export function collapseDependencies(graph: NoteGraph, collapsed: ReadonlySet<string>): NoteGraph {
  if (!collapsed.size) return graph;
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) incoming.set(node.id, []);
  for (const link of graph.links) incoming.get(link.target)?.push(link.source);

  const hidden = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      if (collapsed.has(node.id) || hidden.has(node.id)) continue;
      const sources = incoming.get(node.id);
      if (!sources || sources.length === 0) continue; // a root / not depended-on → keep
      if (sources.every((s) => collapsed.has(s) || hidden.has(s))) {
        hidden.add(node.id);
        changed = true;
      }
    }
  }
  if (!hidden.size) return graph;
  const nodes = graph.nodes.filter((node) => !hidden.has(node.id));
  const visible = new Set(nodes.map((node) => node.id));
  const links = graph.links.filter((link) => visible.has(link.source) && visible.has(link.target));
  return { nodes, links };
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// --- Force-directed simulation (Obsidian-style: charge + links + collision) --
// One `simulationStep` is shared by the initial settle and the live, cooling
// loop in the page, so the graph opens already-relaxed and stays consistent.

const CHARGE = 200; // long-range repulsion strength (1/distance falloff)
const CHARGE_MIN_DIST = 16;
const CENTER_PULL = 0.011; // gentle gravity toward the middle
const FRICTION = 0.82; // velocity decay per tick
const VELOCITY_MAX = 48;
const COLLIDE_PAD = 16; // breathing room enforced between every pair
const BOUNDS_PAD = 6;

function linkDistance(kind: NoteGraphLinkKind): number {
  if (kind === 'tag') return 92;
  if (kind === 'list') return 150;
  if (kind === 'person-relation') return 188;
  if (kind.startsWith('person-')) return 124;
  return 150; // wiki
}

function linkStiffness(kind: NoteGraphLinkKind): number {
  if (kind === 'tag') return 0.045;
  if (kind === 'list') return 0.028; // gentle: gather notes around the index hub without overpowering wiki clusters
  if (kind === 'person-relation') return 0.05;
  if (kind.startsWith('person-')) return 0.06;
  return 0.08; // wiki — keep linked notes close
}

/** Visual radius of a node, scaled by how connected it is. */
export function nodeRadius(node: Pick<NoteGraphNode, 'kind' | 'degree' | 'count'>): number {
  // A whole notebook (or all people) collapsed to one node — the biggest,
  // sized by how many items it stands for.
  if (node.kind === 'list' || node.kind === 'people') {
    return Math.min(48, 20 + (node.count ?? 0) * 2.2 + node.degree * 1.1);
  }
  const isDetail = node.kind === 'gift' || node.kind === 'promise' || node.kind === 'event';
  // Notes are first-class here, so they get the same heft as people.
  const big = node.kind === 'person' || node.kind === 'note';
  const base = big ? 15 : node.kind === 'tag' ? 8 : isDetail ? 7 : 9;
  const cap = big ? 34 : node.kind === 'tag' ? 16 : isDetail ? 15 : 28;
  return Math.min(cap, base + node.degree * 1.8);
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Advance the simulation by one tick (mutates node x/y/vx/vy in place).
 *  `fixed` nodes (the one being dragged + any you've arranged) hold their
 *  position; `draggingId` additionally makes its links trail it more tightly. */
export function simulationStep(
  nodes: NoteGraphPoint[],
  links: NoteGraphLink[],
  size: GraphSize,
  alpha: number,
  fixed?: ReadonlySet<string>,
  draggingId?: string | null,
): void {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const isFixed = (id: string) => (fixed ? fixed.has(id) : false);

  // Many-body repulsion — keeps unrelated clusters from piling up.
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let raw = Math.sqrt(dx * dx + dy * dy);
      if (raw < 0.01) {
        dx = (hash(a.id + b.id) % 100) / 100 - 0.5;
        dy = (hash(b.id + a.id) % 100) / 100 - 0.5;
        raw = Math.sqrt(dx * dx + dy * dy) || 1;
      }
      const dist = Math.max(CHARGE_MIN_DIST, raw);
      const force = (CHARGE / dist) * alpha;
      const fx = (dx / raw) * force;
      const fy = (dy / raw) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // Link springs — pull connected nodes toward a comfortable distance.
  for (const link of links) {
    const source = byId.get(link.source);
    const target = byId.get(link.target);
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    let stiffness = linkStiffness(link.kind);
    if (draggingId && (link.source === draggingId || link.target === draggingId)) stiffness *= 1.7;
    const force = (dist - linkDistance(link.kind)) * stiffness * alpha;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    source.vx += fx;
    source.vy += fy;
    target.vx -= fx;
    target.vy -= fy;
  }

  // Gravity + integration.
  for (const node of nodes) {
    if (isFixed(node.id)) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx += (cx - node.x) * CENTER_PULL * alpha;
    node.vy += (cy - node.y) * CENTER_PULL * alpha;
    node.vx = clamp(node.vx * FRICTION, -VELOCITY_MAX, VELOCITY_MAX);
    node.vy = clamp(node.vy * FRICTION, -VELOCITY_MAX, VELOCITY_MAX);
    node.x += node.vx;
    node.y += node.vy;
  }

  // Hard collision resolution — guarantees nodes never overlap (the big
  // readability win) regardless of how the soft forces settle.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const min = a.r + b.r + COLLIDE_PAD;
        if (dist >= min || dist === 0) continue;
        const push = (min - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        if (!isFixed(a.id)) {
          a.x -= ux * push;
          a.y -= uy * push;
        }
        if (!isFixed(b.id)) {
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }
  }

  // Keep everything inside the stage.
  for (const node of nodes) {
    node.x = clamp(node.x, node.r + BOUNDS_PAD, size.width - node.r - BOUNDS_PAD);
    node.y = clamp(node.y, node.r + BOUNDS_PAD, size.height - node.r - BOUNDS_PAD);
  }
}

export function layoutNoteGraph(
  graph: NoteGraph,
  activeId?: string,
  size: GraphSize = GRAPH_VIEW_BOX,
  prev?: Map<string, { x: number; y: number }>,
  fixed?: ReadonlySet<string>,
): NoteGraphPoint[] {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const count = Math.max(1, graph.nodes.length);
  const maxRing = Math.min(cx, cy) * 0.92;
  // Deterministic sunflower (phyllotaxis) seed — spread out, no random clumps.
  const spread = clamp((Math.min(size.width, size.height) / Math.sqrt(count)) * 1.1, 24, 64);
  let reused = 0;
  const nodes: NoteGraphPoint[] = graph.nodes.map((node, index) => {
    const r = nodeRadius(node);
    // Keep positions you've already arranged — a filter toggle or selection
    // must never re-scramble nodes that are already on screen.
    const known = prev?.get(node.id);
    if (known) {
      reused++;
      return { ...node, x: known.x, y: known.y, vx: 0, vy: 0, r };
    }
    if (node.id === activeId) {
      return { ...node, x: cx, y: cy, vx: 0, vy: 0, r };
    }
    const angle = index * 2.399963229728653; // golden angle
    const ring = Math.min(maxRing, spread * Math.sqrt(index + 0.7));
    return {
      ...node,
      x: cx + Math.cos(angle) * ring,
      y: cy + Math.sin(angle) * ring,
      vx: 0,
      vy: 0,
      r,
    };
  });

  // A fresh layout settles hard; an incremental one (positions carried over)
  // only nudges gently so existing nodes stay put while new ones find a spot.
  const incremental = reused > 0;
  const iterations = incremental ? 120 : count > 120 ? 140 : 300;
  let alpha = incremental ? 0.32 : 1;
  for (let i = 0; i < iterations; i++) {
    simulationStep(nodes, graph.links, size, alpha, fixed);
    alpha *= incremental ? 0.985 : 0.992;
  }
  for (const node of nodes) {
    node.vx = 0;
    node.vy = 0;
  }
  return nodes;
}
