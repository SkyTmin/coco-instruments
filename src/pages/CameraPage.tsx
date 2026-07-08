import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconBack, IconImage, IconSwap } from '@/components/icons';
import { registerEscape } from '@/lib/escape-stack';
import { notifySuccess, notifyWarning, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';

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

// ---------------------------------------------------------------------------
// Камера: живой видоискатель + сетки + полупрозрачный эскиз-референс. Всё
// работает локально в WebView — поток и снимки никуда не отправляются.
// ---------------------------------------------------------------------------

type Facing = 'environment' | 'user';

// starting → on | denied (нет разрешения) | error (камера занята/не нашлась)
// | unsupported (нет getUserMedia — старый WebView или не-HTTPS).
type CamStatus = 'starting' | 'on' | 'denied' | 'error' | 'unsupported';

interface Shot {
  blob: Blob;
  url: string;
}

const shotName = () =>
  `coco-photo-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.jpg`;

export function CameraPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<CamStatus>('starting');
  const [facing, setFacing] = useState<Facing>('environment');
  const [canFlip, setCanFlip] = useState(true);
  const [gridMode, setGridMode] = useState<GridMode>('thirds');
  const [reference, setReference] = useState<string | null>(null);
  const [refOpacity, setRefOpacity] = useState(0.4);
  const [capturing, setCapturing] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [shotMsg, setShotMsg] = useState('');
  const galleryRef = useRef<HTMLInputElement>(null);
  const hdRef = useRef<HTMLInputElement>(null);

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

  // Освобождаем object URL эскиза и снимка при уходе со страницы.
  useEffect(
    () => () => {
      if (reference) URL.revokeObjectURL(reference);
    },
    [reference],
  );
  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url);
    },
    [shot],
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

  const pickReference = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    selectionChanged();
    setReference((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const clearReference = () => {
    tapLight();
    setReference((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
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
      setShotMsg('');
      setShot({ blob, url: URL.createObjectURL(blob) });
      notifySuccess();
    } catch {
      notifyWarning();
    } finally {
      setCapturing(false);
    }
  };

  // «HD-снимок»: file input с capture открывает НАТИВНУЮ камеру iOS — она
  // отдаёт фото в полном разрешении матрицы (~12 МП), недоступном через
  // getUserMedia. Компромисс: во время нативной съёмки сетки и эскиз не видны,
  // поэтому кадр сначала компонуют в нашем видоискателе.
  const pickHd = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setShotMsg('');
    setShot({ blob: file, url: URL.createObjectURL(file) });
    notifySuccess();
    // Нативная камера могла оборвать наш видеопоток — оживляем видоискатель.
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') void startStream(facing);
    else void videoRef.current?.play().catch(() => {});
  };

  const closeShot = () => {
    tapLight();
    setShot(null);
    setShotMsg('');
  };

  // Telegram BackButton/Esc сначала закрывают предпросмотр снимка.
  const shotOpen = !!shot;
  useEffect(() => {
    if (!shotOpen) return undefined;
    return registerEscape(() => {
      setShot(null);
      setShotMsg('');
    });
  }, [shotOpen]);

  const saveShot = async () => {
    if (!shot) return;
    tapLight();
    const file = new File([shot.blob], shotName(), { type: shot.blob.type || 'image/jpeg' });
    // В Telegram WebView обычный <a download> открывает JPEG как страницу —
    // надёжный путь наружу это системный share sheet: оттуда «Сохранить
    // изображение» в галерею или отправка файлом в любой чат Telegram.
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Coco Камера' });
        setShotMsg('Готово — фото ушло через системное меню.');
        return;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return; // меню закрыли
      }
    }
    const a = document.createElement('a');
    a.href = shot.url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setShotMsg('Файл со снимком сохранён.');
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
      {status === 'on' && reference && (
        <img className="camera-ref" src={reference} alt="" style={{ opacity: refOpacity }} />
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
            {canFlip ? (
              <button
                className="camera-btn camera-btn--icon"
                onClick={flipCamera}
                aria-label="Сменить камеру"
              >
                <IconSwap size={20} />
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
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
          {reference && (
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
          )}
          <div className="camera-controls">
            {reference ? (
              <button className="camera-btn" onClick={clearReference}>
                Убрать эскиз
              </button>
            ) : (
              <button
                className="camera-btn"
                onClick={() => {
                  tapLight();
                  galleryRef.current?.click();
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

      <input
        ref={galleryRef}
        hidden
        type="file"
        accept="image/*"
        onChange={pickReference}
      />
      <input
        ref={hdRef}
        hidden
        type="file"
        accept="image/*"
        capture={facing === 'user' ? 'user' : 'environment'}
        onChange={pickHd}
      />

      {shot && (
        <div className="camera-shot">
          <img className="camera-shot__img" src={shot.url} alt="Снимок" />
          <div className="camera-shot__panel">
            {shotMsg && <p className="camera-shot__msg">{shotMsg}</p>}
            <button className="btn btn--primary btn--block" type="button" onClick={() => void saveShot()}>
              Сохранить / отправить
            </button>
            <button className="camera-btn camera-btn--wide" type="button" onClick={closeShot}>
              Ещё снимок
            </button>
            <p className="camera-shot__hint">
              В системном меню можно сохранить фото в галерею или отправить его файлом в чат
              Telegram.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
