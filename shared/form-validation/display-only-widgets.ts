/**
 * Widgets that render from the escalation context and produce no answer of
 * their own: navigation links, embedded records and lists, and invoke
 * controls. Their form slot exists only to place them in the layout, so
 * the payload mapper drops them and the server never sees a value.
 */
export const DISPLAY_ONLY_WIDGET_NAMES = {
  LINK: 'link',
  ESCALATION: 'escalation',
  ESCALATION_LIST: 'escalation-list',
  INVOKE: 'invoke',
} as const;

export const DISPLAY_ONLY_WIDGETS: ReadonlySet<string> = new Set(Object.values(DISPLAY_ONLY_WIDGET_NAMES));

export function isDisplayOnlyWidget(name: unknown): boolean {
  return typeof name === 'string' && DISPLAY_ONLY_WIDGETS.has(name);
}

/** Whether a property definition renders a display-only widget. */
export function isDisplayOnlyField(def: Record<string, unknown> | null | undefined): boolean {
  return isDisplayOnlyWidget(def?.['x-lt-widget']);
}
