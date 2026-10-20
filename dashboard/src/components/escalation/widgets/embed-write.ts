import { createContext, useContext } from 'react';

/** Runs an embedded row action, or holds it until the page can run it (a badge at a shared station). */
export type EmbedWriteGuard = (verb: string, run: () => Promise<void>) => void;

const runNow: EmbedWriteGuard = (_verb, run) => { void run(); };

/**
 * The host page's gate for writes an embedded widget makes on other rows
 * (roster and list actions). Absent a provider, actions run directly.
 */
export const EmbedWriteContext = createContext<EmbedWriteGuard>(runNow);

export function useEmbedWrite(): EmbedWriteGuard {
  return useContext(EmbedWriteContext);
}
