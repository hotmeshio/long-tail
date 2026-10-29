/**
 * A line's edge account on Long Tail's NATS: the machine broker's bridge logs
 * in by client certificate (the CN is its user), over MQTT only, and may
 * publish under the line's topics and subscribe to nothing. Long Tail imports
 * exactly those subjects.
 */

import type { EdgeAccount } from '../../messaging/nats/render-conf';
import type { LineDef } from '../line';
import { toSubject } from '../protocol';
import { bridgeId } from './site-conf';

/** An account name for a line: letters, digits, `-` and `_`. */
export function edgeAccountName(line: LineDef): string {
  return `EDGE_${line.siteId}_${line.lineId}`.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function edgeAccountFor(line: LineDef, root: string, bridgeUser = `CN=${bridgeId(line)}`): EdgeAccount {
  const subjects = `${toSubject(`${root}/${line.siteId}/${line.lineId}`)}.>`;
  return {
    name: edgeAccountName(line),
    subjects,
    users: [{ user: bridgeUser, allowed_connection_types: ['MQTT'], permissions: { publish: [subjects], subscribe: { deny: ['>'] } } }],
  };
}
