import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { PhotoPicker } from '@/components/PhotoPicker';
import { useFinanceStore, type PersonDraft } from '@/store';
import type { Attachment, PersonCategory, PersonCloseness } from '@/types';
import { CLOSENESS_LABEL, PERSON_CATEGORIES, personCategories, splitTags } from '@/lib/people';
import { notifySuccess, selectionChanged } from '@/lib/haptics';

export function PersonFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useFinanceStore((s) => (id ? s.getPerson(id) : undefined));
  const addPerson = useFinanceStore((s) => s.addPerson);
  const updatePerson = useFinanceStore((s) => s.updatePerson);

  const editing = !!id;
  const [avatar, setAvatar] = useState<Attachment | undefined>(existing?.avatar);
  const [name, setName] = useState(existing?.name ?? '');
  const [categories, setCategories] = useState<PersonCategory[]>(
    existing ? personCategories(existing) : ['friend'],
  );
  const [closeness, setCloseness] = useState<PersonCloseness>(existing?.closeness ?? 3);
  const [birthday, setBirthday] = useState(existing?.birthday ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [socials, setSocials] = useState(existing?.socials ?? '');
  const [city, setCity] = useState(existing?.city ?? '');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [favorite, setFavorite] = useState(existing?.favorite ?? false);

  if (editing && !existing) return <Navigate to="/people" replace />;

  const valid = name.trim().length > 0 && categories.length > 0;
  const toggleCategory = (id: PersonCategory) => {
    selectionChanged();
    setCategories((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };
  const submit = () => {
    if (!valid) return;
    const draft: PersonDraft = {
      name: name.trim(),
      avatar,
      category: categories[0] ?? 'other',
      categories,
      closeness,
      birthday: birthday || undefined,
      description: description.trim() || undefined,
      phone: phone.trim() || undefined,
      socials: socials.trim() || undefined,
      city: city.trim() || undefined,
      tags: splitTags(tags),
      favorite,
    };
    if (existing) {
      updatePerson(existing.id, draft);
      notifySuccess();
      navigate(`/people/${existing.id}`, { replace: true });
    } else {
      const created = addPerson(draft);
      notifySuccess();
      navigate(`/people/${created.id}`, { replace: true });
    }
  };

  return (
    <Screen
      title={existing ? 'Изменить человека' : 'Новый человек'}
      subtitle={existing ? 'Профиль и важные детали' : 'Быстро: имя, категория, дата'}
    >
      {existing && <PhotoPicker photo={avatar} onChange={setAvatar} label="Фото / аватар" />}

      <div className="field">
        <label className="field__label">Имя</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Напр. Аня"
          autoFocus={!id}
        />
      </div>

      <div className="field">
        <label className="field__label">Категории</label>
        <div className="chips">
          {PERSON_CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`chip${categories.includes(item.id) ? ' is-active' : ''}`}
              onClick={() => toggleCategory(item.id)}
            >
              {item.emoji} {item.label}
            </button>
          ))}
        </div>
      </div>

      {existing && (
        <div className="field">
          <label className="field__label">Степень близости</label>
          <div className="chips">
            {([1, 2, 3, 4, 5] as PersonCloseness[]).map((value) => (
              <button
                key={value}
                type="button"
                className={`chip${closeness === value ? ' is-active' : ''}`}
                onClick={() => {
                  selectionChanged();
                  setCloseness(value);
                }}
              >
                {value} · {CLOSENESS_LABEL[value]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label className="field__label">День рождения</label>
        <input
          className="input"
          type="date"
          value={birthday}
          onChange={(e) => setBirthday(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label">
          {existing ? 'Кто это для меня?' : 'Короткая заметка'}
        </label>
        <textarea
          className="input people-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Напр. Друг с работы, любит кофе без сахара"
          rows={3}
        />
      </div>

      {existing && (
        <>
          <div className="field">
            <label className="field__label">Телефон</label>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7..."
            />
          </div>
          <div className="field">
            <label className="field__label">Telegram / соцсети</label>
            <input
              className="input"
              value={socials}
              onChange={(e) => setSocials(e.target.value)}
              placeholder="@username, Instagram..."
            />
          </div>
          <div className="field">
            <label className="field__label">Город</label>
            <input
              className="input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Москва"
            />
          </div>
        </>
      )}

      <div className="field">
        <label className="field__label">Теги</label>
        <input
          className="input"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="кофе, кино, спорт"
        />
      </div>

      {existing && (
        <label className="toggle-row">
          <span>Закрепить в избранное</span>
          <input
            type="checkbox"
            checked={favorite}
            onChange={(e) => setFavorite(e.target.checked)}
          />
        </label>
      )}

      <button className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        {existing ? 'Сохранить' : 'Добавить человека'}
      </button>
    </Screen>
  );
}
