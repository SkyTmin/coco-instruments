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
  AUDIO_SRC   — (v2.83, звуки этажей 6–15) папка с клонами, по умолчанию
                scripts/audio-src (в git не лежит). Внутри:
                  cdda-sp/  github.com/Fris0uman/CDDA-Soundpacks, sound/CC-Sounds —
                            только файлы, у которых в credits.md CC0 или CC-BY
                  esc50/    клипы github.com/karolpiczak/ESC-50 (audio/*.wav) —
                            только клипы с [CC0] в его LICENSE (там авторство
                            каждого клипа); meta.json — выписка авторства
                  vsco/     github.com/sgossner/VSCO-2-CE (CC0)
                  vcsl/     github.com/sgossner/VCSL (CC0)
                  sonicpi/  etc/samples из github.com/sonic-pi-net/sonic-pi (CC0)
                Клонировать можно без содержимого (--filter=blob:none
                --no-checkout) и доставать только нужные файлы.

Что делается с каждым звуком: декод в моно 44,1 кГц, обрезка тишины в начале
(удар должен звучать в тот же кадр, что и картинка), обрезка хвоста с
плавным затуханием, при нужде — сдвиг высоты и срез верхов, выравнивание
громкости (одна и та же средняя громкость у всех, пик не выше −1 дБ), MP3.
Музыка — стерео, постоянный сдвиг громкости к −19 LUFS без обрезки: длина
в сэмплах сохраняется, иначе петля перестанет сходиться.

Запуск: AUDIO_SFX=… AUDIO_RAT=… AUDIO_MUSIC=… python3 scripts/audio-build.py
Один звук или одна музыкальная сцена: … --only=thunder,sky (музыке нужен
AUDIO_MUSIC, эффектам — AUDIO_SFX и/или AUDIO_SRC).
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
MORE = os.environ.get('AUDIO_SRC', os.path.join(ROOT, 'scripts', 'audio-src'))
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
    """
    Однополюсный срез верхов дважды — мягкий, без звона. Нарочно питоновским
    циклом, а не scipy: lfilter расходится с ним на единицу последнего знака
    float32, и LAME выдаёт другие байты — старые звуки при пересборке
    перестали бы совпадать с тем, что лежит в git (проверено на rank.up).
    """
    k = math.exp(-2 * math.pi * hz / SR)
    out = a.astype(np.float32).copy()
    for _ in range(2):
        y = 0.0
        for i in range(len(out)):
            y = (1 - k) * out[i] + k * y
            out[i] = y
    return out


def highpass(a, hz):
    """Срез низа (Баттерворт 4-го порядка, 24 дБ/окт): инфразвук телефон
    всё равно не сыграет, а запас громкости он съедает — гром и пушка без
    него громче на слух. «Вычесть срез верхов» пробовал: это 6 дБ/окт, и у
    взрыва гул на 40–80 Гц оставался хозяином смеси."""
    from scipy.signal import butter, sosfilt
    sos = butter(4, hz, 'highpass', fs=SR, output='sos')
    return sosfilt(sos, a).astype(np.float32)


def loopable(a, ms=250):
    """Петля без щелчка: хвост плавно перетекает в начало (равная мощность),
    длина становится короче на `ms`. Для гула, который включают и выключают."""
    n = int(ms * SR / 1000)
    if len(a) < 3 * n:
        return a
    t = np.linspace(0, math.pi / 2, n)
    head, tail = a[:n], a[-n:]
    body = a[n:-n].copy()
    mixed = tail * np.cos(t) + head * np.sin(t)
    return np.concatenate([body, mixed]).astype(np.float32)


def glide(a, r0, r1):
    """Высота плавно едет от r0 к r1 (эффект Доплера у поезда: подъезжает
    выше, уходит ниже). Длина меняется на среднюю из двух."""
    n_out = int(len(a) / ((r0 + r1) / 2))
    rates = np.linspace(r0, r1, n_out)
    x = np.cumsum(rates) - rates[0]
    x = x[x < len(a) - 1]
    return np.interp(x, np.arange(len(a)), a).astype(np.float32)


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
OGL = lambda n: K('oga-gui-lokif', 'GUI_Sound_Effects_by_Lokif', n + '.wav')  # noqa: E731
ZOM = lambda n: K('oga-zombies', 'zombies', n + '.wav')  # noqa: E731

# v2.83 — звуки этажей 6–15. Исходники — в AUDIO_SRC (см. шапку).
CDD = lambda *p: os.path.join(MORE, 'cdda-sp', 'sound', 'CC-Sounds', *p)  # noqa: E731
ESC = lambda n: os.path.join(MORE, 'esc50', n + '.wav')  # noqa: E731
VSC = lambda *p: os.path.join(MORE, 'vsco', *p)  # noqa: E731
MIS = lambda n: os.path.join(MORE, 'vsco', 'Miscellania Raw', 'Misc 1', n + '.wav')  # noqa: E731
VCS = lambda *p: os.path.join(MORE, 'vcsl', *p)  # noqa: E731
SPI = lambda n: os.path.join(MORE, 'sonicpi', n + '.flac')  # noqa: E731
TRANH = lambda n: VCS('Chordophones', 'Zithers', 'Dan Tranh', n + '.wav')  # noqa: E731
WHISTLE = lambda n: VCS('Aerophones', 'Edge-blown Aerophones', 'Train Whistle, Toy', n + '.wav')  # noqa: E731

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
    # Шаги на площади и в зданиях (v2.80): тихие, короткие, пять вариантов — один
    # вариант подряд на каждом шаге читается пилой. Бетон — площадь, дерево — полы.
    'step.ground': [(IMP(f'footstep_concrete_00{i}'), {'dur': 0.16, 'lp': 2200, 'rms': -29}) for i in range(5)],
    'step.wood': [(IMP(f'footstep_wood_00{i}'), {'dur': 0.16, 'lp': 2400, 'rms': -29}) for i in range(5)],
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
    # Мягкие фразы каторги (v2.67.3). Владелец: «звук, когда переходишь на
    # новый этаж, ужасный… звуки должны быть мягкими и приятными». Там
    # стоял удар тарелки (`slot.drum.3` — шум по всей полосе до 10 кГц почти
    # секунду) и пиццикато поверх. Здесь — чистые тоны без шума и щелчка:
    # `rank.up` — нарастающий аккорд до-ми-соль-до с атакой 0,9 с (новый
    # этаж, престиж, легендарная кирка), `soft.up` — то же арпеджио
    # колокольчиком, на малую терцию ниже и со срезанными верхами (редкая
    # награда, перековка, уровень героя).
    'rank.up': [(OGL('save'), {'dur': 2.6, 'lp': 3200, 'out': 900, 'rms': -21})],
    'soft.up': [(OGL('positive'), {'dur': 1.3, 'rate': 0.84, 'lp': 2600, 'out': 450, 'rms': -22})],

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

    # ---- Этажи 6–15 подземелья (v2.83): стихии, механизмы, время, финал.
    # Правило v2.67.3 в силе: мягко. Всё, что по природе звонкое (стекло,
    # цепи, пар, влажное), ниже тоном и со срезанными верхами; замеры с
    # A-весом — в отчёте выпуска. `from` — нужное место в длинной записи.
    #
    # Гром — далёкий раскат без треска: верх срезан на 1,6 кГц (треск и
    # дождь уходят), низ ниже 45 Гц тоже — телефон его не сыграет.
    'thunder': [
        (ESC('5-156999-A-19'), {'from': 0.6, 'dur': 3.8, 'hp': 45, 'lp': 1600, 'in': 60, 'out': 1500, 'rms': -19}),
        (ESC('3-144891-A-19'), {'from': 0.4, 'dur': 3.4, 'hp': 45, 'lp': 1600, 'in': 60, 'out': 1400, 'rms': -19}),
        (CDD('environment', 'weather', 'thunder_far.ogg'), {'from': 1.4, 'dur': 4.0, 'hp': 45, 'lp': 1600, 'in': 250, 'out': 1600, 'rms': -19}),
    ],
    # Порыв ветра: кусок ровного ветра, собранный в «нарастает и уходит».
    'wind': [
        (ESC('3-117504-A-16'), {'from': 0.5, 'dur': 2.4, 'lp': 2400, 'in': 700, 'out': 1100, 'rms': -21}),
        (ESC('5-117773-A-16'), {'from': 1.2, 'dur': 2.4, 'lp': 2400, 'in': 700, 'out': 1100, 'rms': -21}),
        (ESC('5-179496-B-16'), {'from': 0.6, 'dur': 2.4, 'lp': 2400, 'in': 700, 'out': 1100, 'rms': -21}),
    ],
    # Лава: пузыри воды на полскорости (октава вниз — густо), шипение —
    # вода на камнях сауны и пар над огнём.
    'lava.bubble': [
        (MIS('bubbles'), {'from': 0.3, 'rate': 0.55, 'lp': 1800, 'dur': 1.2, 'out': 350, 'rms': -20}),
        (MIS('bubbles2'), {'from': 0.8, 'rate': 0.5, 'lp': 1800, 'dur': 1.2, 'out': 350, 'rms': -20}),
        (MIS('bubbles4'), {'rate': 0.55, 'lp': 1800, 'dur': 1.2, 'out': 350, 'rms': -20}),
    ],
    # Шипение лавы — ниже пара и с бульканьем под ним: густое, а не свист.
    'lava.hiss': [
        ([(SPI('ambi_sauna'), {'len': 1.8, 'rate': 0.85}, 0, 1.0), (MIS('bubbles4'), {'rate': 0.5}, 0.1, 0.35)],
         {'lp': 2200, 'dur': 1.6, 'in': 30, 'out': 800, 'rms': -22}),
        ([(SPI('ambi_sauna'), {'from': 3.0, 'len': 1.8, 'rate': 0.85}, 0, 1.0), (MIS('bubbles'), {'from': 0.3, 'rate': 0.5}, 0.1, 0.35)],
         {'lp': 2200, 'dur': 1.6, 'in': 120, 'out': 800, 'rms': -22}),
        (ESC('5-213802-A-12'), {'from': 1.0, 'dur': 1.6, 'lp': 2200, 'in': 150, 'out': 800, 'rms': -22}),
    ],
    # Пар из клапана: резкий вход, долгое шипение, верх срезан.
    # Пар из клапана: резкий вход, долгое шипение. Шипение и есть середина
    # 1–3 кГц — срез на 2,6–3 кГц оставляет его, а свист выше убирает.
    # (Рёв сопла Kenney `thrusterFire` пробовал: после среза остаётся гул,
    # центр 290 Гц, — это не пар.)
    'steam': [
        (SPI('ambi_sauna'), {'from': 5.2, 'dur': 1.3, 'rate': 1.08, 'hp': 250, 'lp': 2600, 'in': 15, 'out': 800, 'rms': -22}),
        (SPI('ambi_sauna'), {'from': 1.0, 'dur': 1.3, 'rate': 1.08, 'hp': 250, 'lp': 2600, 'in': 15, 'out': 800, 'rms': -22}),
        (ESC('5-213802-A-12'), {'from': 2.0, 'dur': 1.3, 'hp': 250, 'lp': 3000, 'in': 15, 'out': 800, 'rms': -22}),
    ],
    # Стекло: осколки на треть ниже и без верхов — «хрусть», а не визг.
    # Стекло звонкое по природе: взяты три самых мягких из девятнадцати
    # замеренных записей (A-вес выше 2,5 кГц — 8–24%, у тарелки было 46%).
    'glass.break': [
        (MIS('glass_break3'), {'rate': 0.62, 'lp': 2600, 'out': 250, 'rms': -21}),
        (ESC('4-212698-A-39'), {'lp': 2800, 'dur': 0.9, 'out': 300, 'rms': -21}),
        (CDD('smash_fail', 'glass', 'smash_fail_glass.ogg'), {'rate': 0.8, 'lp': 2400, 'out': 120, 'rms': -21}),
    ],
    # Струна (бива): щипок вьетнамской цитры данчань — ближайшее к лютне в
    # свободных наборах. Все варианты подогнаны к одной ноте (фа-диез), чтобы
    # `stringPluck(k)` держал лад.
    'string': [
        (TRANH('Normal/F#3_mf_1'), {'dur': 1.6, 'out': 700}),
        (TRANH('Normal/G#3_mf_1'), {'rate': 2 ** (-2 / 12), 'dur': 1.6, 'out': 700}),
        (TRANH('Normal/D#3_mf_1'), {'rate': 2 ** (3 / 12), 'dur': 1.6, 'out': 700}),
    ],
    'string.bend': [(TRANH('Gliss/Gliss_Dwn_Med_mf_1'), {'dur': 1.8, 'out': 800, 'rms': -20})],
    # Поезд: проход с Доплером (подъезжает выше, уходит ниже), гудок —
    # игрушечный паровозный свисток октавой ниже.
    'train': [
        (ESC('3-136451-A-45'), {'dur': 4.4, 'hp': 40, 'lp': 3000, 'glide': (1.05, 0.95), 'in': 1300, 'out': 1700, 'rms': -18}),
        (ESC('3-159445-A-45'), {'dur': 4.4, 'hp': 40, 'lp': 3000, 'glide': (1.05, 0.95), 'in': 1300, 'out': 1700, 'rms': -18}),
    ],
    'train.horn': [
        (WHISTLE('Main_TrainLow_Sus-001'), {'rate': 0.5, 'dur': 1.9, 'lp': 3000, 'in': 60, 'out': 600, 'rms': -20}),
        (WHISTLE('Main_TrainLow_Double-001'), {'rate': 0.5, 'dur': 2.4, 'lp': 3000, 'in': 60, 'out': 600, 'rms': -20}),
    ],
    # Часы: одиночные удары из записей настенных часов, бой — трубчатый
    # колокол (оба варианта — до, чтобы бой шёл одной нотой).
    'clock.tick': [
        (ESC('5-210571-A-38'), {'from': 1.15, 'len': 0.25, 'lp': 3000, 'out': 60, 'rms': -24}),
        (ESC('5-210571-A-38'), {'from': 2.2, 'len': 0.25, 'lp': 3000, 'out': 60, 'rms': -24}),
        (ESC('1-62849-A-38'), {'from': 1.25, 'len': 0.25, 'lp': 2500, 'out': 60, 'rms': -24}),
        (ESC('1-62849-A-38'), {'from': 2.25, 'len': 0.25, 'lp': 2500, 'out': 60, 'rms': -24}),
    ],
    'clock.bell': [
        (VSC('Percussion', 'TB_hit_C4_v4_rr1.wav'), {'dur': 3.4, 'lp': 3000, 'out': 1800, 'rms': -20}),
        (VCS('Idiophones', 'Struck Idiophones', 'Tubular Bells 1', 'chimes_C4_ff_rr2.wav'), {'dur': 3.4, 'lp': 3000, 'out': 1800, 'rms': -20}),
    ],
    # Сердце: «тук-тук» из двух ударов литавры. Большой барабан пробовал —
    # центр 147 Гц, на динамике телефона от него остаётся тишина; у литавры
    # центр ~380 Гц, удар слышен и там.
    'heart': [
        ([(VSC('Percussion', 'Timpani', 'Timpani2_Hit_v4_rr1_Sum.wav'), {'len': 0.35, 'rate': 0.8}, 0, 1.0),
          (VSC('Percussion', 'Timpani', 'Timpani2_Hit_v4_rr1_Sum.wav'), {'len': 0.3, 'rate': 0.9}, 0.2, 0.7)],
         {'lp': 900, 'dur': 0.8, 'out': 200, 'rms': -17}),
        ([(VSC('Percussion', 'Timpani', 'Timpani2_Hit_v4_rr1_Sum.wav'), {'len': 0.35, 'rate': 0.85}, 0, 1.0),
          (VSC('Percussion', 'Timpani', 'Timpani2_Hit_v4_rr1_Sum.wav'), {'len': 0.3, 'rate': 0.95}, 0.18, 0.65)],
         {'lp': 900, 'dur': 0.8, 'out': 200, 'rms': -17}),
        ([(VSC('Percussion', 'Timpani', 'Timpani2_Hit_v4_rr1_Sum.wav'), {'len': 0.35, 'rate': 0.75}, 0, 1.0),
          (VSC('Percussion', 'Timpani', 'Timpani2_Hit_v4_rr1_Sum.wav'), {'len': 0.3, 'rate': 0.84}, 0.21, 0.7)],
         {'lp': 900, 'dur': 0.8, 'out': 200, 'rms': -17}),
    ],
    # Плоть: шлепки и чавканье ниже тоном, верх срезан на 2 кГц.
    'flesh': [
        (CDD('melee_hit_flesh', 'small_bash', 'small_bash_flesh_1.ogg'), {'rate': 0.8, 'lp': 2000, 'out': 150, 'rms': -20}),
        (CDD('melee_hit_flesh', 'small_bash', 'small_bash_flesh_3.ogg'), {'rate': 0.8, 'lp': 2000, 'out': 150, 'rms': -20}),
        (CDD('melee_hit_flesh', 'big_stabbing', 'big_stabbing_flesh_1.ogg'), {'rate': 0.75, 'lp': 1800, 'out': 200, 'rms': -20}),
        (CDD('mon_death', 'zombie_gibbed', 'zombie_gibbed_1.ogg'), {'rate': 0.85, 'lp': 2000, 'dur': 0.8, 'out': 250, 'rms': -20}),
    ],
    # Телепорт: вдох (свист задом наперёд — нарастает и обрывается) и хлопок.
    'warp': [
        ([(SPI('ambi_swoosh'), {'from': 0.9, 'len': 0.9, 'rev': True, 'in': 200}, 0, 1.0),
          (SCI('forceField_001'), {'rate': 1.2}, 0.35, 0.45),
          (IFC('drop_004'), {'rate': 0.8}, 0.86, 0.9)],
         {'lp': 4000, 'dur': 1.3, 'out': 250, 'rms': -19}),
        ([(SPI('ambi_dark_woosh'), {'from': 1.6, 'len': 1.1, 'rev': True, 'in': 250}, 0, 1.0),
          (SCI('forceField_003'), {'rate': 1.1}, 0.5, 0.45),
          (IFC('drop_001'), {'rate': 0.75}, 1.06, 0.9)],
         {'lp': 4000, 'dur': 1.5, 'out': 250, 'rms': -19}),
    ],
    # Камень трётся о камень: кирпичом по кирпичу, ниже тоном — тяжелее.
    'stone.grind': [
        (MIS('brick_scrape'), {'rate': 0.7, 'lp': 2000, 'out': 300, 'rms': -20}),
        (MIS('brick_scrape2'), {'rate': 0.7, 'lp': 2000, 'out': 300, 'rms': -20}),
        (MIS('brick_scrape2'), {'rate': 0.55, 'lp': 1800, 'out': 400, 'rms': -20}),
    ],
    # Цепь на вороте — из одной долгой записи три места: звенья, а не звон
    # (короткие «chain_grind»/«chain_loop» того же набора — 33–41% выше 2,5 кГц).
    'chains': [
        (MIS('chaingrindLoop'), {'from': 1.4, 'rate': 0.85, 'lp': 2600, 'dur': 1.2, 'in': 60, 'out': 400, 'rms': -21}),
        (MIS('chaingrindLoop'), {'from': 4.0, 'rate': 0.85, 'lp': 2600, 'dur': 1.2, 'in': 60, 'out': 400, 'rms': -21}),
        (MIS('chaingrindLoop'), {'from': 6.5, 'rate': 0.85, 'lp': 2600, 'dur': 1.2, 'in': 60, 'out': 400, 'rms': -21}),
    ],
    # Пушка — глухо: хлопок пускового устройства и хвост взрыва. Хвост без
    # самого низа (hp 160): инфразвук взрыва телефон не сыграет, а громкость
    # выстрела он съедает — хлопок тонул.
    'cannon': [
        ([(CDD('fire_gun', 'launchers', 'launcher_1.ogg'), {}, 0, 1.0),
          (CDD('explosion', 'huge', 'explosion_huge_2.ogg'), {'hp': 160}, 0.01, 0.32)],
         {'hp': 50, 'lp': 2400, 'dur': 1.8, 'out': 900, 'rms': -17}),
        ([(CDD('explosion', 'small', 'explosion_small.ogg'), {}, 0, 1.0),
          (CDD('explosion', 'huge', 'explosion_huge_1.ogg'), {'len': 2.2, 'hp': 160}, 0.0, 0.32)],
         {'hp': 50, 'lp': 2400, 'dur': 1.8, 'out': 900, 'rms': -17}),
    ],
    # Лазер: гул силового поля, «вжух» луча октавой ниже и гул двигателя —
    # разовый луч; `laser.hum` — петля для долгого луча.
    'laser': [
        ([(SCI('forceField_000'), {}, 0, 0.8),
          (SCI('laserLarge_000'), {'rate': 0.6}, 0.18, 0.5),
          (SCI('spaceEngineSmall_000'), {'from': 0.5, 'len': 1.1, 'in': 80, 'pout': 500}, 0.18, 0.8)],
         {'lp': 2600, 'dur': 1.4, 'out': 500, 'rms': -20}),
        ([(SCI('forceField_002'), {}, 0, 0.8),
          (SCI('laserLarge_002'), {'rate': 0.6}, 0.16, 0.45),
          (SCI('spaceEngineSmall_000'), {'from': 2.0, 'len': 1.1, 'in': 80, 'pout': 500}, 0.16, 0.8)],
         {'lp': 2600, 'dur': 1.4, 'out': 500, 'rms': -20}),
    ],
    'laser.hum': [(SCI('spaceEngineSmall_000'), {'from': 0.6, 'dur': 3.0, 'lp': 2600, 'loop': True, 'xfade': 400, 'rms': -22})],
    # Время: остановка — гонг задом наперёд (нарастает и обрывается) и
    # глухой удар; пуск — выдох свиста и тихий гонг.
    'time.stop': [
        ([(VSC('Percussion', 'gongHit_mf.wav'), {'len': 2.0, 'rev': True, 'in': 900}, 0, 0.9),
          (SPI('ambi_swoosh'), {'from': 0.9, 'len': 0.9, 'rev': True, 'in': 200}, 1.1, 0.7),
          (VSC('Percussion', 'BDrumNewhit_v4_rr1_Sum.wav'), {'len': 1.0}, 2.0, 1.0)],
         {'lp': 2500, 'dur': 3.0, 'out': 900, 'rms': -19}),
    ],
    'time.go': [
        ([(SPI('ambi_swoosh'), {'from': 0.8, 'rate': 1.1}, 0, 1.0),
          (VSC('Percussion', 'gongHit_p.wav'), {'len': 1.4}, 0, 0.35)],
         {'lp': 2500, 'dur': 1.4, 'out': 600, 'rms': -20}),
    ],
    # Хор финала: «а-а» хора и тот же хор октавой ниже, под ним гонг,
    # перед ним гонг задом наперёд — вдох перед ударом.
    'choir': [
        ([(VSC('Percussion', 'gongHit_mf.wav'), {'len': 0.9, 'rev': True, 'in': 500}, 0, 0.5),
          (SPI('ambi_choir'), {}, 0.6, 1.0),
          (SPI('ambi_choir'), {'rate': 0.5}, 0.6, 0.55),
          (VSC('Percussion', 'gongHit_p.wav'), {'len': 3.0}, 0.6, 0.35)],
         {'lp': 3500, 'dur': 4.2, 'out': 1500, 'rms': -20}),
    ],
    # Рёв крупного зверя: рык зомби на кварту ниже и огр под ним.
    'beast': [
        ([(ZOM('zombie-17'), {'rate': 0.72}, 0, 1.0), (OGR('NPC', 'ogre', 'ogre3.wav'), {'rate': 0.78}, 0.04, 0.55)],
         {'lp': 2600, 'dur': 2.0, 'out': 700, 'rms': -18}),
        ([(ZOM('zombie-21'), {'rate': 0.7}, 0, 1.0), (OGR('NPC', 'gutteral beast', 'mnstr14.wav'), {'rate': 0.7}, 0.05, 0.5)],
         {'lp': 2600, 'dur': 1.8, 'out': 700, 'rms': -18}),
        ([(ZOM('zombie-1'), {'rate': 0.7}, 0, 1.0), (OGR('NPC', 'giant', 'giant5.wav'), {'rate': 0.8}, 0.03, 0.6)],
         {'lp': 2600, 'dur': 1.6, 'out': 600, 'rms': -18}),
    ],
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
    # v2.83 — этажи 11–15. Выбор тем же способом, по замерам
    # (scripts/audio-src/music_measure.py и music_pulse.py, не в git):
    # «небо» (этаж 11) — «Heavenly Loop»: эмбиент, harsh 0,001, выше 2,5 кГц
    # 0,2%, пульс 0,36 — лёгкая подложка без ударов, первый светлый этаж.
    'sky': 'Heavenly Loop',
    # «финал» (бой с Хозяином подземелья) — «Ludum Dare 30 08»: тот же
    # альбом, что у обычного босса («Ludum Dare 30 03»), но громче (−11,3
    # против −13,3 LUFS), с чётким битом (пульс 0,62 против 0,34, 129 уд/мин)
    # и всё ещё мягкий (harsh 0,015, выше 2,5 кГц 6%).
    'finale': 'Ludum Dare 30 08',
    # «часы» (этаж 14) — «Unsolved Investigation» (саспенс-эмбиент, 120
    # уд/мин, ровно 48 с = 96 долей) и поверх тиканье настенных часов раз в
    # секунду, тик-так: 48 ударов ровно в сетку петли.
    'clock': {
        'title': 'Unsolved Investigation',
        'ticks': {
            'files': [(ESC('5-210571-A-38'), {'from': 1.15, 'len': 0.25}),
                      (ESC('5-210571-A-38'), {'from': 2.2, 'len': 0.25, 'rate': 0.9})],
            'period': 1.0, 'lp': 2600, 'db': -12,
        },
    },
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


def src_name(path):
    """Путь исходника для SOURCES.txt: от корня его набора."""
    for root in (SFX, MORE):
        if root and os.path.abspath(path).startswith(os.path.abspath(root) + os.sep):
            return os.path.relpath(path, root)
    return os.path.basename(path)


def prep(src, opt):
    """
    Один исходник с опциями: from — сдвиг от начала файла (до обрезки
    тишины), start — сдвиг после обрезки тишины (если не `raw`), len —
    длина отрезка ДО обработки, rev — задом наперёд
    (обратный вдох: звук нарастает и обрывается), rate, hp, lp, in/pout —
    затухания отрезка, мс. Порядок для обычного звука прежний
    (обрезка → сдвиг → высота → срез), поэтому старые звуки собираются
    байт в байт как раньше.
    """
    a = load(src)
    if opt.get('from'):  # сдвиг от начала файла, ДО обрезки тишины: нужный удар в серии
        a = a[int(opt['from'] * SR):]
    if not opt.get('raw'):
        a = trim_head(a)
    if opt.get('start'):
        a = a[int(opt['start'] * SR):]
    if opt.get('len'):
        a = a[: int(opt['len'] * SR)]
    if opt.get('rev'):
        a = a[::-1].copy()
        if not opt.get('raw'):
            a = trim_head(a)
    if opt.get('rate'):
        a = resample(a, opt['rate'])
    if opt.get('glide'):
        a = glide(a, *opt['glide'])
    if opt.get('hp'):
        a = highpass(a, opt['hp'])
    if opt.get('lp'):
        a = lowpass(a, opt['lp'])
    if opt.get('in') or opt.get('pout'):
        a = fade(a, ms_in=opt.get('in', 0), ms_out=opt.get('pout', 0))
    return a


def mix(parts):
    """Склейка из нескольких записей: [(путь, опции, сдвиг с, громкость)].
    Так собраны «тук-тук» сердца, вдох-хлопок телепорта, аккорд гудка."""
    layers = []
    for src, opt, at, gain in parts:
        a = prep(src, opt)
        a = a / (np.max(np.abs(a)) + 1e-9) * gain
        layers.append((int(at * SR), a))
    n = max(off + len(a) for off, a in layers)
    out = np.zeros(n, dtype=np.float32)
    for off, a in layers:
        out[off: off + len(a)] += a
    return out


def build_variant(src, opt):
    """
    Вариант звука: одна запись или склейка (`src` — список частей). Опции
    варианта: dur — длина готового звука, in/out — затухания, мс, loop —
    петля без щелчка (xfade — длина перетекания), rms — громкость; у
    склейки ещё hp/lp на всю смесь.
    """
    if isinstance(src, list):
        a = mix(src)
        cred = ' + '.join(src_name(p[0]) for p in src)
    else:
        a = prep(src, {k: v for k, v in opt.items() if k not in ('in', 'out', 'dur', 'loop', 'rms')})
        cred = src_name(src)
    if not opt.get('raw'):
        a = trim_tail(a)
    if opt.get('dur'):
        a = a[: int(opt['dur'] * SR)]
    if isinstance(src, list):
        if opt.get('hp'):
            a = highpass(a, opt['hp'])
        if opt.get('lp'):
            a = lowpass(a, opt['lp'])
    if opt.get('loop'):
        a = loopable(a, opt.get('xfade', 250))
    else:
        a = fade(a, ms_in=opt.get('in', 2), ms_out=opt.get('out', 40))
    a = normalize(a, rms_db=opt.get('rms', -18))
    return a, cred


# Длины петель эффектов (опция `loop`), с: страница ставит по ним точки петли,
# как у музыки, — иначе хвостовая тишина MP3, если браузер её не срежет,
# щёлкала бы на каждом круге.
LOOP_DUR = {}


def build_one(name, variants):
    """Один звук из SOUNDS: варианты `name.k.mp3`. Возвращает (число, авторство)."""
    k, credits = 0, []
    for src, opt in variants:
        a, cred = build_variant(src, opt)
        k += 1
        if opt.get('loop') and k == 1:
            LOOP_DUR[name] = round(len(a) / SR, 5)
        save_mp3(a, os.path.join(OUT, 'sfx', f'{name}.{k}.mp3'), kbps=96)
        credits.append((f'sfx/{name}.{k}.mp3', cred))
    return k, credits


def build_sfx():
    manifest, credits = {}, []
    for name, variants in SOUNDS.items():
        manifest[name], c = build_one(name, variants)
        credits += c
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


def build_track(scene, by_title):
    """
    Одна музыкальная сцена. Значение MUSIC_SCENES — название трека или
    словарь {title, lufs?, ticks?}: `ticks` накладывает на петлю тиканье часов
    (этаж 14) — удары ровно в сетку, которая делится на длину петли, поэтому
    стык не слышен, а длина трека в сэмплах не меняется.
    """
    spec = MUSIC_SCENES[scene]
    if isinstance(spec, str):
        spec = {'title': spec}
    t = by_title[spec['title']]
    src = os.path.join(MUSIC, t['path'])
    a = load(src, stereo=True)
    lufs = loudness(src)
    g = 10 ** ((spec.get('lufs', -19) - lufs) / 20)
    a = a * g
    cred = f"«{t['title']}» — {t['author']}, {t['license']}, {t['source']}"
    tk = spec.get('ticks')
    if tk:
        a = a + tick_bed(len(a), tk)[:, None]
        cred += ' + тиканье: ' + ', '.join(sorted({src_name(p) for p, _ in tk['files']}))
    peak = float(np.max(np.abs(a)))
    if peak > 0.89:  # −1 дБ: громче не тянем, пусть будет тише
        a = a * (0.89 / peak)
    save_mp3(a, os.path.join(OUT, 'music', f'{scene}.mp3'), stereo=True, kbps=96)
    return {'dur': round(len(a) / SR, 5)}, (f'music/{scene}.mp3', cred)


def tick_bed(n, tk):
    """
    Дорожка тиканья под музыку: тик и так (два разных щелчка, «так» ниже),
    период подогнан так, чтобы в петлю влезало целое число ударов, громкость
    на `db` ниже музыки, верхи срезаны — часы идут где-то в стене, а не над ухом.
    """
    clicks = []
    for p, o in tk['files']:
        c = prep(p, o)[: int(0.12 * SR)]
        c = lowpass(c, tk.get('lp', 2600))
        c = fade(c, ms_out=30)
        clicks.append(c / (np.max(np.abs(c)) + 1e-9))
    beats = max(1, round(n / (tk.get('period', 1.0) * SR)))
    step = n / beats
    out = np.zeros(n, dtype=np.float32)
    for i in range(beats):
        c = clicks[i % len(clicks)] * (0.85 if i % 2 else 1.0)
        at = int(i * step)
        m = min(len(c), n - at)
        out[at: at + m] += c[:m]
    return out * (10 ** (tk.get('db', -24) / 20))


def build_music(only=None):
    cat = json.load(open(os.path.join(MUSIC, 'music', 'catalog.json')))
    by_title = {t['title']: t for t in cat['tracks']}
    manifest, credits = {}, []
    for scene in MUSIC_SCENES:
        if only is not None and scene not in only:
            continue
        manifest[scene], c = build_track(scene, by_title)
        credits.append(c)
    return manifest, credits


def audio_rev():
    import hashlib
    h = hashlib.sha1()
    for dp, _, fs in sorted(os.walk(OUT)):
        for fn in sorted(fs):
            if fn.endswith('.mp3'):
                h.update(open(os.path.join(dp, fn), 'rb').read())
    return h.hexdigest()[:8]


def write_manifest(sfx, music, loops=None):
    loops = {**LOOP_DUR} if loops is None else loops
    ts = [
        '// Сгенерировано scripts/audio-build.py — не править руками.',
        '// Число вариантов у каждого звука и длина каждой музыкальной петли.',
        '',
        '/** Ревизия набора: входит в адрес файла, чтобы кеш не отдал старый звук. */',
        f"export const AUDIO_REV = '{audio_rev()}';",
        '',
        f'export const SFX_VARIANTS: Record<string, number> = {json.dumps(sfx, ensure_ascii=False, indent=2)};',
        '',
        '/** Длина петли у эффектов-петель, с (гул долгого луча): точки петли. */',
        f'export const SFX_LOOPS: Record<string, number> = {json.dumps(loops, ensure_ascii=False, indent=2)};',
        '',
        f'export const MUSIC_TRACKS = {json.dumps(music, ensure_ascii=False, indent=2)} as const;',
        '',
    ]
    open(os.path.join(ROOT, 'src', 'lib', 'audio-manifest.ts'), 'w').write('\n'.join(ts))


def rebuild_only(names):
    """
    Пересобрать только названные эффекты или музыкальные сцены
    (`--only=rank.up,soft.up,sky`): эффектам нужны их исходники (AUDIO_SFX
    и/или AUDIO_SRC), сцене — AUDIO_MUSIC. Остальные файлы и их авторство не
    трогаются — исходники музыки и писков весят сотни мегабайт, и держать
    их ради одного нового звука незачем.
    """
    import re
    path = os.path.join(ROOT, 'src', 'lib', 'audio-manifest.ts')
    src = open(path).read()
    sfx = json.loads(re.search(r'SFX_VARIANTS: Record<string, number> = (\{.*?\});', src, re.S)[1])
    music = json.loads(re.search(r'MUSIC_TRACKS = (\{.*?\}) as const;', src, re.S)[1])
    m = re.search(r'SFX_LOOPS: Record<string, number> = (\{.*?\});', src, re.S)
    loops = json.loads(m[1]) if m else {}
    src_lines = open(os.path.join(OUT, 'SOURCES.txt')).read().splitlines()
    tracks = [n for n in names if n in MUSIC_SCENES]
    if tracks:
        if not MUSIC:
            sys.exit('Нужен AUDIO_MUSIC — см. шапку файла')
        got, credits = build_music(set(tracks))
        music.update(got)
        for o, s in credits:
            src_lines = [ln for ln in src_lines if not ln.startswith(o + '\t')]
            src_lines.append(f'{o}\t{s}')
    for name in names:
        if name in MUSIC_SCENES:
            continue
        if name not in SOUNDS:
            sys.exit(f'Нет такого звука в SOUNDS: {name}')
        for fn in os.listdir(os.path.join(OUT, 'sfx')):
            if fn.startswith(name + '.') and fn[len(name) + 1:-4].isdigit():
                os.remove(os.path.join(OUT, 'sfx', fn))
        sfx[name], credits = build_one(name, SOUNDS[name])
        loops.pop(name, None)
        if name in LOOP_DUR:
            loops[name] = LOOP_DUR[name]
        # Ровно файлы этого звука: у `train` и `train.horn` общее начало имени,
        # и `startswith('sfx/train.')` стирал бы строки гудка.
        own = re.compile(rf'^sfx/{re.escape(name)}\.\d+\.mp3\t')
        src_lines = [ln for ln in src_lines if not own.match(ln)]
        src_lines += [f'{o}\t{s}' for o, s in credits]
    write_manifest(sfx, music, loops)
    with open(os.path.join(OUT, 'SOURCES.txt'), 'w') as f:
        f.write('\n'.join(src_lines) + '\n')
    print(f'пересобрано: {", ".join(names)}')


def main():
    only = [a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--only=')]
    if only:
        rebuild_only([n for n in only[0].split(',') if n])
        return
    if not (SFX and RAT and MUSIC):
        sys.exit('Нужны AUDIO_SFX, AUDIO_RAT и AUDIO_MUSIC — см. шапку файла')
    import shutil
    for d in ('sfx', 'music'):  # CREDITS.txt ведётся руками и не трогается
        shutil.rmtree(os.path.join(OUT, d), ignore_errors=True)
    sfx, c1 = build_sfx()
    music, c2 = build_music()
    write_manifest(sfx, music)
    with open(os.path.join(OUT, 'SOURCES.txt'), 'w') as f:
        for out, src in c1 + c2:
            f.write(f'{out}\t{src}\n')
    total = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fs in os.walk(OUT) for fn in fs)
    print(f'{sum(sfx.values())} эффектов, {len(music)} треков, {total / 1e6:.1f} МБ')


if __name__ == '__main__':
    main()
