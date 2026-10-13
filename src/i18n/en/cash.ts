import type { Translation } from '../types';
import type { cash as ru } from '../ru/cash';

export const cash: Translation<typeof ru> = {
  title: 'Cash desk',
  meta: 'coins are virtual',
  hint: "The machine's payout doesn't change: spins are still decided by a fair RNG, and you'll still lose sometimes. It's just a way to skip waiting for daily bonuses.",
  telegram: 'Link to Telegram',
  linkOk: 'up · {ms} ms',
  linkNo: 'DOWN',
  disk: 'Free disk space',
  mb: '{n} MB',
  last: 'Last backup',
  none: 'none yet',
  failed: 'Last run failed ({stage}): {error}',
  schedule:
    'Backups are made every night at 03:30 and arrive in the bot. To get one right now, send /backup.',
};
