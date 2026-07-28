/**
 * Focused-editable repair for the keyboard-wedge capture.
 *
 * Accumulation never suppresses, so a scan's characters type into whatever
 * editable holds focus; when the terminator confirms the code, the dispatcher
 * strips exactly those characters back out at the cursor. Writes go through
 * the element's native value setter and fire an `input` event, so
 * React-controlled inputs observe the change.
 */

function activeEditable(): HTMLInputElement | HTMLTextAreaElement | null {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement) {
    // Only text-like inputs receive typed characters.
    const textual = ['text', 'search', 'tel', 'url', 'email', 'password', 'number'];
    return textual.includes(el.type) ? el : null;
  }
  if (el instanceof HTMLTextAreaElement) return el;
  return null;
}

function writeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  caret: number,
): void {
  const proto = el instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  try { el.setSelectionRange(caret, caret); } catch { /* number inputs reject selection */ }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Remove `count` characters immediately before the cursor of the focused editable. */
export function removeFromActiveEditable(count: number): void {
  if (count <= 0) return;
  const el = activeEditable();
  if (!el) return;
  const caret = el.selectionStart ?? el.value.length;
  const start = Math.max(0, caret - count);
  writeValue(el, el.value.slice(0, start) + el.value.slice(caret), start);
}

