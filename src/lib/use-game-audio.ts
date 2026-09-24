import { useEffect } from 'react';
import { useFinanceStore } from '@/store';
import { preloadSounds, setMusicOn, setMusicScene, setMuted } from '@/lib/sound';
import type { MusicScene, SoundGroup } from '@/lib/sound';

/**
 * Звук игровой страницы: настройки из стора, свой набор эффектов и своя
 * музыка. Ушли со страницы — музыка затихает; пришли на другую игровую —
 * её трек сменяет прежний кроссфейдом (снятие старой страницы и постановка
 * новой идут в одном такте React).
 */
export function useGameAudio(scene: MusicScene | null, ...groups: SoundGroup[]): void {
  const sound = useFinanceStore((s) => s.slotsSound);
  const music = useFinanceStore((s) => s.slotsMusic);
  useEffect(() => setMuted(!sound), [sound]);
  useEffect(() => setMusicOn(music), [music]);
  const key = groups.join(',');
  useEffect(() => {
    preloadSounds('ui', ...(key ? (key.split(',') as SoundGroup[]) : []));
  }, [key]);
  useEffect(() => {
    setMusicScene(scene);
    return () => setMusicScene(null);
  }, [scene]);
}
