/**
 * Layered Escape handling. Overlays (sheets, dialogs, lightboxes) register a
 * close handler on mount; pressing Esc closes the TOPMOST overlay first, and
 * only falls through to "navigate back" when nothing is open.
 */

type Handler = () => void;

const stack: Handler[] = [];

/** Register an overlay's close handler. Returns an unregister cleanup. */
export function registerEscape(handler: Handler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Close the topmost overlay. Returns true if something was closed. */
export function closeTopOverlay(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top();
  return true;
}
