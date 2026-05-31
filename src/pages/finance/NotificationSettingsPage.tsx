import { useState } from 'react';
import { useRawInitData } from '@tma.js/sdk-react';
import { Screen } from '@/components/ui';
import { useFinanceStore } from '@/store';
import { testReminder } from '@/lib/reminders';
import { selectionChanged, tapLight } from '@/lib/haptics';

const LEADS = [
  { value: 0, label: 'В день' },
  { value: 1, label: 'За 1 день' },
  { value: 2, label: 'За 2 дня' },
  { value: 3, label: 'За 3 дня' },
];

export function NotificationSettingsPage() {
  const prefs = useFinanceStore((s) => s.reminderPrefs);
  const setPrefs = useFinanceStore((s) => s.setReminderPrefs);
  const rawInitData = useRawInitData();
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const time = `${String(prefs.hour).padStart(2, '0')}:${String(prefs.minute).padStart(2, '0')}`;

  const runTest = async () => {
    setTesting(true);
    setTestMsg(null);
    const r = await testReminder(rawInitData);
    setTesting(false);
    setTestMsg(
      r.ok
        ? '✅ Отправили тестовое сообщение в чат с ботом'
        : `Не удалось — ${r.error || 'проверьте внутри Telegram'}`,
    );
  };

  return (
    <Screen title="Напоминания" subtitle="Уведомления о платежах">
      <label className="toggle-row">
        <span>Напоминать о платежах</span>
        <input
          type="checkbox"
          checked={prefs.enabled}
          onChange={(e) => setPrefs({ enabled: e.target.checked })}
        />
      </label>

      {prefs.enabled && (
        <>
          <div className="field">
            <label className="field__label">Когда</label>
            <div className="segmented">
              {LEADS.map((l) => (
                <button
                  key={l.value}
                  className={`segmented__opt${prefs.leadDays === l.value ? ' is-active' : ''}`}
                  onClick={() => {
                    selectionChanged();
                    setPrefs({ leadDays: l.value });
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field__label">Во сколько</label>
            <input
              className="input"
              type="time"
              value={time}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number);
                setPrefs({ hour: h || 0, minute: m || 0 });
              }}
            />
          </div>

          <button
            className="btn btn--block"
            disabled={testing}
            onClick={() => {
              tapLight();
              void runTest();
            }}
          >
            {testing ? 'Отправляем…' : 'Прислать тестовое уведомление'}
          </button>
          {testMsg && (
            <p className="muted" style={{ marginTop: 10, fontSize: 14 }}>
              {testMsg}
            </p>
          )}
        </>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
          Уведомления приходят сообщением от <b>@coco_instruments_bot</b> в выбранное время
          (московское, берётся с вашего устройства). <b>Важно:</b> чтобы бот мог вам писать, откройте
          @coco_instruments_bot и нажмите «Запустить» (или отправьте любое сообщение). Для конкретного
          платежа можно задать своё точное время прямо в его форме.
        </p>
      </div>
    </Screen>
  );
}
