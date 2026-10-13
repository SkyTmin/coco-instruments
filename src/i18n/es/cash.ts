import type { Translation } from '../types';
import type { cash as ru } from '../ru/cash';

export const cash: Translation<typeof ru> = {
  title: 'Caja',
  meta: 'monedas virtuales',
  hint: 'El pago de la máquina no cambia: los giros los sigue decidiendo un generador aleatorio honesto, y también se pierde. Es solo una forma de no esperar los bonus diarios.',
  telegram: 'Conexión con Telegram',
  linkOk: 'sí · {ms} ms',
  linkNo: 'NO',
  disk: 'Espacio libre en disco',
  mb: '{n} MB',
  last: 'Última copia',
  none: 'ninguna',
  failed: 'La última ejecución falló ({stage}): {error}',
  schedule:
    'Las copias se hacen cada noche a las 03:30 y llegan al bot. Para tener una ya: comando /backup.',
};
