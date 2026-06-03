import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { EmptyState, Screen, StatTile } from '@/components/ui';
import { Photo } from '@/components/Photo';
import { useFinanceStore } from '@/store';
import { CATEGORIES, CATEGORY_EMOJI, CATEGORY_LABEL } from '@/lib/clothing';
import { attachmentHref } from '@/lib/images';
import { formatRUB, pluralizeRu, relativeDay } from '@/lib/format';
import type { ClothingCategory, WardrobeItem } from '@/types';
import { selectionChanged } from '@/lib/haptics';

const CAT_COLOR: Record<ClothingCategory, string> = {
  top: '#8a5a33',
  bottom: '#b8814a',
  outerwear: '#6a8cc8',
  shoes: '#2e9e6b',
  accessory: '#d79a2b',
  other: '#9b8b7a',
};

export function InsightsPage() {
  const navigate = useNavigate();
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const outfits = useFinanceStore((s) => s.outfits);

  const d = useMemo(() => {
    let value = 0;
    let wears = 0;
    const byCat: Partial<Record<ClothingCategory, number>> = {};
    for (const it of wardrobe) {
      value += it.price ?? 0;
      wears += it.wears ?? 0;
      byCat[it.category] = (byCat[it.category] ?? 0) + 1;
    }
    const donut = CATEGORIES.filter((c) => byCat[c.id]).map((c) => ({
      id: c.id,
      name: c.label,
      value: byCat[c.id] ?? 0,
      color: CAT_COLOR[c.id],
    }));
    const mostWorn = [...wardrobe]
      .filter((it) => (it.wears ?? 0) > 0)
      .sort((a, b) => (b.wears ?? 0) - (a.wears ?? 0))
      .slice(0, 3);
    const neverWorn = wardrobe.filter((it) => !(it.wears ?? 0));
    // Cost-per-wear: best value (low) among items with both price and wears.
    const cpw = wardrobe
      .filter((it) => it.price && (it.wears ?? 0) > 0)
      .map((it) => ({ it, cpw: it.price! / (it.wears ?? 1) }))
      .sort((a, b) => a.cpw - b.cpw);
    return { value, wears, donut, mostWorn, neverWorn, cpw };
  }, [wardrobe]);

  if (wardrobe.length === 0) {
    return (
      <Screen title="Аналитика" subtitle="Гардероб в цифрах">
        <EmptyState icon="📊" title="Пока нет данных" sub="Добавьте вещи в гардероб — и здесь появится аналитика" />
      </Screen>
    );
  }

  const go = (id: string) => {
    selectionChanged();
    navigate(`/clothing/wardrobe/${id}`);
  };

  return (
    <Screen title="Аналитика" subtitle="Гардероб в цифрах">
      <div className="stack">
        <div className="card">
          <div className="stat-grid">
            <StatTile label="Вещей" value={wardrobe.length} />
            <StatTile label="Образов" value={outfits.length} />
            <StatTile label="Надеваний" value={d.wears} />
            <StatTile label="Стоимость" value={d.value > 0 ? formatRUB(d.value) : '—'} />
          </div>
        </div>

        {d.donut.length > 0 && (
          <div className="card">
            <div className="section-label" style={{ margin: '0 0 6px' }}>
              Состав гардероба
            </div>
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={d.donut} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={2} stroke="none">
                  {d.donut.map((e) => (
                    <Cell key={e.id} fill={e.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 6px 20px rgba(0,0,0,0.18)', fontSize: 13 }}
                  formatter={(v: number, n: string) => [`${v} шт.`, n]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="insight-legend">
              {d.donut.map((e) => (
                <span key={e.id}>
                  <i style={{ background: e.color }} />
                  {CATEGORY_EMOJI[e.id]} {e.name} · {e.value}
                </span>
              ))}
            </div>
          </div>
        )}

        {d.mostWorn.length > 0 && (
          <div className="card">
            <div className="section-label" style={{ margin: '0 0 12px' }}>
              Чаще всего носите
            </div>
            <div className="stack" style={{ gap: 10 }}>
              {d.mostWorn.map((it) => (
                <WornRow key={it.id} item={it} onClick={() => go(it.id)} />
              ))}
            </div>
          </div>
        )}

        {d.cpw.length > 0 && (
          <div className="card">
            <div className="section-label" style={{ margin: '0 0 12px' }}>
              Цена за носку
            </div>
            <WornRow
              item={d.cpw[0].it}
              onClick={() => go(d.cpw[0].it.id)}
              right={`${formatRUB(Math.round(d.cpw[0].cpw))} / носка`}
              hint="выгоднее всего"
            />
            {d.cpw.length > 1 && (
              <div style={{ marginTop: 10 }}>
                <WornRow
                  item={d.cpw[d.cpw.length - 1].it}
                  onClick={() => go(d.cpw[d.cpw.length - 1].it.id)}
                  right={`${formatRUB(Math.round(d.cpw[d.cpw.length - 1].cpw))} / носка`}
                  hint="дороже всего"
                />
              </div>
            )}
          </div>
        )}

        {d.neverWorn.length > 0 && (
          <div className="card">
            <div className="section-label" style={{ margin: '0 0 4px' }}>
              Ни разу не надевали · {d.neverWorn.length}
            </div>
            <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
              Может, пора достать из шкафа?
            </p>
            <div className="wardrobe-strip">
              {d.neverWorn.slice(0, 14).map((it) => (
                <button key={it.id} className="wardrobe-strip__item" onClick={() => go(it.id)} aria-label={it.name}>
                  {it.photo ? (
                    <Photo src={attachmentHref(it.photo)} />
                  ) : (
                    <span className="wardrobe-strip__ph">{CATEGORY_EMOJI[it.category]}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}

function WornRow({
  item,
  onClick,
  right,
  hint,
}: {
  item: WardrobeItem;
  onClick: () => void;
  right?: string;
  hint?: string;
}) {
  return (
    <div className="worn-row" onClick={onClick} role="button">
      {item.photo ? (
        <img className="worn-row__thumb" src={attachmentHref(item.photo)} alt="" loading="lazy" />
      ) : (
        <div className="worn-row__thumb worn-row__thumb--ph">{CATEGORY_EMOJI[item.category]}</div>
      )}
      <div className="worn-row__main">
        <div className="worn-row__name">{item.name}</div>
        <div className="worn-row__sub">
          {CATEGORY_LABEL[item.category]}
          {item.lastWornAt ? ` · ${relativeDay(item.lastWornAt)}` : ''}
        </div>
      </div>
      <div className="worn-row__right">
        <b>{right ?? `${item.wears ?? 0} ${pluralizeRu(item.wears ?? 0, ['раз', 'раза', 'раз'])}`}</b>
        {hint && <span>{hint}</span>}
      </div>
    </div>
  );
}
