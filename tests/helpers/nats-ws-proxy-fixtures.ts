/**
 * Stand-ins for the proxy's two lookups: the spent-ticket table and the
 * holder's account. Used from vi.mock factories in the proxy tests.
 */

const spentTickets = new Set<string>();

/** A pool whose only query is the ticket spend: true once per ticket id. */
export const ticketPool = {
  query: async (_sql: string, [jti]: [string]) => {
    if (spentTickets.has(jti)) return { rowCount: 0, rows: [] };
    spentTickets.add(jti);
    return { rowCount: 1, rows: [{ jti }] };
  },
};

/** Accounts the holder lookup answers for; any other id is an active member. */
export const holders = new Map<string, { builder: boolean } | null>();

export async function holderViewFixture(userId: string): Promise<{ builder: boolean } | null> {
  return holders.has(userId) ? holders.get(userId)! : { builder: false };
}
