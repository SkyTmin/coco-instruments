import type { Translation } from '../types';
import type { common as ru } from '../ru/common';

export const common: Translation<typeof ru> = {
  back: 'Atrás',
  close: 'Cerrar',
  cancel: 'Cancelar',
  ok: 'Listo',
  yes: 'Sí',
  no: 'No',
  on: 'Activado',
  off: 'Desactivado',
  auto: 'Auto',
  soon: 'Pronto',
  settings: 'Ajustes',
  loading: 'Cargando…',
  level: 'Nv. {n}',
  coins: { one: '{n} moneda', many: '{n} de monedas', other: '{n} monedas' },
};
