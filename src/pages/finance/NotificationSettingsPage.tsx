import { useState } from 'react';
import { useRawInitData } from '@tma.js/sdk-react';
import { LeadPicker, Screen } from '@/components/ui';
import { useFinanceStore } from '@/store';
import { testReminder } from '@/lib/reminders';
import { tapLight } from '@/lib/haptics';

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
        ? r.queued
          ? '✅ В очереди — придёт в течение ~10 мин (или запустите «Send reminders» в Actions сейчас)'
          : '✅ Отправили — проверьте чат с ботом'
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
            <label className="field__label">Когда напоминать (по умолчанию)</label>
            <LeadPicker value={prefs.leads} onChange={(leads) => setPrefs({ leads })} />
          </div>

          <div className="field">
            <label className="field__label">Во сколько (МСК)</label>
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
          Уведомления приходят сообщением от <b>@coco_instruments_bot</b> в выбранное время (МСК).
          Можно выбрать несколько вариантов — например, «за день» и «в день» сразу. Для отдельного
          платежа дни и время настраиваются прямо в его форме. <b>Важно:</b> чтобы бот мог писать,
          откройте @coco_instruments_bot и нажмите «Запустить».
        </p>
      </div>
    </Screen>
  );
}
