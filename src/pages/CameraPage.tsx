import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog, Sheet } from '@/components/ui';
import { IconBack, IconImage, IconList, IconPencil, IconSwap, IconTrash } from '@/components/icons';
import { registerEscape } from '@/lib/escape-stack';
import { attachmentHref, fileToAttachment } from '@/lib/images';
import { notifySuccess, notifyWarning, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';
import { useFinanceStore } from '@/store';
import type { CameraSketch, SketchFilter } from '@/types';

// ---------------------------------------------------------------------------
// Сетки композиции: тонкие полупрозрачные линии поверх видоискателя.
// Пропорции — доли кадра: трети 1/3–2/3, золотое сечение 1/φ ≈ 0.382/0.618.
// ---------------------------------------------------------------------------

type GridMode = 'none' | 'thirds' | 'golden' | 'center';

const GRID_MODES: GridMode[] = ['none', 'thirds', 'golden', 'center'];

const GRID_LABELS: Record<GridMode, string> = {
  none: 'Без сетки',
  thirds: 'Трети',
  golden: 'Золото',
  center: 'Центр',
};

const GRID_RATIOS: Partial<Record<GridMode, [number, number]>> = {
  thirds: [1 / 3, 2 / 3],
  golden: [0.382, 0.618],
};

function GridOverlay({ mode }: { mode: GridMode }) {
  if (mode === 'none') return null;
  if (mode === 'center') {
    return (
      <div className="camera-grid" aria-hidden="true">
        <div className="camera-grid__v" style={{ left: '50%' }} />
        <div className="camera-grid__h" style={{ top: '50%' }} />
        <div className="camera-grid__circle" />
      </div>
    );
  }
  const [a, b] = GRID_RATIOS[mode]!;
  return (
    <div className="camera-grid" aria-hidden="true">
      <div className="camera-grid__v" style={{ left: `${a * 100}%` }} />
      <div className="camera-grid__v" style={{ left: `${b * 100}%` }} />
      <div className="camera-grid__h" style={{ top: `${a * 100}%` }} />
      <div className="camera-grid__h" style={{ top: `${b * 100}%` }} />
    </div>
  );
}

// Фильтры эскиза (редактирование): CSS-фильтр поверх референса.
const SKETCH_FILTERS: { v: SketchFilter; label: string }[] = [
  { v: 'none', label: 'Цвет' },
  { v: 'gray', label: 'Серый' },
  { v: 'bw', label: 'Ч/Б' },
];

export const SKETCH_FILTER_CSS: Record<SketchFilter, string> = {
  none: 'none',
  gray: 'grayscale(1)',
  bw: 'grayscale(1) contrast(1.9) brightness(1.05)',
};

// ---------------------------------------------------------------------------
// Камера: живой видоискатель + сетки + полупрозрачный эскиз-референс.
// Эскизы и снимки хранятся в сторе (и через него — на сервере).
// ---------------------------------------------------------------------------

type Facing = 'environment' | 'user';

// starting → on | denied (нет разрешения) | error (камера занята/не нашлась)
// | unsupported (нет getUserMedia — старый WebView или не-HTTPS).
type CamStatus = 'starting' | 'on' | 'denied' | 'error' | 'unsupported';

// Снимки в галерею уходят крупнее обычных фото (сервер принимает до 3 МБ).
const SHOT_MAX_SIDE = 2560;

const shotName = () =>
  `coco-photo-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.jpg`;

const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const pluralWords = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'слово';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'слова';
  return 'слов';
};

export function CameraPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const sketches = useFinanceStore((s) => s.cameraSketches);
  const addSketch = useFinanceStore((s) => s.addCameraSketch);
  const updateSketch = useFinanceStore((s) => s.updateCameraSketch);
  const removeSketch = useFinanceStore((s) => s.removeCameraSketch);
  const addShot = useFinanceStore((s) => s.addCameraShot);
  const scripts = useFinanceStore((s) => s.cameraScripts);
  const addScript = useFinanceStore((s) => s.addCameraScript);
  const updateScript = useFinanceStore((s) => s.updateCameraScript);
  const removeScript = useFinanceStore((s) => s.removeCameraScript);
  const prompterPrefs = useFinanceStore((s) => s.prompterPrefs);
  const setPrompterPrefs = useFinanceStore((s) => s.setPrompterPrefs);
  const hydrated = useFinanceStore((s) => s.hydrated);

  const [status, setStatus] = useState<CamStatus>('starting');
  const [facing, setFacing] = useState<Facing>('environment');
  const [canFlip, setCanFlip] = useState(true);
  const [gridMode, setGridMode] = useState<GridMode>('thirds');
  const [activeSketchId, setActiveSketchId] = useState<string | null>(null);
  const [refOpacity, setRefOpacity] = useState(0.4);
  const [sketchSheet, setSketchSheet] = useState(false);
  const [sketchBusy, setSketchBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [flash, setFlash] = useState(false);
  // Мгновенная миниатюра последнего кадра (пока идёт фоновая загрузка).
  const [lastThumb, setLastThumb] = useState<string | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const hdRef = useRef<HTMLInputElement>(null);

  // ---- видео ----------------------------------------------------------------
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [recSecs, setRecSecs] = useState(0);
  const [micOk, setMicOk] = useState<boolean | null>(null); // null = ещё не спрашивали
  const [videoResult, setVideoResult] = useState<{
    blob: Blob;
    url: string;
    secs: number;
  } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recSecsRef = useRef(0);

  // ---- суфлёр ---------------------------------------------------------------
  const [prompterOpen, setPrompterOpen] = useState(false);
  const [prompterPlaying, setPrompterPlaying] = useState(false);
  const [scriptsSheet, setScriptsSheet] = useState(false);
  const [editingScript, setEditingScript] = useState<{
    id?: string;
    title: string;
    text: string;
  } | null>(null);
  const [pendingScriptDelete, setPendingScriptDelete] = useState<string | null>(null);
  const prompterScrollRef = useRef<HTMLDivElement>(null);
  // Палец на тексте приостанавливает автопрокрутку: можно подтянуть пропущенное
  // назад прямо во время чтения, отпустил — суфлёр продолжает с нового места.
  const prompterDragRef = useRef(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const activeScript =
    scripts.find((s) => s.id === prompterPrefs.scriptId) ?? scripts[0];

  const activeSketch: CameraSketch | undefined = sketches.find((s) => s.id === activeSketchId);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startStream = useCallback(async (want: Facing) => {
    stopStream();
    setStatus('starting');
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }
    try {
      // ideal → трек сам берёт максимум, который умеет матрица/WebView.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: want, width: { ideal: 4096 }, height: { ideal: 2160 } },
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {}); // autoplay уже разрешён (muted+playsInline)
      }
      setStatus('on');
    } catch (err) {
      const name = (err as DOMException)?.name;
      setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
    }
  }, []);

  useEffect(() => {
    void startStream('environment');
    return () => {
      stopStream();
    };
  }, [startStream]);

  // Освобождаем object URL миниатюры при замене/уходе со страницы.
  useEffect(
    () => () => {
      if (lastThumb) URL.revokeObjectURL(lastThumb);
    },
    [lastThumb],
  );

  // Одна камера (десктоп/ноутбук) — прячем кнопку переключения.
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((list) => setCanFlip(list.filter((d) => d.kind === 'videoinput').length !== 1))
      .catch(() => {});
  }, [status]);

  const cycleGrid = () => {
    selectionChanged();
    setGridMode((m) => GRID_MODES[(GRID_MODES.indexOf(m) + 1) % GRID_MODES.length]);
  };

  const flipCamera = () => {
    tapLight();
    const next: Facing = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    void startStream(next);
  };

  // Экран не должен гаснуть, пока открыта камера (особенно во время записи).
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    const acquire = () => {
      navigator.wakeLock
        ?.request('screen')
        .then((l) => {
          if (!alive) void l.release();
          else lock = l;
        })
        .catch(() => {});
    };
    acquire();
    const onVis = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      void lock?.release().catch(() => {});
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // ---- видео: запись ----------------------------------------------------------

  // Микрофон запрашиваем лениво — при первом входе в режим «Видео», чтобы
  // фотографы никогда не видели лишний запрос.
  const ensureAudio = async (): Promise<MediaStreamTrack | null> => {
    const existing = audioStreamRef.current?.getAudioTracks()[0];
    if (existing && existing.readyState === 'live') return existing;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = s;
      setMicOk(true);
      return s.getAudioTracks()[0];
    } catch {
      setMicOk(false);
      return null;
    }
  };

  useEffect(
    () => () => {
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    },
    [],
  );

  const switchMode = (next: 'photo' | 'video') => {
    if (recording || countdown !== null) return;
    selectionChanged();
    setMode(next);
    if (next === 'video' && micOk === null) void ensureAudio();
  };

  // iOS отдаёт mp4 (H.264), Android/Chrome — webm; берём первое поддержанное.
  const pickMime = (): string | null => {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm',
    ];
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  };

  const beginRecording = async () => {
    if (recording || countdown !== null) return;
    const mime = pickMime();
    if (mime === null) {
      notifyWarning();
      return;
    }
    tapMedium();
    const aTrack = await ensureAudio(); // запрос до отсчёта, не во время
    // Отсчёт 3-2-1 — время принять позу и найти первую строку суфлёра.
    for (let i = 3; i >= 1; i -= 1) {
      setCountdown(i);
      await new Promise((r) => setTimeout(r, 900));
    }
    setCountdown(null);
    const vTrack = streamRef.current?.getVideoTracks()[0];
    if (!vTrack || vTrack.readyState !== 'live') {
      notifyWarning();
      return;
    }
    try {
      const rec = new MediaRecorder(
        new MediaStream(aTrack ? [vTrack, aTrack] : [vTrack]),
        mime ? { mimeType: mime } : undefined,
      );
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        if (recTimerRef.current) clearInterval(recTimerRef.current);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'video/mp4' });
        chunksRef.current = [];
        setVideoResult((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return { blob, url: URL.createObjectURL(blob), secs: recSecsRef.current };
        });
        setRecording(false);
        setPrompterPlaying(false);
        notifySuccess();
      };
      recorderRef.current = rec;
      rec.start(1000);
      recSecsRef.current = 0;
      setRecSecs(0);
      recTimerRef.current = setInterval(() => {
        recSecsRef.current += 1;
        setRecSecs(recSecsRef.current);
      }, 1000);
      setRecording(true);
      // Суфлёр стартует вместе с записью — читать и записывать одним жестом.
      if (prompterOpen && activeScript) {
        const el = prompterScrollRef.current;
        if (el && el.scrollTop >= el.scrollHeight - el.clientHeight - 1) el.scrollTop = 0;
        setPrompterPlaying(true);
      }
    } catch {
      notifyWarning();
    }
  };

  const stopRecording = () => {
    tapMedium();
    recorderRef.current?.stop();
    recorderRef.current = null;
  };

  const closeVideo = () => {
    tapLight();
    setVideoResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  const videoOpen = !!videoResult;
  useEffect(() => {
    if (!videoOpen) return undefined;
    return registerEscape(() =>
      setVideoResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return null;
      }),
    );
  }, [videoOpen]);

  // Видео не помещается в серверный лимит (3 МБ) — сохраняем сразу на телефон
  // или в чат через системное меню, как экспорт данных.
  const saveVideo = async () => {
    if (!videoResult) return;
    tapLight();
    const isMp4 = (videoResult.blob.type || '').includes('mp4');
    const file = new File(
      [videoResult.blob],
      `coco-video-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${isMp4 ? 'mp4' : 'webm'}`,
      { type: videoResult.blob.type || (isMp4 ? 'video/mp4' : 'video/webm') },
    );
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Coco Камера' });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = videoResult.url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // ---- эскизы ---------------------------------------------------------------

  const pickSketchFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSketchBusy(true);
    try {
      const att = await fileToAttachment(file);
      const sketch = addSketch(att);
      setActiveSketchId(sketch.id);
      setSketchSheet(false);
      notifySuccess();
    } catch {
      notifyWarning();
    } finally {
      setSketchBusy(false);
    }
  };

  const applySketch = (id: string) => {
    selectionChanged();
    setActiveSketchId(id);
    setSketchSheet(false);
  };

  const deleteSketch = (id: string) => {
    notifyWarning();
    if (activeSketchId === id) setActiveSketchId(null);
    removeSketch(id);
    setPendingDelete(null);
  };

  const setFilter = (filter: SketchFilter) => {
    if (!activeSketch) return;
    selectionChanged();
    updateSketch(activeSketch.id, { filter });
  };

  // ---- суфлёр: автопрокрутка ------------------------------------------------

  // rAF-цикл: копим позицию в float (scrollTop округляется браузером) и
  // авто-пауза, когда текст дочитан. На паузе панель листается пальцем.
  useEffect(() => {
    if (!prompterPlaying) return undefined;
    const el = prompterScrollRef.current;
    if (!el) return undefined;
    let raf = 0;
    let pos = el.scrollTop;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (prompterDragRef.current) {
        // Пользователь перематывает пальцем — не мешаем, только следим за позицией.
        pos = el.scrollTop;
        raf = requestAnimationFrame(tick);
        return;
      }
      pos = Math.min(pos + prompterPrefs.speed * dt, el.scrollHeight - el.clientHeight);
      el.scrollTop = pos;
      if (pos >= el.scrollHeight - el.clientHeight - 0.5) {
        setPrompterPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [prompterPlaying, prompterPrefs.speed]);

  // Telegram back/Esc закрывает суфлёр раньше, чем уводит со страницы.
  useEffect(() => {
    if (!prompterOpen) return undefined;
    return registerEscape(() => {
      setPrompterPlaying(false);
      setPrompterOpen(false);
    });
  }, [prompterOpen]);

  // Смена текста — начинаем с начала.
  useEffect(() => {
    setPrompterPlaying(false);
    if (prompterScrollRef.current) prompterScrollRef.current.scrollTop = 0;
  }, [activeScript?.id]);

  const togglePrompter = () => {
    tapLight();
    setPrompterPlaying(false);
    setPrompterOpen((v) => !v);
  };

  const togglePlaying = () => {
    if (!activeScript) return;
    selectionChanged();
    setPrompterPlaying((v) => !v);
  };

  const restartPrompter = () => {
    tapLight();
    if (prompterScrollRef.current) prompterScrollRef.current.scrollTop = 0;
    setPrompterPlaying(false);
  };

  // Скорость показываем множителем от «обычного темпа речи» (×1 = 40 пикс/сек):
  // ×0.75 медленнее, ×1.5 быстрее — как скорость воспроизведения в плеерах.
  const BASE_SPEED = 40;
  const speedLabel = `${(prompterPrefs.speed / BASE_SPEED).toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
  })}×`;

  const bumpSpeed = (d: number) => {
    selectionChanged();
    setPrompterPrefs({ speed: Math.max(10, Math.min(120, prompterPrefs.speed + d)) });
  };

  const bumpFont = (d: number) => {
    selectionChanged();
    setPrompterPrefs({ fontSize: Math.max(16, Math.min(40, prompterPrefs.fontSize + d)) });
  };

  const chooseScript = (id: string) => {
    selectionChanged();
    setPrompterPrefs({ scriptId: id });
    setScriptsSheet(false);
  };

  // Поле текста растёт под содержимое (до ~половины экрана) — длинную речь
  // видно целиком, ничего не приходится листать в три строки.
  const growEditor = () => {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, window.innerHeight * 0.45)}px`;
  };
  const editorOpen = !!editingScript;
  useEffect(() => {
    if (editorOpen) requestAnimationFrame(growEditor);
  }, [editorOpen]);

  const editorWords = editingScript
    ? editingScript.text.trim().split(/\s+/).filter(Boolean).length
    : 0;
  // ~150 слов в минуту — средний темп речи на камеру.
  const editorSecs = Math.round(editorWords / 2.5);

  const saveScript = () => {
    const e = editingScript;
    if (!e || !e.text.trim()) return;
    tapLight();
    const title = e.title.trim() || e.text.trim().slice(0, 30);
    if (e.id) {
      updateScript(e.id, { title, text: e.text });
    } else {
      const created = addScript(title, e.text);
      setPrompterPrefs({ scriptId: created.id });
    }
    setEditingScript(null);
    notifySuccess();
  };

  const deleteScript = (id: string) => {
    notifyWarning();
    removeScript(id);
    if (prompterPrefs.scriptId === id) setPrompterPrefs({ scriptId: undefined });
    setPendingScriptDelete(null);
  };

  // ---- съёмка ---------------------------------------------------------------

  // Как на камере iPhone: снимок молча уходит в галерею приложения, видоискатель
  // не перекрывается — момент не теряется. Кадр виден миниатюрой вверху справа.
  const saveToAppGallery = async (blob: Blob) => {
    try {
      const file = new File([blob], shotName(), { type: blob.type || 'image/jpeg' });
      const att = await fileToAttachment(file, SHOT_MAX_SIDE);
      addShot(att);
    } catch {
      notifyWarning();
    }
  };

  const registerShot = (blob: Blob) => {
    setFlash(true);
    setLastThumb((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    notifySuccess();
    void saveToAppGallery(blob);
  };

  const takePhoto = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || capturing) return;
    setCapturing(true);
    tapMedium();
    try {
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 2d');
      // Фронталка в видоискателе зеркальная — снимок зеркалим так же,
      // чтобы получилось ровно то, что человек видел на экране.
      if (facing === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(v, 0, 0);
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/jpeg', 0.92),
      );
      if (!blob) throw new Error('toBlob');
      registerShot(blob);
    } catch {
      notifyWarning();
    } finally {
      setCapturing(false);
    }
  };

  // Съёмка с клавиш: кнопки громкости (там, где WebView отдаёт их как клавиши —
  // iOS, увы, не отдаёт: ни громкость, ни Camera Control недоступны вебу),
  // плюс Enter/Пробел на десктопе.
  const takePhotoRef = useRef<() => void>(() => {});
  takePhotoRef.current = () => {
    if (status !== 'on' || sketchSheet || pendingDelete || scriptsSheet || editingScript) return;
    void takePhoto();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const volume = ['AudioVolumeUp', 'AudioVolumeDown', 'VolumeUp', 'VolumeDown'].includes(
        e.key,
      );
      const t = e.target as HTMLElement | null;
      const onControl =
        !!t && ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      if (volume || ((e.key === 'Enter' || e.key === ' ') && !onControl)) {
        e.preventDefault();
        takePhotoRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // «HD-снимок»: file input с capture открывает НАТИВНУЮ камеру iOS — она
  // отдаёт фото в полном разрешении матрицы (~12 МП), недоступном через
  // getUserMedia. Компромисс: во время нативной съёмки сетки и эскиз не видны,
  // поэтому кадр сначала компонуют в нашем видоискателе.
  const pickHd = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    registerShot(file);
    // Нативная камера могла оборвать наш видеопоток — оживляем видоискатель.
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') void startStream(facing);
    else void videoRef.current?.play().catch(() => {});
  };

  const goBack = () => {
    tapLight();
    navigate(-1);
  };

  const blocked = status === 'denied' || status === 'error' || status === 'unsupported';

  return (
    <div className="camera">
      <video
        ref={videoRef}
        className={`camera-video${facing === 'user' ? ' is-mirrored' : ''}`}
        autoPlay
        muted
        playsInline
      />

      {status === 'on' && <GridOverlay mode={gridMode} />}
      {status === 'on' && activeSketch && (
        <img
          className="camera-ref"
          src={attachmentHref(activeSketch.photo)}
          alt=""
          style={{ opacity: refOpacity, filter: SKETCH_FILTER_CSS[activeSketch.filter] }}
        />
      )}

      <div className="camera-top">
        <span className="camera-top__cluster">
          <button className="camera-btn camera-btn--icon" onClick={goBack} aria-label="Назад">
            <IconBack size={20} />
          </button>
          {status === 'on' && (
            <button
              className={`camera-btn camera-btn--icon${prompterOpen ? ' is-on' : ''}`}
              onClick={togglePrompter}
              aria-label="Суфлёр"
            >
              <IconList size={19} />
            </button>
          )}
        </span>
        {status === 'on' && (
          <>
            {recording ? (
              <div className="camera-rec">
                <span className="camera-rec__dot" />
                {fmtSecs(recSecs)}
              </div>
            ) : (
              <button className="camera-btn" onClick={cycleGrid}>
                {GRID_LABELS[gridMode]}
              </button>
            )}
            <span className="camera-top__cluster">
              <button
                className={`camera-btn camera-btn--icon${lastThumb ? ' camera-btn--shot' : ''}`}
                onClick={() => {
                  tapLight();
                  navigate('/camera/gallery');
                }}
                aria-label="Галерея снимков"
              >
                {lastThumb ? <img src={lastThumb} alt="" /> : <IconImage size={19} />}
              </button>
              {canFlip && (
                <button
                  className="camera-btn camera-btn--icon"
                  onClick={flipCamera}
                  disabled={recording || countdown !== null}
                  aria-label="Сменить камеру"
                >
                  <IconSwap size={20} />
                </button>
              )}
            </span>
          </>
        )}
      </div>

      {/* Суфлёр: панель у верха экрана — глаза остаются рядом с фронталкой.
          Тап по тексту — старт/пауза, на паузе текст листается пальцем. */}
      {status === 'on' && prompterOpen && (
        <div className="prompter">
          <div className="prompter__bar">
            <button
              className="prompter__btn"
              onClick={togglePlaying}
              disabled={!activeScript}
              aria-label={prompterPlaying ? 'Пауза' : 'Читать'}
            >
              {prompterPlaying ? '❚❚' : '▶'}
            </button>
            <button className="prompter__btn" onClick={restartPrompter} aria-label="Сначала">
              ⟲
            </button>
            <span className="prompter__spacer" />
            <button className="prompter__btn" onClick={() => bumpFont(-2)} aria-label="Шрифт меньше">
              A−
            </button>
            <button className="prompter__btn" onClick={() => bumpFont(2)} aria-label="Шрифт больше">
              A+
            </button>
            <button
              className="prompter__btn"
              onClick={() => bumpSpeed(-10)}
              aria-label="Медленнее"
            >
              −
            </button>
            <span className="prompter__speed" title="Скорость прокрутки">
              {speedLabel}
            </span>
            <button className="prompter__btn" onClick={() => bumpSpeed(10)} aria-label="Быстрее">
              +
            </button>
            <button
              className="prompter__btn"
              onClick={() => {
                tapLight();
                setPrompterPlaying(false);
                setScriptsSheet(true);
              }}
              aria-label="Тексты"
            >
              <IconPencil size={14} />
            </button>
          </div>
          {activeScript ? (
            <div
              ref={prompterScrollRef}
              className="prompter__scroll"
              onClick={togglePlaying}
              onTouchStart={() => (prompterDragRef.current = true)}
              onTouchEnd={() => (prompterDragRef.current = false)}
              onTouchCancel={() => (prompterDragRef.current = false)}
            >
              <div className="prompter__text" style={{ fontSize: prompterPrefs.fontSize }}>
                {activeScript.text}
              </div>
            </div>
          ) : (
            <div className="prompter__empty">
              <p>Добавьте текст — он будет плавно прокручиваться, пока вы говорите в камеру.</p>
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => {
                  tapLight();
                  setScriptsSheet(true);
                }}
              >
                Выбрать текст
              </button>
            </div>
          )}
          {activeScript && <div className="prompter__line" aria-hidden="true" />}
        </div>
      )}

      {status === 'starting' && (
        <div className="camera-state">
          <div className="route-spinner" />
          <p>Запускаю камеру…</p>
        </div>
      )}

      {blocked && (
        <div className="camera-state">
          <div className="camera-state__icon">📷</div>
          <h2>
            {status === 'unsupported' ? 'Камера недоступна в этом окружении' : 'Нужен доступ к камере'}
          </h2>
          <p>
            {status === 'denied' &&
              'Чтобы показывать видоискатель с сетками и эскизами, приложению нужен доступ к камере. Нажмите «Разрешить» и подтвердите запрос Telegram. Если запрос не появляется — доступ был запрещён раньше: включите камеру для Telegram в настройках телефона.'}
            {status === 'error' &&
              'Не удалось запустить камеру — возможно, её использует другое приложение. Закройте его и попробуйте ещё раз.'}
            {status === 'unsupported' &&
              'Этот WebView не поддерживает доступ к камере (getUserMedia). Обновите Telegram до свежей версии и откройте приложение заново.'}
          </p>
          {status !== 'unsupported' && (
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => void startStream(facing)}
            >
              Разрешить камеру
            </button>
          )}
        </div>
      )}

      {status === 'on' && (
        <div className="camera-bottom">
          {activeSketch && (
            <>
              <div className="camera-filters">
                {SKETCH_FILTERS.map((f) => (
                  <button
                    key={f.v}
                    className={`camera-filters__opt${activeSketch.filter === f.v ? ' is-active' : ''}`}
                    onClick={() => setFilter(f.v)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="camera-opacity">
                <span>Эскиз</span>
                <input
                  type="range"
                  min={0.05}
                  max={0.9}
                  step={0.01}
                  value={refOpacity}
                  onChange={(e) => setRefOpacity(Number(e.target.value))}
                  aria-label="Прозрачность эскиза"
                />
              </div>
            </>
          )}
          {!recording && countdown === null && (
            <div className="camera-mode" role="tablist" aria-label="Режим съёмки">
              <button
                className={`camera-mode__opt${mode === 'photo' ? ' is-active' : ''}`}
                onClick={() => switchMode('photo')}
                role="tab"
                aria-selected={mode === 'photo'}
              >
                Фото
              </button>
              <button
                className={`camera-mode__opt${mode === 'video' ? ' is-active' : ''}`}
                onClick={() => switchMode('video')}
                role="tab"
                aria-selected={mode === 'video'}
              >
                Видео
              </button>
              {mode === 'video' && micOk === false && (
                <span className="camera-mode__mic">без звука 🎤✕</span>
              )}
            </div>
          )}
          <div className="camera-controls">
            {activeSketch ? (
              <button
                className="camera-btn"
                onClick={() => {
                  tapLight();
                  setActiveSketchId(null);
                }}
              >
                Убрать эскиз
              </button>
            ) : (
              <button
                className="camera-btn"
                onClick={() => {
                  tapLight();
                  setSketchSheet(true);
                }}
              >
                <IconImage size={17} />
                Эскиз
              </button>
            )}
            {mode === 'photo' ? (
              <button
                className="camera-shutter"
                onClick={() => void takePhoto()}
                disabled={capturing}
                aria-label="Сделать снимок"
              >
                <span className="camera-shutter__inner" />
              </button>
            ) : (
              <button
                className={`camera-shutter camera-shutter--video${recording ? ' is-recording' : ''}`}
                onClick={() => (recording ? stopRecording() : void beginRecording())}
                disabled={countdown !== null}
                aria-label={recording ? 'Остановить запись' : 'Начать запись'}
              >
                <span className="camera-shutter__inner" />
              </button>
            )}
            {mode === 'photo' ? (
              <button
                className="camera-btn"
                onClick={() => {
                  tapLight();
                  hdRef.current?.click();
                }}
                aria-label="HD-снимок нативной камерой"
              >
                HD
              </button>
            ) : (
              <span className="camera-btn-slot" aria-hidden="true" />
            )}
          </div>
        </div>
      )}

      {countdown !== null && <div className="camera-countdown">{countdown}</div>}

      {videoResult && (
        <div className="video-result">
          <video
            className="video-result__player"
            src={videoResult.url}
            controls
            playsInline
            preload="metadata"
          />
          <div className="video-result__panel">
            <p className="video-result__meta">
              {fmtSecs(videoResult.secs)} ·{' '}
              {videoResult.blob.size >= 1024 * 1024
                ? `${(videoResult.blob.size / 1024 / 1024).toFixed(1)} МБ`
                : `${Math.round(videoResult.blob.size / 1024)} КБ`}
              {micOk === false ? ' · без звука' : ''}
            </p>
            <button
              className="btn btn--primary btn--block"
              type="button"
              onClick={() => void saveVideo()}
            >
              Сохранить / отправить
            </button>
            <button className="camera-btn camera-btn--wide" type="button" onClick={closeVideo}>
              Записать ещё
            </button>
            <p className="video-result__hint">
              Видео сохраняется на телефон или уходит в чат через системное меню — в галерее
              приложения хранятся только фото.
            </p>
          </div>
        </div>
      )}

      <input ref={galleryRef} hidden type="file" accept="image/*" onChange={pickSketchFile} />
      <input
        ref={hdRef}
        hidden
        type="file"
        accept="image/*"
        capture={facing === 'user' ? 'user' : 'environment'}
        onChange={pickHd}
      />

      {sketchSheet && (
        <Sheet title="Эскизы" onClose={() => setSketchSheet(false)}>
          <div className="stack">
            {hydrated && sketches.length > 0 && (
              <div className="sketch-grid">
                {sketches.map((s) => (
                  <div key={s.id} className="sketch-cell">
                    <button
                      className={`sketch-cell__pick${s.id === activeSketchId ? ' is-active' : ''}`}
                      onClick={() => applySketch(s.id)}
                      aria-label="Выбрать эскиз"
                    >
                      <img
                        src={attachmentHref(s.photo)}
                        alt=""
                        style={{ filter: SKETCH_FILTER_CSS[s.filter] }}
                        loading="lazy"
                      />
                    </button>
                    <button
                      className="sketch-cell__del"
                      onClick={() => setPendingDelete(s.id)}
                      aria-label="Удалить эскиз"
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {sketches.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                Сохранённых эскизов пока нет. Добавьте референс-портрет из галереи — он
                останется здесь и будет доступен с любого устройства.
              </p>
            )}
            <button
              className="btn btn--primary btn--block"
              type="button"
              disabled={sketchBusy}
              onClick={() => {
                tapLight();
                galleryRef.current?.click();
              }}
            >
              {sketchBusy ? 'Загружаю…' : 'Добавить из галереи'}
            </button>
          </div>
        </Sheet>
      )}

      {pendingDelete && (
        <Sheet title="Удалить эскиз?" onClose={() => setPendingDelete(null)}>
          <div className="stack">
            <button
              className="btn btn--danger btn--block"
              onClick={() => deleteSketch(pendingDelete)}
            >
              Удалить
            </button>
            <button className="btn btn--ghost btn--block" onClick={() => setPendingDelete(null)}>
              Отмена
            </button>
          </div>
        </Sheet>
      )}

      {scriptsSheet && (
        <Sheet title="Тексты суфлёра" onClose={() => setScriptsSheet(false)}>
          <div className="stack">
            {scripts.length > 0 ? (
              <div className="script-list">
                {scripts.map((s) => (
                  <div
                    key={s.id}
                    className={`script-row${s.id === activeScript?.id ? ' is-active' : ''}`}
                  >
                    <button className="script-row__pick" onClick={() => chooseScript(s.id)}>
                      <span className="script-row__title">{s.title}</span>
                      <span className="script-row__preview">{s.text.slice(0, 60)}</span>
                    </button>
                    <button
                      className="script-row__act"
                      onClick={() => {
                        tapLight();
                        setEditingScript({ id: s.id, title: s.title, text: s.text });
                      }}
                      aria-label="Редактировать"
                    >
                      <IconPencil size={16} />
                    </button>
                    <button
                      className="script-row__act"
                      onClick={() => setPendingScriptDelete(s.id)}
                      aria-label="Удалить"
                    >
                      <IconTrash size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Текстов пока нет. Напишите речь для видео или подсказки для съёмки — они
                сохранятся и будут доступны с любого устройства.
              </p>
            )}
            <button
              className="btn btn--primary btn--block"
              type="button"
              onClick={() => {
                tapLight();
                setEditingScript({ title: '', text: '' });
              }}
            >
              Новый текст
            </button>
          </div>
        </Sheet>
      )}

      {editingScript && (
        <Sheet
          title={editingScript.id ? 'Редактировать текст' : 'Новый текст'}
          onClose={() => setEditingScript(null)}
        >
          <div className="stack">
            <input
              className="input"
              placeholder="Название (необязательно)"
              value={editingScript.title}
              onChange={(e) =>
                setEditingScript({ ...editingScript, title: e.target.value })
              }
            />
            <textarea
              ref={editorRef}
              className="input script-editor"
              placeholder="Текст, который будет прокручиваться в суфлёре…"
              rows={6}
              value={editingScript.text}
              onChange={(e) => {
                setEditingScript({ ...editingScript, text: e.target.value });
                growEditor();
              }}
            />
            {editorWords > 0 && (
              <p className="script-editor__meta">
                {editorWords} {pluralWords(editorWords)} · ≈ {fmtSecs(editorSecs)} чтения
              </p>
            )}
            <button
              className="btn btn--primary btn--block"
              type="button"
              disabled={!editingScript.text.trim()}
              onClick={saveScript}
            >
              Сохранить
            </button>
          </div>
        </Sheet>
      )}

      {pendingScriptDelete && (
        <ConfirmDialog
          title="Удалить текст?"
          message="Текст суфлёра будет удалён с сервера. Это действие необратимо."
          onClose={() => setPendingScriptDelete(null)}
          onConfirm={() => deleteScript(pendingScriptDelete)}
        />
      )}

      {flash && <div className="camera-flash" onAnimationEnd={() => setFlash(false)} />}
    </div>
  );
}
