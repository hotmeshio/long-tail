/**
 * Where a line keeps the machine addresses it learned, so a gateway that
 * takes the line over sends to the same machines. The memory book lasts as
 * long as the process; Long Tail keeps each binding on the station's bot
 * account (identities.ts).
 */

export interface AddressBook {
  /** Station → address, for every station bound so far. */
  load(): Promise<Map<string, string>>;
  bind(machineId: string, address: string): Promise<void>;
}

export class MemoryAddressBook implements AddressBook {
  private readonly bindings = new Map<string, string>();

  async load(): Promise<Map<string, string>> {
    return new Map(this.bindings);
  }

  async bind(machineId: string, address: string): Promise<void> {
    for (const [station, bound] of this.bindings) if (bound === address) this.bindings.delete(station);
    this.bindings.set(machineId, address);
  }
}
