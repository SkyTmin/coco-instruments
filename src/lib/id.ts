/**
 * Generate a unique-enough id for client-side records.
 * Matches the legacy timestamp-based scheme but adds a random suffix so that
 * several records created in the same millisecond don't collide.
 */
export function genId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
