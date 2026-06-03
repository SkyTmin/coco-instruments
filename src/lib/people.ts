import type {
  Conversation,
  Gift,
  MeetIdea,
  Person,
  PersonCategory,
  PersonCloseness,
  PersonPromise,
  PersonRelationType,
  PreferenceType,
} from '@/types';
import { addDays, parseISO, toISO } from '@/lib/date';
import { pluralizeRu, relativeDay } from '@/lib/format';

export const PERSON_CATEGORIES: Array<{ id: PersonCategory; label: string; emoji: string }> = [
  { id: 'family', label: 'Семья', emoji: '🏡' },
  { id: 'friend', label: 'Друзья', emoji: '🤍' },
  { id: 'work', label: 'Работа', emoji: '💼' },
  { id: 'relationship', label: 'Отношения', emoji: '❤️' },
  { id: 'other', label: 'Другое', emoji: '✨' },
];

export const PERSON_CATEGORY_LABEL: Record<PersonCategory, string> = {
  family: 'Семья',
  friend: 'Друг',
  work: 'Работа',
  relationship: 'Отношения',
  other: 'Другое',
};

export const PERSON_CATEGORY_EMOJI: Record<PersonCategory, string> = {
  family: '🏡',
  friend: '🤍',
  work: '💼',
  relationship: '❤️',
  other: '✨',
};

export function personCategories(person: Person): PersonCategory[] {
  const values = person.categories?.length ? person.categories : [person.category];
  return Array.from(new Set(values)).filter((category): category is PersonCategory => category in PERSON_CATEGORY_LABEL);
}

export function personCategoryLabel(person: Person): string {
  return personCategories(person)
    .map((category) => PERSON_CATEGORY_LABEL[category])
    .join(' · ');
}

export function personCategoryEmoji(person: Person): string {
  return personCategories(person)
    .slice(0, 2)
    .map((category) => PERSON_CATEGORY_EMOJI[category])
    .join('');
}

export const CLOSENESS_LABEL: Record<PersonCloseness, string> = {
  1: 'обычный',
  2: 'приятель',
  3: 'хороший контакт',
  4: 'близкий',
  5: 'очень близкий',
};

export const PREFERENCE_TYPES: Array<{ id: PreferenceType; label: string }> = [
  { id: 'food', label: 'Еда' },
  { id: 'drink', label: 'Напитки' },
  { id: 'music', label: 'Музыка' },
  { id: 'movies', label: 'Фильмы' },
  { id: 'places', label: 'Места' },
  { id: 'colors', label: 'Цвета' },
  { id: 'style', label: 'Стиль' },
  { id: 'hobbies', label: 'Хобби' },
  { id: 'dislikes', label: 'Не любит' },
  { id: 'other', label: 'Другое' },
];

export const PREFERENCE_LABEL: Record<PreferenceType, string> = Object.fromEntries(
  PREFERENCE_TYPES.map((item) => [item.id, item.label]),
) as Record<PreferenceType, string>;

export const RELATION_LABEL: Record<PersonRelationType, string> = {
  friend: 'друг',
  relative: 'родственник',
  colleague: 'коллега',
  acquaintance: 'знакомый',
  couple: 'пара',
  other: 'связь',
};

export function peopleWord(count: number): string {
  return pluralizeRu(count, ['человек', 'человека', 'людей']);
}

export function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '♡';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('ru-RU') ?? '')
    .join('');
}

export function splitTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\s#]+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

export function nextBirthday(person: Person, from = new Date()) {
  const birthday = parseISO(person.birthday ?? '');
  if (!birthday) return null;
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  let next = new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, birthday.getMonth(), birthday.getDate());
  const days = Math.round((next.getTime() - today.getTime()) / 86400000);
  return { date: toISO(next), days, label: days === 0 ? 'сегодня' : relativeDay(toISO(next)) };
}

export interface PeopleUpcomingEvent {
  id: string;
  personId: string;
  personName: string;
  kind: 'birthday' | 'promise' | 'gift' | 'meet';
  title: string;
  date: string;
  days: number;
}

function daysUntil(iso: string, from = new Date()): number | null {
  const date = parseISO(iso);
  if (!date) return null;
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

export function peopleUpcomingEvents(input: {
  people: Person[];
  promises: PersonPromise[];
  gifts: Gift[];
  meetIdeas: MeetIdea[];
  withinDays?: number;
}): PeopleUpcomingEvent[] {
  const withinDays = input.withinDays ?? 30;
  const byPerson = new Map(input.people.map((person) => [person.id, person]));
  const events: PeopleUpcomingEvent[] = [];

  for (const person of input.people) {
    const birthday = nextBirthday(person);
    if (birthday && birthday.days <= withinDays) {
      events.push({
        id: `birthday:${person.id}:${birthday.date}`,
        personId: person.id,
        personName: person.name,
        kind: 'birthday',
        title: `День рождения у ${person.name}`,
        date: birthday.date,
        days: birthday.days,
      });
    }
  }

  for (const promise of input.promises) {
    const person = byPerson.get(promise.personId);
    const days = promise.dueDate ? daysUntil(promise.dueDate) : null;
    if (!person || promise.status !== 'open' || days === null || days > withinDays) continue;
    events.push({
      id: `promise:${promise.id}`,
      personId: person.id,
      personName: person.name,
      kind: 'promise',
      title: promise.title,
      date: promise.dueDate!,
      days,
    });
  }

  for (const gift of input.gifts) {
    const person = byPerson.get(gift.personId);
    const days = gift.date ? daysUntil(gift.date) : null;
    if (!person || gift.status === 'given' || days === null || days > withinDays) continue;
    events.push({
      id: `gift:${gift.id}`,
      personId: person.id,
      personName: person.name,
      kind: 'gift',
      title: gift.title,
      date: gift.date!,
      days,
    });
  }

  for (const meet of input.meetIdeas) {
    const person = byPerson.get(meet.personId);
    const days = meet.date ? daysUntil(meet.date) : null;
    if (!person || meet.status === 'done' || days === null || days > withinDays) continue;
    events.push({
      id: `meet:${meet.id}`,
      personId: person.id,
      personName: person.name,
      kind: 'meet',
      title: meet.title,
      date: meet.date!,
      days,
    });
  }

  return events
    .filter((event) => event.days >= 0)
    .sort((a, b) => a.days - b.days || a.title.localeCompare(b.title, 'ru'));
}

export function peopleStats(input: {
  people: Person[];
  gifts: Gift[];
  promises: PersonPromise[];
}) {
  return {
    people: input.people.length,
    birthdays: input.people.filter((person) => !!person.birthday).length,
    giftIdeas: input.gifts.filter((gift) => gift.status !== 'given').length,
    promises: input.promises.filter((promise) => promise.status === 'open').length,
  };
}

export function latestPersonNote(person: Person, conversations: Conversation[]): string {
  const latest = conversations
    .filter((item) => item.personId === person.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt)[0];
  return latest?.note || latest?.title || person.description || 'Важное можно дописать позже';
}

export function birthdayInDays(days: number): string {
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `через ${days} ${pluralizeRu(days, ['день', 'дня', 'дней'])}`;
}

export function defaultReminderDate(dueDate: string): string {
  const date = parseISO(dueDate);
  return date ? toISO(addDays(date, -1)) : '';
}
