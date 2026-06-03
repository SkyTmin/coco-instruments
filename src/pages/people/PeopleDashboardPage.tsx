import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, Screen, Skeleton, StatTile } from '@/components/ui';
import { IconHeart, IconPlus } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { attachmentHref } from '@/lib/images';
import {
  PERSON_CATEGORY_EMOJI,
  PERSON_CATEGORY_LABEL,
  birthdayInDays,
  latestPersonNote,
  nextBirthday,
  peopleStats,
  peopleUpcomingEvents,
  peopleWord,
  personInitials,
} from '@/lib/people';
import { normalizeNoteTitle } from '@/lib/notes-graph';
import { relativeDay } from '@/lib/format';
import { selectionChanged, tapLight } from '@/lib/haptics';

type PeopleFilter = 'all' | 'close' | 'family' | 'friend' | 'work' | 'favorite' | 'birthday';

const FILTERS: Array<{ id: PeopleFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'close', label: 'Близкие' },
  { id: 'family', label: 'Семья' },
  { id: 'friend', label: 'Друзья' },
  { id: 'work', label: 'Работа' },
  { id: 'favorite', label: 'Избранные' },
  { id: 'birthday', label: 'Дни рождения' },
];

function eventKindLabel(kind: string): string {
  if (kind === 'birthday') return 'День рождения';
  if (kind === 'promise') return 'Обещание';
  if (kind === 'gift') return 'Подарок';
  return 'Встреча';
}

export function PeopleDashboardPage() {
  const navigate = useNavigate();
  const people = useFinanceStore((s) => s.people);
  const gifts = useFinanceStore((s) => s.gifts);
  const conversations = useFinanceStore((s) => s.conversations);
  const promises = useFinanceStore((s) => s.promises);
  const meetIdeas = useFinanceStore((s) => s.meetIdeas);
  const hydrated = useFinanceStore((s) => s.hydrated);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PeopleFilter>('all');

  const stats = useMemo(() => peopleStats({ people, gifts, promises }), [people, gifts, promises]);
  const upcoming = useMemo(
    () => peopleUpcomingEvents({ people, promises, gifts, meetIdeas, withinDays: 30 }).slice(0, 4),
    [gifts, meetIdeas, people, promises],
  );

  const filteredPeople = useMemo(() => {
    const key = normalizeNoteTitle(query);
    return [...people]
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt)
      .filter((person) => {
        if (filter === 'close' && person.closeness < 4) return false;
        if (filter === 'family' && person.category !== 'family') return false;
        if (filter === 'friend' && person.category !== 'friend') return false;
        if (filter === 'work' && person.category !== 'work') return false;
        if (filter === 'favorite' && !person.favorite) return false;
        if (filter === 'birthday' && !person.birthday) return false;
        if (!key) return true;
        return normalizeNoteTitle(
          `${person.name} ${person.description ?? ''} ${person.city ?? ''} ${person.tags.join(' ')}`,
        ).includes(key);
      });
  }, [filter, people, query]);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  if (!hydrated) {
    return (
      <Screen title="Люди" subtitle="Близкие, даты и важное">
        <div className="stack">
          <Skeleton height={52} radius={16} />
          <Skeleton height={118} radius={20} />
          <Skeleton height={82} radius={18} />
          <Skeleton height={82} radius={18} />
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      title="Люди"
      subtitle="Близкие, даты и важное"
      action={
        <button className="icon-round people-add-round" onClick={() => go('/people/new')} aria-label="Новый человек">
          <IconPlus size={21} />
        </button>
      }
    >
      <div className="stack people-page">
        <button className="people-new-hero" onClick={() => go('/people/new')}>
          <span className="people-new-hero__icon">
            <IconHeart />
          </span>
          <span>
            <b>Новый человек</b>
            <small>Имя, дата, короткая заметка — остальное потом</small>
          </span>
        </button>

        <div className="notes-search-wrap">
          <input
            className="input notes-search notes-search--list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти человека, тег или город"
          />
          {query && (
            <button className="notes-search__clear" onClick={() => setQuery('')} aria-label="Очистить">
              ×
            </button>
          )}
        </div>

        <div className="people-filter chips">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={`chip${filter === item.id ? ' is-active' : ''}`}
              onClick={() => {
                selectionChanged();
                setFilter(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="card">
          <div className="stat-grid">
            <StatTile label="Людей" value={stats.people} />
            <StatTile label="Дней рождения" value={stats.birthdays} />
            <StatTile label="Идей подарков" value={stats.giftIdeas} />
            <StatTile label="Обещаний" value={stats.promises} />
          </div>
        </div>

        {upcoming.length > 0 && (
          <div className="card people-soon">
            <div className="people-section-title">Скоро</div>
            <div className="stack">
              {upcoming.map((event) => (
                <button
                  key={event.id}
                  className="people-soon__row"
                  onClick={() => go(`/people/${event.personId}`)}
                >
                  <span>
                    <b>{event.title}</b>
                    <small>
                      {eventKindLabel(event.kind)} · {event.personName}
                    </small>
                  </span>
                  <em>{event.days === 0 ? 'сегодня' : relativeDay(event.date)}</em>
                </button>
              ))}
            </div>
          </div>
        )}

        {filteredPeople.length > 0 ? (
          <div className="stack">
            {filteredPeople.map((person, index) => {
              const birthday = nextBirthday(person);
              return (
                <button
                  key={person.id}
                  className="person-card"
                  onClick={() => go(`/people/${person.id}`)}
                  style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
                >
                  <span className="person-card__avatar">
                    {person.avatar ? (
                      <img src={attachmentHref(person.avatar)} alt="" loading="lazy" />
                    ) : (
                      <span>{personInitials(person.name)}</span>
                    )}
                  </span>
                  <span className="person-card__body">
                    <span className="person-card__top">
                      <b>{person.name}</b>
                      {person.favorite && <i>♡</i>}
                    </span>
                    <span className="person-card__meta">
                      {PERSON_CATEGORY_EMOJI[person.category]} {PERSON_CATEGORY_LABEL[person.category]}
                      {birthday && <> · день рождения {birthdayInDays(birthday.days)}</>}
                    </span>
                    <span className="person-card__note">{latestPersonNote(person, conversations)}</span>
                    {person.tags.length > 0 && (
                      <span className="person-card__tags">
                        {person.tags.slice(0, 4).map((tag) => (
                          <small key={tag}>#{tag}</small>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="card people-empty-card">
            <EmptyState
              icon="♡"
              title={people.length ? 'Ничего не найдено' : 'Пока никого нет'}
              sub={people.length ? 'Попробуйте другой фильтр или запрос' : 'Добавьте первого человека, чтобы помнить важное'}
            />
            {!people.length && (
              <button className="btn btn--primary btn--block" onClick={() => go('/people/new')}>
                Добавить человека
              </button>
            )}
          </div>
        )}

        {people.length > 0 && (
          <div className="people-footnote">
            {people.length} {peopleWord(people.length)} в личной базе
          </div>
        )}
      </div>
    </Screen>
  );
}
