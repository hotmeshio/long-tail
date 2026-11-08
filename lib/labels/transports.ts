/**
 * The label transport registry: named routes from issued labels to printers,
 * registered at startup. Sending is a capability, not a side effect, so a
 * name with no transport fails loudly instead of printing nothing.
 */

import type { LTLabelTransport } from '../../types/labels';

export const LABEL_TRANSPORT_NOT_CONFIGURED = 'No label transport is registered under that name; pass start({ labels: { transports } })';

class LTLabelTransportRegistry {
  private transports = new Map<string, LTLabelTransport>();

  /** Register a transport by name; replaces one registered before under the same name. */
  register(name: string, transport: LTLabelTransport): void {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) {
      throw new Error(`label transport name "${name}" must be lowercase letters, digits and dashes`);
    }
    this.transports.set(name, transport);
  }

  has(name: string): boolean {
    return this.transports.has(name);
  }

  /** The registered transports, by name, with the formats each accepts. */
  list(): Array<{ name: string; formats: LTLabelTransport['formats'] }> {
    return [...this.transports].map(([name, t]) => ({ name, formats: [...t.formats] }));
  }

  get(name: string): LTLabelTransport {
    const transport = this.transports.get(name);
    if (!transport) throw new Error(`${LABEL_TRANSPORT_NOT_CONFIGURED} (asked for "${name}")`);
    return transport;
  }

  /** Forget every transport (tests). */
  clear(): void {
    this.transports.clear();
  }
}

export const labelTransportRegistry = new LTLabelTransportRegistry();
