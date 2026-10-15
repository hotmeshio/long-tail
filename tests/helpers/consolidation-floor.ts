import { randomUUID } from 'crypto';

import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { migrate } from '../../lib/db/migrate';
import { getPool } from '../../lib/db';
import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { resolveEscalation } from '../../api/escalations/resolve';
import { accumulateItem } from '../../api/escalations/accumulate';
import { seedConsolidationRoles } from '../../examples/seed-consolidation';
import {
  CONSOLIDATION_ROLES,
  consolidationBin,
  consolidationOrder,
} from '../../examples/workflows/consolidation';
import type { LTEscalationRecord } from '../../types';

const { Connection, Client, Worker } = Durable;

/**
 * A consolidation floor on real workers: bins per destination, orders that
 * walk the stations, and the moves a floor makes (finish a station, place an
 * order in a bin). Each floor uses its own destinations, so floors in the
 * same database never see each other's rows.
 */
export class ConsolidationFloor {
  readonly run = randomUUID().slice(0, 8);
  operatorId = '';
  private client!: InstanceType<typeof Client>;
  private readonly started: { workflowName: string; workflowId: string }[] = [];
  private readonly users: string[] = [];

  constructor(private readonly taskQueue: string) {}

  dest(name: string): string {
    return `${name}-${this.run}`;
  }

  async open(): Promise<void> {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await seedConsolidationRoles();
    this.operatorId = await this.user([{ role: 'superadmin', type: 'superadmin' }]);
    const connection = { class: Postgres, options: postgres_options };
    for (const workflow of [consolidationBin, consolidationOrder]) {
      const worker = await Worker.create({ connection, taskQueue: this.taskQueue, workflow });
      await worker.run();
    }
    this.client = new Client({ connection });
  }

  async close(): Promise<void> {
    for (const { workflowName, workflowId } of this.started) {
      await this.client.workflow.getHandle(this.taskQueue, workflowName, workflowId).then((h) => h.terminate()).catch(() => undefined);
    }
    await getPool().query(
      `DELETE FROM public.hmsh_escalations WHERE role = ANY($1) AND metadata->>'destination' LIKE $2`,
      [Object.values(CONSOLIDATION_ROLES), `%-${this.run}`],
    );
    for (const id of this.users) await userService.deleteUser(id);
    await sleepFor(500);
    await Durable.shutdown();
  }

  /** A user with the given grants; returns the auth context id. */
  async user(roles: Array<{ role: string; type: string; read_scope?: string; write_scope?: string }>): Promise<string> {
    const id = (await userService.createUser({ external_id: `floor-${this.run}-${this.users.length}`, roles: roles as any })).id;
    this.users.push(id);
    return id;
  }

  get auth() {
    return { userId: this.operatorId };
  }

  async waitFor(signalKey: string, status = 'pending'): Promise<LTEscalationRecord> {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const row = await escalationService.getEscalationBySignalKey(signalKey);
      if (row && row.status === status) return row;
      if (Date.now() > deadline) throw new Error(`no ${status} escalation for ${signalKey}`);
      await sleepFor(200);
    }
  }

  private async start(workflowName: string, data: Record<string, unknown>): Promise<void> {
    const workflowId = `${workflowName}-${Durable.guid()}`;
    this.started.push({ workflowName, workflowId });
    await this.client.workflow.start({ args: [{ data }], taskQueue: this.taskQueue, workflowName, workflowId, expire: 300 });
  }

  async bin(binKey: string, destination: string, lane?: string): Promise<LTEscalationRecord> {
    const key = `${binKey}-${this.run}`;
    await this.start('consolidationBin', { binKey: key, destination, lane, max: 10 });
    return this.waitFor(lane ? `consolidate-${key}-${lane}` : `consolidate-${key}`);
  }

  async order(orderId: string, destination: string, serviceLevel: string): Promise<string> {
    const id = `${orderId}-${this.run}`;
    await this.start('consolidationOrder', { orderId: id, destination, serviceLevel });
    await this.waitFor(`${CONSOLIDATION_ROLES.PREP}-${id}`);
    return id;
  }

  /** Finish the order's current station; it moves to the next one. */
  async advance(orderId: string, from: string, to: string): Promise<void> {
    const row = await this.waitFor(`${from}-${orderId}`);
    const result = await resolveEscalation({ id: row.id, resolverPayload: { ok: true } }, this.auth);
    if (result.status !== 200) throw new Error(`resolve ${from} for ${orderId}: ${result.status} ${result.error}`);
    await this.waitFor(to === CONSOLIDATION_ROLES.STAGE ? `stage-${orderId}` : `${to}-${orderId}`);
  }

  async walk(orderId: string): Promise<void> {
    await this.advance(orderId, CONSOLIDATION_ROLES.PREP, CONSOLIDATION_ROLES.CHECK);
    await this.advance(orderId, CONSOLIDATION_ROLES.CHECK, CONSOLIDATION_ROLES.STAGE);
  }

  /** Place a staged order in a bin: one reciprocal add writes both rows. */
  async place(orderId: string, bin: LTEscalationRecord): Promise<void> {
    const member = await this.waitFor(`stage-${orderId}`);
    const result = await accumulateItem({ id: bin.id, itemKey: orderId, payload: { weight: 1 }, reciprocal: { id: member.id } } as any, this.auth);
    if (result.status !== 200) throw new Error(`place ${orderId}: ${result.status} ${result.error}`);
  }
}
