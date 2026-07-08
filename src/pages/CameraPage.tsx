import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet } from '@/components/ui';
import { IconBack, IconImage, IconSwap, IconTrash } from '@/components/icons';
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

export function CameraPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const sketches = useFinanceStore((s) => s.cameraSketches);
  const addSketch = useFinanceStore((s) => s.addCameraSketch);
  const updateSketch = useFinanceStore((s) => s.updateCameraSketch);
  const removeSketch = useFinanceStore((s) => s.removeCameraSketch);
  const addShot = useFinanceStore((s) => s.addCameraShot);
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
    if (status !== 'on' || sketchSheet || pendingDelete) return;
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
        <button className="camera-btn camera-btn--icon" onClick={goBack} aria-label="Назад">
          <IconBack size={20} />
        </button>
        {status === 'on' && (
          <>
            <button className="camera-btn" onClick={cycleGrid}>
              {GRID_LABELS[gridMode]}
            </button>
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
                  aria-label="Сменить камеру"
                >
                  <IconSwap size={20} />
                </button>
              )}
            </span>
          </>
        )}
      </div>

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
            <button
              className="camera-shutter"
              onClick={() => void takePhoto()}
              disabled={capturing}
              aria-label="Сделать снимок"
            >
              <span className="camera-shutter__inner" />
            </button>
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

      {flash && <div className="camera-flash" onAnimationEnd={() => setFlash(false)} />}
    </div>
  );
}
