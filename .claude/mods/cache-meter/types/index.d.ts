/** Счёт кеша за сессию: последний запрос главного диалога и итоги. */
export type CacheMeterStats = {
  /** Последний запрос главного диалога. */
  last: { read: number; write: number; input: number; at: number } | null;
  /** Главный диалог за сессию: прочитано и записано в кеш. */
  read: number;
  write: number;
  /** Подагенты за сессию. */
  agentRead: number;
  agentWrite: number;
};
declare module "claude-code" {
  interface PluginState {
    "cache-meter": { stats: CacheMeterStats };
  }
}
