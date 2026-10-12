// Kit gallery — stand only (Vite dev: http://127.0.0.1:<port>/scripts/ui-px/gallery.html), never
// built: the production build has a single entry (index.html). Every component × state; the
// format is the viewport's (shell classifies it), `?modal=1` opens the window, `?kbd=1` /
// `?pad=1` pretend the last input was a keyboard / gamepad (focus ring + key hints).

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { GameShellRoot } from '../../src/game-shell/GameShellRoot';
import { InputRoot } from '../../src/input/InputRoot';
import { Prompt, setInputDevice } from '../../src/input';
import { RARITIES } from '../../src/lib/rarity';
import {
  Badge,
  Bar,
  Button,
  Grid,
  Heading,
  Icon,
  Inspect,
  InspectRow,
  Modal,
  Panel,
  Slot,
  Tabs,
  Tooltip,
} from '../../src/ui-px';
import type { PxIconName } from '../../src/ui-px';
import { PetArt } from '../../src/components/PetArt';

const q = new URLSearchParams(location.search);
if (!location.hash) location.hash = '#/games';

const LANGS: [string, string][] = [
  ['ru', 'Питомник · Лис-картёжник · Эпическая · ур. 15 · +19,7% к продаже · Взять с собой'],
  ['en', 'Nursery · Card-Sharp Fox · Epic · Lv 15 · +19.7% sell price · Take along'],
  ['fr', 'Animalerie · Renard tricheur · Épique · Niv. 15 · +19,7 % vente · Œuf doré'],
  ['tr', 'Yuva · Kumarbaz Tilki · Destansı · Sv. 15 · +%19,7 satış · İğne Şişli Iğdır'],
  ['de', 'Tierstall · Falschspieler-Fuchs · Episch · St. 15 · Größe Übermaß'],
  ['es', 'Criadero · Zorro tahúr · Épico · Nv. 15 · ¡Hazlo dorado! ¿Seguro? Año'],
  ['it', 'Allevamento · Volpe baro · Epico · Liv. 15 · Perché più così'],
];
const ICONS: PxIconName[] = [
  'x', 'plus', 'check', 'lock', 'left', 'right', 'up', 'down', 'star', 'heart', 'paw', 'sort',
  'filter', 'play', 'info', 'sword', 'bolt', 'zzz',
];
const hover = (m: string) =>
  ({
    '--b': `var(--pxk-btn-${m}-h)`,
    '--bs': `var(--pxk-btn-${m}-h-s)`,
    '--bw': `var(--pxk-btn-${m}-h-w)`,
  }) as CSSProperties;

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ margin: '0 0 calc(8 * var(--u))' }}>
      <Heading>{title}</Heading>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'calc(4 * var(--u))', marginTop: 'calc(3 * var(--u))', alignItems: 'flex-start' }}>
        {children}
      </div>
    </section>
  );
}

function Gallery() {
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a');
  const [modal, setModal] = useState(q.has('modal'));
  return (
    <div className="px" style={{ padding: 'calc(6 * var(--u))', height: '100dvh', overflow: 'auto', boxSizing: 'border-box' }}>
      <Sec title="Type">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(2 * var(--u))' }}>
          <Heading big>Coco Head — Питомник 123</Heading>
          <Heading>Heading · Коллекция 11/18</Heading>
          <span className="px-num" style={{ fontSize: 'var(--px-fs-tiny)' }}>
            tiny digits 0123456789 · 12 345
          </span>
          {LANGS.map(([l, s]) => (
            <span key={l}>
              <b style={{ color: 'var(--px-blue)' }}>{l}</b> {s}
            </span>
          ))}
        </div>
      </Sec>
      <Sec title="Materials">
        {(['stone', 'iron', 'wood', 'parch', 'obsidian', 'well'] as const).map((m) => (
          <Panel key={m} material={m} style={{ width: 'calc(60 * var(--u))' }}>
            {m}
          </Panel>
        ))}
        <Panel material="stone" stage style={{ width: 'calc(80 * var(--u))', height: 'calc(50 * var(--u))' }}>
          stage
        </Panel>
      </Sec>
      <Sec title="Buttons">
        {(['primary', 'secondary', 'danger', 'confirm'] as const).map((k) => (
          <div key={k} style={{ display: 'flex', gap: 'calc(3 * var(--u))', flexWrap: 'wrap' }}>
            <Button kind={k}>{k}</Button>
            <Button kind={k} style={hover({ primary: 'gold', secondary: 'iron', danger: 'red', confirm: 'green' }[k])}>
              hover
            </Button>
            <Button kind={k} className="is-down">
              pressed
            </Button>
            <Button kind={k} data-focus="">
              focus
            </Button>
            <Button kind={k} off>
              off
            </Button>
          </div>
        ))}
        <Button kind="primary" hint="confirm">
          Взять с собой
        </Button>
        <Button icon="x" label="close" kind="danger" />
        <Button icon="info" label="info" />
        <Button icon="sort" label="sort" size="sm" />
        <Button size="sm" on>
          on
        </Button>
        <Button size="sm">sm</Button>
      </Sec>
      <Sec title="Tabs">
        <div style={{ width: 'calc(150 * var(--u))' }}>
          <Tabs
            items={[
              { id: 'a', label: 'Питомцы', icon: 'paw' },
              { id: 'b', label: 'Яйца', badge: 2 },
              { id: 'c', label: 'Ещё' },
            ]}
            value={tab}
            onChange={setTab}
          />
          <Panel material="wood" style={{ marginTop: 0 }}>
            panel under tabs
          </Panel>
        </div>
      </Sec>
      <Sec title="Slots">
        <Grid style={{ width: '100%' }}>
          {RARITIES.map((r, i) => (
            <Slot key={r.id} rarity={i} count={i * 3 + 1} corner={i === 4 ? '★' : undefined}>
              <PetArt id={(['mole', 'mouse', 'owl', 'fox', 'raven', 'phoenix', 'dragon'] as const)[i]} size={40} still />
            </Slot>
          ))}
          <Slot rarity={3} selected>
            <PetArt id="fox" size={40} still />
          </Slot>
          <Slot rarity={2} locked>
            <PetArt id="owl" size={40} still ghost />
          </Slot>
          <Slot empty>
            <Icon name="plus" />
          </Slot>
          <Slot rarity={1} dot="!">
            <PetArt id="cat" size={40} still />
          </Slot>
          <Slot rarity={4} data-focus="">
            <PetArt id="wolf" size={40} still />
          </Slot>
        </Grid>
      </Sec>
      <Sec title="Bars · badges · ribbon · icons">
        <div style={{ width: 'calc(80 * var(--u))', display: 'grid', gap: 'calc(3 * var(--u))' }}>
          <Bar value={0.62} />
          <Bar value={0.3} tone="blue" label="3/5" height={9} />
          <Bar value={0.9} tone="green" />
        </div>
        <Badge>3</Badge>
        <Badge gold>NEW</Badge>
        <Badge>•</Badge>
        <Heading ribbon>Питомник</Heading>
        <div style={{ display: 'flex', gap: 'calc(3 * var(--u))', color: 'var(--px-gold)', flexWrap: 'wrap' }}>
          {ICONS.map((n) => (
            <Icon key={n} name={n} />
          ))}
        </div>
      </Sec>
      <Sec title="Key hints">
        <div className="px-keyhints">
          <Prompt action="confirm" label="OK" device="keyboard" className="px-keyhint" />
          <Prompt action="back" label="Back" device="keyboard" className="px-keyhint" />
          <Prompt action="confirm" label="OK" device="gamepad" pad="xbox" className="px-keyhint" />
          <Prompt action="inspect" label="Info" device="gamepad" pad="ps" className="px-keyhint" />
          <Prompt action="tabNext" device="gamepad" pad="xbox" className="px-keyhint" />
        </div>
      </Sec>
      <Sec title="Inspect · tooltip">
        <Panel material="obsidian" style={{ width: 'calc(110 * var(--u))' }}>
          <Inspect name="Лис-картёжник" sub="Золотой · Эпическая" color={RARITIES[3].color}>
            <InspectRow k="Уровень">15</InspectRow>
            <InspectRow k="Продажа">+19,7%</InspectRow>
            <Bar value={0.4} label="1 200 / 3 000" height={9} />
            <p className="px-inspect__lore">Держит туза в рукаве и монету за ухом.</p>
          </Inspect>
        </Panel>
        <div style={{ position: 'relative', width: 'calc(120 * var(--u))', height: 'calc(40 * var(--u))' }}>
          <div style={{ position: 'absolute', inset: 0, transform: 'translateZ(0)' }}>
            <Tooltip x={120} y={70}>
              <b style={{ color: RARITIES[4].color }}>Ворон-ключник</b>
              <br />
              +12% токенов
            </Tooltip>
          </div>
        </div>
      </Sec>
      <Button kind="primary" onClick={() => setModal(true)}>
        Modal
      </Button>
      {modal && (
        <Modal title="С собой" onClose={() => setModal(false)} sheet={q.has('sheet')}>
          <Grid>
            {(['fox', 'owl', 'cat', 'wolf'] as const).map((id, i) => (
              <Slot key={id} rarity={i + 1}>
                <PetArt id={id} size={40} still />
              </Slot>
            ))}
          </Grid>
        </Modal>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <InputRoot />
    <GameShellRoot />
    <Gallery />
  </HashRouter>,
);
if (q.has('kbd')) setTimeout(() => setInputDevice('keyboard'), 300);
if (q.has('pad')) setTimeout(() => setInputDevice('gamepad'), 300);
