import { createContext, useContext } from 'react';

export interface EmbedWriteOptions {
  /**
   * The action needs a badge (a role the person acting lacks): hold it for
   * the next badge, saying this. A page that takes no badges drops it.
   */
  badge?: string;
}

/** Runs an embedded row action, or holds it until the page can run it (a badge at a shared station). */
export type EmbedWriteGuard = (verb: string, run: () => Promise<void>, options?: EmbedWriteOptions) => void;

const runNow: EmbedWriteGuard = (_verb, run, options) => {
  if (!options?.badge) void run();
};

/**
 * The host page's gate for writes an embedded widget makes on other rows
 * (roster and list actions). Absent a provider, actions run directly.
 */
export const EmbedWriteContext = createContext<EmbedWriteGuard>(runNow);

export function useEmbedWrite(): EmbedWriteGuard {
  return useContext(EmbedWriteContext);
}
