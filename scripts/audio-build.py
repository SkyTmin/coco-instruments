#!/usr/bin/env python3
"""
Сборка звука игр: эффекты и музыка из свободных наборов → public/audio.

Источники (все CC0 или общественное достояние, подробно — public/audio/CREDITS.txt):
  AUDIO_SFX   — клон github.com/Mcamento8/open-game-sfx-index, папка audio/
                (Kenney: impact, interface, ui, rpg, casino, sci-fi, music-jingles;
                OpenGameArt CC0: rpg-pack, battle, hits-punches)
  AUDIO_RAT   — клон github.com/Coahuilite/SqueakyRatkin, папка
                Extras/SqueakyRatkinExampleVoices/1.6/Race/Sounds/…/SR_ExampleTemplate_Race
  AUDIO_MUSIC — распакованный music-cc0.zip из github.com/jfpx/cc0-media-library
                (релиз music-v1), папка с music/catalog.json

Что делается с каждым звуком: декод в моно 44,1 кГц, обрезка тишины в начале
(удар должен звучать в тот же кадр, что и картинка), обрезка хвоста с
плавным затуханием, при нужде — сдвиг высоты и срез верхов, выравнивание
громкости (одна и та же средняя громкость у всех, пик не выше −1 дБ), MP3.
Музыка — стерео, постоянный сдвиг громкости к −19 LUFS без обрезки: длина
в сэмплах сохраняется, иначе петля перестанет сходиться.

Запуск: AUDIO_SFX=… AUDIO_RAT=… AUDIO_MUSIC=… python3 scripts/audio-build.py
Нужны numpy и ffmpeg (pip install numpy imageio-ffmpeg).
"""

import json
import math
import os
import random
import subprocess
import sys

import numpy as np

try:
    import imageio_ffmpeg

    FF = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:  # pragma: no cover
    FF = 'ffmpeg'

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'audio')
SFX = os.environ.get('AUDIO_SFX', '')
RAT = os.environ.get('AUDIO_RAT', '')
MUSIC = os.environ.get('AUDIO_MUSIC', '')
SR = 44100
random.seed(7)


def load(path, stereo=False):
    cmd = [FF, '-v', 'quiet', '-i', path, '-f', 'f32le', '-acodec', 'pcm_f32le',
           '-ac', '2' if stereo else '1', '-ar', str(SR), '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    a = np.frombuffer(raw, dtype=np.float32).copy()
    return a.reshape(-1, 2) if stereo else a


def save_mp3(a, path, stereo=False, kbps=96):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cmd = [FF, '-v', 'quiet', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2' if stereo else '1',
           '-i', '-', '-codec:a', 'libmp3lame', '-b:a', f'{kbps}k', '-ar', str(SR), path]
    subprocess.run(cmd, input=a.astype(np.float32).tobytes(), check=True)


def resample(a, rate):
    """Сдвиг высоты вместе со скоростью: rate 2 — на октаву выше и вдвое короче."""
    if abs(rate - 1) < 1e-3:
        return a
    n = int(len(a) / rate)
    x = np.arange(n) * rate
    return np.interp(x, np.arange(len(a)), a).astype(np.float32)


def lowpass(a, hz):
    """Однополюсный срез верхов дважды — мягкий, без звона."""
    k = math.exp(-2 * math.pi * hz / SR)
    out = a.copy()
    for _ in range(2):
        y = 0.0
        for i in range(len(out)):
            y = (1 - k) * out[i] + k * y
            out[i] = y
    return out


def trim_head(a, thresh_db=-45):
    peak = np.max(np.abs(a)) + 1e-9
    idx = np.nonzero(np.abs(a) > peak * 10 ** (thresh_db / 20))[0]
    if not len(idx):
        return a
    start = max(0, idx[0] - int(0.003 * SR))
    return a[start:]


def trim_tail(a, thresh_db=-50):
    peak = np.max(np.abs(a)) + 1e-9
    idx = np.nonzero(np.abs(a) > peak * 10 ** (thresh_db / 20))[0]
    return a[: idx[-1] + 1] if len(idx) else a


def fade(a, ms_in=2, ms_out=30):
    a = a.copy()
    i, o = int(ms_in * SR / 1000), int(ms_out * SR / 1000)
    if i:
        a[:i] *= np.linspace(0, 1, i)
    if o and len(a) > o:
        a[-o:] *= np.linspace(1, 0, o) ** 2
    return a


def active_rms(a):
    w = int(0.01 * SR)
    n = max(1, len(a) // w)
    fr = a[: n * w].reshape(n, w) if len(a) >= w else a.reshape(1, -1)
    r = np.sqrt(np.mean(fr ** 2, axis=1))
    act = r > np.max(r) * 0.05
    return float(np.sqrt(np.mean(fr[act] ** 2))) if act.any() else 1e-9


def normalize(a, rms_db=-18.0, peak_db=-1.0):
    g = 10 ** (rms_db / 20) / active_rms(a)
    peak = np.max(np.abs(a)) * g
    lim = 10 ** (peak_db / 20)
    if peak > lim:
        g *= lim / peak
    return a * g


def chirps(a, min_ms=45, max_ms=320, gap_ms=22):
    """Отдельные писки внутри серии: куски громче −30 дБ, разделённые паузой."""
    w = int(0.004 * SR)
    n = len(a) // w
    r = np.sqrt(np.mean(a[: n * w].reshape(n, w) ** 2, axis=1))
    on = r > np.max(r) * 0.08
    segs, s, quiet = [], None, 0
    for i, v in enumerate(on):
        if v:
            if s is None:
                s = i
            quiet = 0
        elif s is not None:
            quiet += 1
            if quiet * 4 >= gap_ms:
                segs.append((s, i - quiet + 1))
                s, quiet = None, 0
    if s is not None:
        segs.append((s, n))
    out = []
    for s, e in segs:
        ms = (e - s) * 4
        if min_ms <= ms <= max_ms:
            out.append(a[max(0, s * w - int(0.004 * SR)): e * w + int(0.02 * SR)])
    return out


# ---------------------------------------------------------------------------
# Что из чего собирается. Ключ — имя в игре (lib/sound.ts), значение — список
# вариантов: при каждом ударе играет случайный, чтобы сорок ударов подряд не
# звучали одной заевшей нотой.
# ---------------------------------------------------------------------------

def K(*parts):
    return os.path.join(SFX, *parts)


IMP = lambda n: K('impact-sounds', n + '.ogg')  # noqa: E731
IFC = lambda n: K('interface-sounds', n + '.ogg')  # noqa: E731
UIA = lambda n: K('ui-audio', n + '.ogg')  # noqa: E731
RPG = lambda n: K('rpg-audio', n + '.ogg')  # noqa: E731
CAS = lambda n: K('casino-audio', n + '.ogg')  # noqa: E731
SCI = lambda n: K('sci-fi-sounds', n + '.ogg')  # noqa: E731
JIN = lambda n: K('music-jingles', 'jingles_' + n + '.ogg')  # noqa: E731
OGR = lambda *p: K('oga-rpg-pack', 'RPG Sound Pack', *p)  # noqa: E731
OGB = lambda n: K('oga-battle', 'battle_sound_effects', n + '.wav')  # noqa: E731
HIT = lambda n: K('oga-hits-punches', 'hits', f'hit{n:02d}.mp3.flac')  # noqa: E731

# (источник, опции). Опции: dur — макс. длина, rate — высота, lp — срез
# верхов, start — сдвиг начала после обрезки тишины, rms — целевая
# громкость (по умолчанию −18 дБ), out — затухание хвоста, мс.
SOUNDS = {
    # ---- Интерфейс: пергамент и дерево — книга, страница, мешочек монет.
    'ui.tap': [(UIA('click1'), {}), (UIA('click2'), {}), (UIA('click3'), {})],
    'ui.open': [(RPG('bookOpen'), {'dur': 0.5})],
    'ui.close': [(RPG('bookClose'), {'dur': 0.45})],
    'ui.tab': [(RPG('bookFlip1'), {'dur': 0.35}), (RPG('bookFlip2'), {'dur': 0.35}), (RPG('bookFlip3'), {'dur': 0.35})],
    'ui.buy': [(RPG('handleCoins2'), {'dur': 0.4})],
    'ui.error': [(IFC('error_004'), {'lp': 3500, 'rms': -21})],
    'ui.ok': [(IFC('confirmation_001'), {'rms': -20})],

    # ---- Автоматы.
    'reel.stop': [(IMP(f'impactGeneric_light_00{i}'), {'dur': 0.2}) for i in range(5)],
    'reel.lever': [(RPG('metalLatch'), {}), (RPG('metalClick'), {'dur': 0.3})],
    'slot.tension': [(JIN('STEEL03'), {'rms': -20})],
    'slot.win.s': [(JIN('STEEL10'), {})],
    'slot.win.b': [(JIN('STEEL02'), {})],
    'slot.win.m': [(JIN('STEEL12'), {})],
    'slot.win.e': [(JIN('STEEL15'), {})],
    'slot.win.l': [(JIN('STEEL08'), {})],
    'slot.drum.1': [(JIN('HIT07'), {})],
    'slot.drum.2': [(JIN('HIT13'), {})],
    'slot.drum.3': [(JIN('HIT10'), {})],
    'slot.drum.4': [(JIN('HIT11'), {})],
    'slot.drum.5': [(JIN('HIT15'), {})],
    'chip': [(CAS(f'chips-collide-{i}'), {'dur': 0.22}) for i in range(1, 5)],
    'chip.lay': [(CAS(f'chip-lay-{i}'), {'dur': 0.14, 'rms': -20}) for i in range(1, 4)],
    'chips.stack': [(CAS(f'chips-stack-{i}'), {'dur': 0.3}) for i in (1, 3, 5)],
    'gem.chime': [(IFC('glass_001'), {'dur': 0.3}), (IFC('glass_002'), {'dur': 0.3})],
    'gem.burst': [(IMP(f'impactGlass_light_00{i}'), {'dur': 0.2, 'rms': -21}) for i in range(5)],
    'pluck': [(IFC('pluck_001'), {}), (IFC('pluck_002'), {})],
    'bubble': [(IFC('drop_001'), {}), (IFC('drop_004'), {'dur': 0.2})],
    'bubble.low': [(IFC('drop_002'), {}), (IFC('drop_003'), {})],
    'bubble.pop': [(IFC('drop_004'), {'dur': 0.12, 'rate': 1.6}), (IFC('glass_003'), {'dur': 0.1, 'rate': 1.3})],
    'orb.ring': [(IFC('glass_004'), {'dur': 0.6, 'out': 180, 'rms': -24})],
    'slam': [(IMP(f'impactPunch_heavy_00{i}'), {'dur': 0.35}) for i in range(3)],

    # ---- Шахта: материал слышен по удару.
    'pick.soil': [(IMP(f'impactSoft_medium_00{i}'), {'dur': 0.14}) for i in range(5)],
    'pick.stone': [(IMP(f'impactMining_00{i}'), {'dur': 0.26, 'out': 110}) for i in range(5)],
    'pick.metal': [(IMP(f'impactMetal_light_00{i}'), {'dur': 0.24, 'out': 120}) for i in range(5)],
    'pick.crystal': [(IMP(f'impactGlass_light_00{i}'), {'dur': 0.22, 'out': 100}) for i in range(5)],
    'pick.star': [(IFC(f'glass_00{i}'), {'dur': 0.3, 'out': 150}) for i in (1, 2, 5)],
    'crit.thud': [(IMP(f'impactPunch_medium_00{i}'), {'dur': 0.25}) for i in range(3)],
    'break.soil': [(IMP(f'impactSoft_heavy_00{i}'), {'dur': 0.3}) for i in range(4)],
    'break.stone': [(IMP(f'footstep_concrete_00{i}'), {'dur': 0.2}) for i in range(5)],
    'break.metal': [(IMP(f'impactMetal_medium_00{i}'), {'dur': 0.35, 'out': 150}) for i in range(4)],
    'break.crystal': [(IMP(f'impactGlass_medium_00{i}'), {'dur': 0.4, 'out': 180}) for i in range(4)],
    'bag.full': [(RPG('dropLeather'), {})],
    'rumble': [(SCI('spaceEngineLow_000'), {'start': 0.4, 'dur': 1.3, 'out': 500, 'rms': -16})],
    'boom.1': [(SCI('lowFrequency_explosion_001'), {'dur': 0.9, 'out': 300})],
    'boom.2': [(SCI('lowFrequency_explosion_000'), {'dur': 1.4, 'out': 500})],
    'boom.3': [(SCI('explosionCrunch_003'), {'dur': 1.4, 'out': 500})],
    'fuse': [(IFC('scratch_001'), {'lp': 6000, 'rms': -24})],
    'tick': [(IFC('tick_001'), {'lp': 5000, 'rms': -22}), (IFC('tick_002'), {'lp': 5000, 'rms': -22})],
    'case.tick': [(UIA(f'click{i}'), {'rms': -21}) for i in (1, 3, 5)],
    'jingle.found': [(JIN('PIZZI04'), {})],
    'jingle.up': [(JIN('PIZZI02'), {})],
    'jingle.go': [(JIN('PIZZI10'), {})],
    'jingle.down': [(JIN('PIZZI01'), {})],
    'jingle.nope': [(JIN('PIZZI05'), {'rms': -20})],
    # Те же фразы, что у автоматов, но пиццикато: в каторге стил-драм звучит
    # чужим — это казино, а не лагерь.
    'jingle.win': [(JIN('PIZZI15'), {})],
    'jingle.end': [(JIN('PIZZI12'), {})],
    'jingle.small': [(JIN('PIZZI08'), {})],

    # ---- Лес.
    'axe.chop': [(RPG('chop'), {})] + [(IMP(f'impactWood_medium_00{i}'), {'dur': 0.25}) for i in range(4)],
    'saw.bite': [(SCI('spaceEngine_002'), {'start': 0.6, 'dur': 0.34, 'rate': 1.8, 'lp': 5000, 'out': 90, 'rms': -21})],
    'log.drop': [(IMP(f'impactWood_light_00{i}'), {'dur': 0.25}) for i in range(5)],
    'tree.creak': [(RPG('creak1'), {}), (RPG('creak2'), {})],
    'tree.thud': [(IMP(f'impactWood_heavy_00{i}'), {'dur': 0.35}) for i in range(3)],
    'snow.thud': [(IMP(f'footstep_snow_00{i}'), {'dur': 0.3}) for i in range(3)],

    # ---- Подземелье.
    'swing': [(OGR('battle', n + '.wav'), {'dur': 0.28}) for n in ('swing', 'swing2', 'swing3')]
    + [(OGB(f'swish_{i}'), {'dur': 0.32}) for i in (2, 4)],
    'hit': [(HIT(n), {'dur': 0.3, 'out': 90}) for n in (1, 4, 7, 13, 16, 22, 28, 31)],
    'bite': [(OGR('NPC', 'beetle', n + '.wav'), {'dur': 0.3}) for n in ('bite-small', 'bite-small2', 'bite-small3')],
    'dash': [(OGB('swish_3'), {'dur': 0.3, 'rate': 1.15})],
    'crate': [(IMP('impactPlank_medium_000'), {'dur': 0.5, 'out': 200}), (IMP('impactPlank_medium_002'), {'dur': 0.5, 'out': 200})],
    'coins': [(RPG('handleCoins'), {'dur': 0.5}), (RPG('handleCoins2'), {'dur': 0.4})],
    'cloth': [(RPG(f'cloth{i}'), {'dur': 0.3, 'rms': -21}) for i in (1, 2, 3)],
    'gate': [(RPG('doorClose_1'), {'dur': 0.6, 'out': 250}), (RPG('doorClose_3'), {'dur': 0.6, 'out': 250})],
    'clang': [(IMP(f'impactMetal_heavy_00{i}'), {'dur': 0.5, 'out': 250}) for i in range(3)],
    'latch': [(RPG('metalLatch'), {})],
    'winch': [(RPG('creak3'), {'rms': -21})],
    'roar': [(OGR('NPC', 'giant', f'giant{i}.wav'), {'dur': 0.9, 'out': 300}) for i in (1, 2)],

    # ---- Живность шахты и риск-игра (v2.64).
    'card.deal': [(CAS(f'card-slide-{i}'), {'dur': 0.3, 'rms': -20}) for i in (1, 3, 5, 7)],
    'card.flip': [(CAS(f'card-place-{i}'), {'dur': 0.22}) for i in range(1, 5)],
    'card.shuffle': [(CAS('card-shuffle'), {'dur': 0.8, 'out': 250, 'rms': -20})],
    'card.fan': [(CAS('card-fan-1'), {'dur': 0.5, 'out': 150}), (CAS('card-fan-2'), {'dur': 0.5, 'out': 150})],
    'flap': [(RPG(f'cloth{i}'), {'dur': 0.16, 'rate': 1.35, 'out': 60, 'rms': -22}) for i in (1, 2, 3, 4)],
    'shiny': [(IFC(f'glass_00{i}'), {'dur': 0.25, 'rate': 1.25, 'out': 120}) for i in (1, 2, 5, 6)],

    # ---- Рыбалка (v2.65). Воды в наборах Kenney нет: всплеск — пузыри
    # «RPG Sound Pack» ниже тоном, падение поплавка — капли интерфейса.
    'splash': [(OGR('inventory', n + '.wav'), {'dur': 0.5, 'rate': 0.72, 'lp': 3000, 'out': 180}) for n in ('bubble', 'bubble2', 'bubble3')],
    'plop': [(IFC(f'drop_00{i}'), {'rate': 0.7, 'lp': 2600, 'out': 90}) for i in (2, 3)],
    'snap': [(RPG('knifeSlice'), {'dur': 0.25, 'rate': 1.35}), (RPG('knifeSlice2'), {'dur': 0.25, 'rate': 1.35})],
}

# Писки крыс: одиночные, вырезанные из серий (частое событие не должно звучать
# очередью). Группа → файлы набора.
RAT_SETS = {
    'rat.call': ['Call/call_01', 'Call/call_03', 'Select/select_01', 'Move/move_02', 'Joy/joy_03'],
    'rat.attack': ['Attack/attack_01', 'Attack/attack_03', 'Draft/draft_03', 'Wounded/wounded_02'],
    'rat.die': ['Death/death_01', 'Wounded/wounded_01', 'Wounded/wounded_03', 'Call/call_04'],
    # Летучая мышь пищит тоньше крысы: те же писки на кварту выше.
    'bat.squeak': ['Joy/joy_01', 'Select/select_02', 'Call/call_02'],
}
# Сдвиг высоты для набора писков (по умолчанию — как есть).
RAT_RATE = {'bat.squeak': 1.4}

# Музыка по сценам. Выбрана по замерам (без прослушивания): тёплые треки с
# ровной динамикой и малой долей резкой середины 2–6 кГц (`harsh` < 0,13).
MUSIC_SCENES = {
    'hall': 'Sketchbook 2024-12-04',
    'slots': 'Sketchbook 2024-09-12',
    'cascade': 'Sketchbook 2024-09-22',
    'yard': 'Sketchbook 2024-05-29',
    'mine': 'Sketchbook 2024-10-16',
    'forest': 'Sketchbook 2024-06-26',
    'lobby': 'Shrine',
    'depths': 'Patreon Challenge 04',
    'boss': 'Ludum Dare 30 03',
    'fishing': 'Ambient Relaxing Loop',
}


def reel_loop():
    """Петля вращения барабана: мягкие щелчки 13 раз в секунду, срезанные
    по верхам, на сетке, которая делится на длину петли, — стык не слышен."""
    clicks = [trim_tail(trim_head(load(UIA(f'click{i}')))) for i in (1, 2, 3)]
    clicks = [lowpass(c[: int(0.05 * SR)], 3200) for c in clicks]
    n = int(2.0 * SR)
    out = np.zeros(n, dtype=np.float32)
    step = n // 26
    for k in range(26):
        c = clicks[k % 3] * (0.6 + 0.4 * random.random())
        at = k * step + random.randint(-int(0.004 * SR), int(0.004 * SR))
        at = max(0, min(n - len(c), at))
        out[at: at + len(c)] += c
    return normalize(out, rms_db=-24)


def build_sfx():
    manifest, credits = {}, []
    for name, variants in SOUNDS.items():
        k = 0
        for src, opt in variants:
            a = trim_head(load(src))
            if opt.get('start'):
                a = a[int(opt['start'] * SR):]
            if opt.get('rate'):
                a = resample(a, opt['rate'])
            if opt.get('lp'):
                a = lowpass(a, opt['lp'])
            a = trim_tail(a)
            if opt.get('dur'):
                a = a[: int(opt['dur'] * SR)]
            a = fade(a, ms_out=opt.get('out', 40))
            a = normalize(a, rms_db=opt.get('rms', -18))
            k += 1
            save_mp3(a, os.path.join(OUT, 'sfx', f'{name}.{k}.mp3'), kbps=96)
            credits.append((f'sfx/{name}.{k}.mp3', os.path.relpath(src, SFX)))
        manifest[name] = k
    for name, files in RAT_SETS.items():
        k = 0
        for f in files:
            path = [os.path.join(RAT, f + '.ogg')][0]
            for c in chirps(trim_head(load(path)))[:2]:
                c = resample(c, RAT_RATE.get(name, 1))
                c = fade(c, ms_out=25)
                c = normalize(c, rms_db=-20)
                k += 1
                save_mp3(c, os.path.join(OUT, 'sfx', f'{name}.{k}.mp3'), kbps=96)
                credits.append((f'sfx/{name}.{k}.mp3', 'SqueakyRatkin ' + f))
        manifest[name] = k
    save_mp3(reel_loop(), os.path.join(OUT, 'sfx', 'reel.spin.1.mp3'), kbps=96)
    manifest['reel.spin'] = 1
    credits.append(('sfx/reel.spin.1.mp3', 'ui-audio/click1-3 (собрано в петлю)'))
    return manifest, credits


def loudness(path):
    """Интегральная громкость EBU R128 в LUFS."""
    r = subprocess.run([FF, '-hide_banner', '-i', path, '-af', 'ebur128', '-f', 'null', '-'],
                       capture_output=True, text=True).stderr
    lines = [ln for ln in r.splitlines() if ln.strip().startswith('I:')]
    return float(lines[-1].split()[1])


def build_music():
    cat = json.load(open(os.path.join(MUSIC, 'music', 'catalog.json')))
    by_title = {t['title']: t for t in cat['tracks']}
    manifest, credits = {}, []
    for scene, title in MUSIC_SCENES.items():
        t = by_title[title]
        src = os.path.join(MUSIC, t['path'])
        a = load(src, stereo=True)
        lufs = loudness(src)
        g = 10 ** ((-19 - lufs) / 20)
        peak = float(np.max(np.abs(a))) * g
        if peak > 0.89:  # −1 дБ: громче не тянем, пусть будет тише
            g *= 0.89 / peak
        a = a * g
        save_mp3(a, os.path.join(OUT, 'music', f'{scene}.mp3'), stereo=True, kbps=96)
        manifest[scene] = {'dur': round(len(a) / SR, 5)}
        credits.append((f'music/{scene}.mp3', f"«{t['title']}» — {t['author']}, {t['license']}, {t['source']}"))
    return manifest, credits


def main():
    if not (SFX and RAT and MUSIC):
        sys.exit('Нужны AUDIO_SFX, AUDIO_RAT и AUDIO_MUSIC — см. шапку файла')
    import shutil
    for d in ('sfx', 'music'):  # CREDITS.txt ведётся руками и не трогается
        shutil.rmtree(os.path.join(OUT, d), ignore_errors=True)
    sfx, c1 = build_sfx()
    music, c2 = build_music()
    import hashlib
    h = hashlib.sha1()
    for dp, _, fs in sorted(os.walk(OUT)):
        for fn in sorted(fs):
            if fn.endswith('.mp3'):
                h.update(open(os.path.join(dp, fn), 'rb').read())
    ts = [
        '// Сгенерировано scripts/audio-build.py — не править руками.',
        '// Число вариантов у каждого звука и длина каждой музыкальной петли.',
        '',
        '/** Ревизия набора: входит в адрес файла, чтобы кеш не отдал старый звук. */',
        f"export const AUDIO_REV = '{h.hexdigest()[:8]}';",
        '',
        f'export const SFX_VARIANTS: Record<string, number> = {json.dumps(sfx, ensure_ascii=False, indent=2)};',
        '',
        f'export const MUSIC_TRACKS = {json.dumps(music, ensure_ascii=False, indent=2)} as const;',
        '',
    ]
    open(os.path.join(ROOT, 'src', 'lib', 'audio-manifest.ts'), 'w').write('\n'.join(ts))
    with open(os.path.join(OUT, 'SOURCES.txt'), 'w') as f:
        for out, src in c1 + c2:
            f.write(f'{out}\t{src}\n')
    total = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fs in os.walk(OUT) for fn in fs)
    print(f'{sum(sfx.values())} эффектов, {len(music)} треков, {total / 1e6:.1f} МБ')


if __name__ == '__main__':
    main()
