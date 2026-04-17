/**
 * NATS pub/sub integration tests.
 *
 * Requires a running NATS server on localhost:4222 with token auth.
 * Start with: nats-server -c nats.conf  (or docker compose up)
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { connect, StringCodec, type NatsConnection } from 'nats';

const NATS_URL = 'nats://localhost:4222';
const NATS_TOKEN = 'dev_api_secret';
const PREFIX = 'lt.events';
const sc = StringCodec();

let pub: NatsConnection;
let sub: NatsConnection;

/** Collect N messages from a subscription with a timeout. */
function collectMessages(
  conn: NatsConnection,
  subject: string,
  count: number,
  timeoutMs = 3000,
): Promise<Array<{ subject: string; event: any }>> {
  return new Promise((resolve, reject) => {
    const results: Array<{ subject: string; event: any }> = [];
    const subscription = conn.subscribe(subject);
    const timer = setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error(`Timeout: received ${results.length}/${count} messages on "${subject}"`));
    }, timeoutMs);

    (async () => {
      for await (const msg of subscription) {
        results.push({
          subject: msg.subject,
          event: JSON.parse(sc.decode(msg.data)),
        });
        if (results.length >= count) {
          subscription.unsubscribe();
          clearTimeout(timer);
          resolve(results);
          return;
        }
      }
      // subscription ended before count reached
      clearTimeout(timer);
      resolve(results);
    })();
  });
}

describe.skip('NATS pub/sub integration (requires NATS server)', () => {
  beforeAll(async () => {
    pub = await connect({ servers: NATS_URL, token: NATS_TOKEN });
    sub = await connect({ servers: NATS_URL, token: NATS_TOKEN });
    // small delay so subscriptions are fully registered before publishing
    await new Promise((r) => setTimeout(r, 50));
  });

  afterAll(async () => {
    await pub?.close();
    await sub?.close();
  });
  it('connects to NATS with token auth', () => {
    expect(pub).toBeDefined();
    expect(sub).toBeDefined();
  });

  it('receives a message on an exact subject', async () => {
    const collecting = collectMessages(sub, `${PREFIX}.task.completed`, 1);
    await new Promise((r) => setTimeout(r, 50));

    pub.publish(
      `${PREFIX}.task.completed`,
      sc.encode(JSON.stringify({
        type: 'task.completed',
        workflowId: 'wf-exact-1',
        timestamp: new Date().toISOString(),
      })),
    );
    await pub.flush();

    const msgs = await collecting;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].subject).toBe('lt.events.task.completed');
    expect(msgs[0].event.workflowId).toBe('wf-exact-1');
  });

  it('wildcard (>) receives events across all categories', async () => {
    const collecting = collectMessages(sub, `${PREFIX}.>`, 3);
    await new Promise((r) => setTimeout(r, 50));

    const types = ['task.created', 'workflow.started', 'escalation.created'];
    for (const type of types) {
      pub.publish(`${PREFIX}.${type}`, sc.encode(JSON.stringify({ type, workflowId: 'wf-wild' })));
    }
    await pub.flush();

    const msgs = await collecting;
    expect(msgs).toHaveLength(3);
    expect(msgs.map((m) => m.subject)).toEqual([
      'lt.events.task.created',
      'lt.events.workflow.started',
      'lt.events.escalation.created',
    ]);
  });

  it('category wildcard (task.>) only receives task events', async () => {
    const collecting = collectMessages(sub, `${PREFIX}.task.>`, 2);
    await new Promise((r) => setTimeout(r, 50));

    // Publish a mix — only the 2 task events should arrive
    pub.publish(`${PREFIX}.escalation.created`, sc.encode(JSON.stringify({ type: 'escalation.created' })));
    pub.publish(`${PREFIX}.task.started`, sc.encode(JSON.stringify({ type: 'task.started' })));
    pub.publish(`${PREFIX}.workflow.completed`, sc.encode(JSON.stringify({ type: 'workflow.completed' })));
    pub.publish(`${PREFIX}.task.completed`, sc.encode(JSON.stringify({ type: 'task.completed' })));
    await pub.flush();

    const msgs = await collecting;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].event.type).toBe('task.started');
    expect(msgs[1].event.type).toBe('task.completed');
  });

  it('application-level workflowId filtering works', async () => {
    const TARGET = 'wf-detail-page-xyz';
    const collecting = collectMessages(sub, `${PREFIX}.>`, 3);
    await new Promise((r) => setTimeout(r, 50));

    pub.publish(`${PREFIX}.task.started`, sc.encode(JSON.stringify({ type: 'task.started', workflowId: 'wf-other' })));
    pub.publish(`${PREFIX}.task.completed`, sc.encode(JSON.stringify({ type: 'task.completed', workflowId: TARGET })));
    pub.publish(`${PREFIX}.workflow.completed`, sc.encode(JSON.stringify({ type: 'workflow.completed', workflowId: TARGET })));
    await pub.flush();

    const msgs = await collecting;
    // Filter client-side, same as useWorkflowDetailEvents does
    const matched = msgs.filter((m) => m.event.workflowId === TARGET);
    expect(matched).toHaveLength(2);
    expect(matched.every((m) => m.event.workflowId === TARGET)).toBe(true);
  });

  it('mirrors what NatsEventAdapter.publish() does', async () => {
    const collecting = collectMessages(sub, `${PREFIX}.>`, 1);
    await new Promise((r) => setTimeout(r, 50));

    // Exactly how lib/events/nats.ts publishes:
    const event = {
      type: 'workflow.completed' as const,
      source: 'interceptor',
      workflowId: 'wf-adapter-test',
      workflowName: 'myWorkflow',
      taskQueue: 'long-tail',
      taskId: 'task-99',
      status: 'completed',
      timestamp: new Date().toISOString(),
    };
    const subject = `${PREFIX}.${event.type}`;
    pub.publish(subject, sc.encode(JSON.stringify(event)));
    await pub.flush();

    const msgs = await collecting;
    expect(msgs[0].subject).toBe('lt.events.workflow.completed');
    expect(msgs[0].event.workflowId).toBe('wf-adapter-test');
    expect(msgs[0].event.source).toBe('interceptor');
  });
});
