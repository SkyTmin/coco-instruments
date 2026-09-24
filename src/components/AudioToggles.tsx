import { useFinanceStore } from '@/store';
import { KIcon } from '@/components/gx';
import { primeAudio, uiTap } from '@/lib/sound';
import { selectionChanged } from '@/lib/haptics';

/** Две круглые кнопки: звук и музыка. Общие для всех игр зала. */
export function AudioToggles({ className }: { className?: string }) {
  const sound = useFinanceStore((s) => s.slotsSound);
  const music = useFinanceStore((s) => s.slotsMusic);
  const setPrefs = useFinanceStore((s) => s.setSlotsPrefs);
  return (
    <span className={`gx-audio${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className={`gx-round gx-round--dark gx-audio__btn${sound ? '' : ' is-off'}`}
        aria-label={sound ? 'Выключить звук' : 'Включить звук'}
        aria-pressed={sound}
        onClick={() => {
          primeAudio();
          selectionChanged();
          setPrefs({ sound: !sound });
          if (!sound) setTimeout(uiTap, 60);
        }}
      >
        <KIcon name={sound ? 'audioOn' : 'audioOff'} />
      </button>
      <button
        type="button"
        className={`gx-round gx-round--dark gx-audio__btn${music ? '' : ' is-off'}`}
        aria-label={music ? 'Выключить музыку' : 'Включить музыку'}
        aria-pressed={music}
        onClick={() => {
          primeAudio();
          selectionChanged();
          uiTap();
          setPrefs({ music: !music });
        }}
      >
        <KIcon name={music ? 'musicOn' : 'musicOff'} />
      </button>
    </span>
  );
}
