import { useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { GxModal, KIcon } from '@/components/gx';
import { useFinanceStore } from '@/store';
import { primeAudio, uiTap, uiTab } from '@/lib/sound';
import { selectionChanged, tapMedium } from '@/lib/haptics';
import { NATIVE_NAME, autoLang, resetLang, savedLang, setLang, useLang, useT } from '@/i18n';
import type { Lang } from '@/i18n';
import { useSettings } from './store';
import type { MotionPref, TextSize, UiScalePref } from './store';
import { settingsPanels } from './panels';
import './settings.css';

export type SettingsSection =
  | 'language'
  | 'sound'
  | 'vibration'
  | 'display'
  | 'controls'
  | 'progress';

const MENU_ORDER = Object.keys(NATIVE_NAME) as Lang[];

/**
 * The game's general settings: language, sound, vibration, display,
 * controls, progress. Opened from the games hall ⚙ and from the mine ⚙
 * (there `progress` carries the mine's resets and the cash desk).
 * Phone portrait: icon tabs on top; wide window: a rail on the left.
 */
export function GameSettings({
  onClose,
  progress,
  initial = 'language',
}: {
  onClose: () => void;
  progress?: ReactNode;
  initial?: SettingsSection;
}) {
  const t = useT();
  const sections: SettingsSection[] = ['language', 'sound', 'vibration', 'display', 'controls'];
  if (progress) sections.push('progress');
  const [tab, setTab] = useState<SettingsSection>(
    sections.includes(initial) ? initial : 'language',
  );
  const tabRefs = useRef<Partial<Record<SettingsSection, HTMLButtonElement | null>>>({});

  const go = (s: SettingsSection, focus = false) => {
    if (s === tab) return;
    uiTab();
    selectionChanged();
    setTab(s);
    if (focus) tabRefs.current[s]?.focus();
  };

  const onNavKey = (e: KeyboardEvent) => {
    const i = sections.indexOf(tab);
    const step =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    go(sections[(i + step + sections.length) % sections.length], true);
  };

  return (
    <GxModal title={t('settings.title')} onClose={onClose} className="gset">
      <div className="gset__in">
        <nav className="gset__nav" role="tablist" aria-orientation="vertical" onKeyDown={onNavKey}>
          {sections.map((s) => (
            <button
              key={s}
              ref={(el) => {
                tabRefs.current[s] = el;
              }}
              type="button"
              role="tab"
              aria-selected={tab === s}
              tabIndex={tab === s ? 0 : -1}
              className={`gset__tab${tab === s ? ' is-on' : ''}`}
              onClick={() => go(s)}
            >
              <SectionIcon name={s} />
              <span>{t(`settings.section.${s}`)}</span>
            </button>
          ))}
        </nav>
        <section className="gset__pane" role="tabpanel" aria-label={t(`settings.section.${tab}`)}>
          <h3 className="gset__h">{t(`settings.section.${tab}`)}</h3>
          {tab === 'language' && <LanguagePane />}
          {tab === 'sound' && <SoundPane />}
          {tab === 'vibration' && <VibrationPane />}
          {tab === 'display' && <DisplayPane />}
          {tab === 'controls' && <ControlsPane />}
          {tab === 'progress' && <div className="gset__progress">{progress}</div>}
        </section>
      </div>
    </GxModal>
  );
}

// ---------------------------------------------------------------------------

function LanguagePane() {
  const t = useT();
  const lang = useLang();
  const auto = !savedLang();
  const detected = autoLang();
  return (
    <div className="gset-langs" role="radiogroup" aria-label={t('settings.section.language')}>
      <button
        type="button"
        role="radio"
        aria-checked={auto}
        className={`gset-opt gset-opt--auto${auto ? ' is-on' : ''}`}
        onClick={() => {
          selectionChanged();
          void resetLang();
        }}
      >
        <SectionIcon name="language" />
        <span className="gset-opt__txt">
          <b>{t('settings.language.auto')}</b>
          <i>{t('settings.language.autoHint', { name: NATIVE_NAME[detected] })}</i>
        </span>
        {auto && <KIcon name="checkmark" size={18} />}
      </button>
      {MENU_ORDER.map((l) => {
        const on = !auto && lang === l;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={on}
            lang={l}
            className={`gset-opt${on ? ' is-on' : ''}`}
            onClick={() => {
              selectionChanged();
              void setLang(l);
            }}
          >
            <span className="gset-opt__code" aria-hidden="true">
              {l.toUpperCase()}
            </span>
            <span className="gset-opt__txt">
              <b>{NATIVE_NAME[l]}</b>
            </span>
            {on && <KIcon name="checkmark" size={18} />}
          </button>
        );
      })}
    </div>
  );
}

function SoundPane() {
  const t = useT();
  const sound = useFinanceStore((s) => s.slotsSound);
  const music = useFinanceStore((s) => s.slotsMusic);
  const setPrefs = useFinanceStore((s) => s.setSlotsPrefs);
  const { master, music: musicVol, sfx, set } = useSettings();
  return (
    <div className="gset-list">
      <Switch
        label={t('settings.sound.sound')}
        icon={<KIcon name={sound ? 'audioOn' : 'audioOff'} size={20} />}
        on={sound}
        onChange={(v) => {
          primeAudio();
          setPrefs({ sound: v });
          if (v) setTimeout(uiTap, 60);
        }}
      />
      <Switch
        label={t('settings.sound.music')}
        icon={<KIcon name={music ? 'musicOn' : 'musicOff'} size={20} />}
        on={music}
        onChange={(v) => {
          primeAudio();
          setPrefs({ music: v });
        }}
      />
      <Slider
        label={t('settings.sound.master')}
        value={master}
        disabled={!sound}
        onChange={(v) => set({ master: v })}
      />
      <Slider
        label={t('settings.sound.musicVolume')}
        value={musicVol}
        disabled={!sound || !music}
        onChange={(v) => set({ music: v })}
      />
      <Slider
        label={t('settings.sound.sfxVolume')}
        value={sfx}
        disabled={!sound}
        onChange={(v) => set({ sfx: v })}
        onCommit={() => uiTap()}
      />
    </div>
  );
}

function VibrationPane() {
  const t = useT();
  const haptics = useFinanceStore((s) => s.slotsHaptics);
  const setPrefs = useFinanceStore((s) => s.setSlotsPrefs);
  return (
    <div className="gset-list">
      <Switch
        label={t('settings.vibration.on')}
        icon={<SectionIcon name="vibration" />}
        on={haptics}
        onChange={(v) => {
          setPrefs({ haptics: v });
          // The global switch flips in `apply.ts`; buzz once so the change is felt.
          if (v) setTimeout(tapMedium, 30);
        }}
      />
    </div>
  );
}

function DisplayPane() {
  const t = useT();
  const { uiScale, textSize, motion, set } = useSettings();
  return (
    <div className="gset-list">
      <Segmented<UiScalePref>
        label={t('settings.display.scale')}
        value={uiScale}
        options={[
          ['auto', t('common.auto')],
          [1, '1×'],
          [2, '2×'],
          [3, '3×'],
        ]}
        onChange={(v) => set({ uiScale: v })}
      />
      <Segmented<TextSize>
        label={t('settings.display.text')}
        value={textSize}
        options={[
          ['s', t('settings.display.textS')],
          ['m', t('settings.display.textM')],
          ['l', t('settings.display.textL')],
        ]}
        onChange={(v) => set({ textSize: v })}
      />
      <Segmented<MotionPref>
        label={t('settings.display.motion')}
        value={motion}
        options={[
          ['auto', t('settings.display.motionAuto')],
          ['reduce', t('common.on')],
          ['full', t('common.off')],
        ]}
        onChange={(v) => set({ motion: v })}
      />
    </div>
  );
}

function ControlsPane() {
  const t = useT();
  const Panel = settingsPanels.controls;
  if (Panel) return <Panel />;
  return (
    <div className="gset-soon">
      <SectionIcon name="controls" />
      <p>{t('settings.controls.soon')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls (gx look; agent U's kit restyles them later)

function Switch({
  label,
  icon,
  on,
  onChange,
}: {
  label: string;
  icon?: ReactNode;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`gset-row gset-switch${on ? ' is-on' : ''}`}
      onClick={() => {
        selectionChanged();
        onChange(!on);
      }}
    >
      {icon && <span className="gset-row__icon">{icon}</span>}
      <span className="gset-row__label">{label}</span>
      <span className="gset-switch__track" aria-hidden="true">
        <span className="gset-switch__knob" />
      </span>
    </button>
  );
}

function Slider({
  label,
  value,
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  onCommit?: () => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <label className={`gset-row gset-slider${disabled ? ' is-off' : ''}`}>
      <span className="gset-row__label">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        disabled={disabled}
        style={{ ['--v' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
      <span className="gset-slider__val">{pct}</span>
    </label>
  );
}

function Segmented<V extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: [V, string][];
  onChange: (v: V) => void;
}) {
  return (
    <div className="gset-row gset-seg" role="radiogroup" aria-label={label}>
      <span className="gset-row__label">{label}</span>
      <span className="gset-seg__opts">
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={value === v}
            className={`gset-seg__opt${value === v ? ' is-on' : ''}`}
            onClick={() => {
              if (value === v) return;
              selectionChanged();
              uiTap();
              onChange(v);
            }}
          >
            {text}
          </button>
        ))}
      </span>
    </div>
  );
}

/** Section icons drawn in code (a globe for the language, as the stores ask). */
export function SectionIcon({ name }: { name: SettingsSection }) {
  const body: Record<SettingsSection, ReactNode> = {
    language: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18M5 7h14M5 17h14" />
      </>
    ),
    sound: (
      <>
        <path d="M4 9h4l5-4v14l-5-4H4z" />
        <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
      </>
    ),
    vibration: (
      <>
        <rect x="8" y="3" width="8" height="18" rx="2" />
        <path d="M4 8v8M20 8v8M2 10v4M22 10v4" />
      </>
    ),
    display: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="1.5" />
        <path d="M9 20h6M12 16v4" />
      </>
    ),
    controls: (
      <>
        <path d="M7 8h10a4 4 0 0 1 4 4l.5 4a2 2 0 0 1-3.6 1.4L16 15H8l-1.9 2.4A2 2 0 0 1 2.5 16L3 12a4 4 0 0 1 4-4z" />
        <path d="M7 11v3M5.5 12.5h3" />
        <circle cx="16" cy="11.5" r=".6" />
        <circle cx="17.8" cy="13.3" r=".6" />
      </>
    ),
    progress: (
      <>
        <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
        <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8" />
      </>
    ),
  };
  return (
    <svg
      className="gset-icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {body[name]}
    </svg>
  );
}
