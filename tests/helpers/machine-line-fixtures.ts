/**
 * Shared fixtures for the machine line example: a fast mock line on the
 * memory broker, a recorder that contract-checks every message the line
 * publishes, and a tiny controller that sends commands and waits for replies.
 */

import { sleep, until } from '../../services/machines/testing/wait';
import { randomUUID } from 'crypto';

import { identOf, machineById, type LineDef } from '../../lib/machines/line';
import { DEFAULT_LINE } from '../../examples/workflows/machine-line/line';
import { DEFAULT_MOCK_SETTINGS, MockLine, type MockSettings } from '../../services/machines/testing/mock';
import {
  CHANNEL, buildEnvelope, inspectMessage, lineFilter, machineTopic, type Envelope, type Inspection,
} from '../../lib/machines/protocol';
import { MemoryBroker, MemoryMachineLink, type MemoryBrokerOptions } from '../../lib/machines/transport';

export const ROOT = 'line/v1';

export const FAST: MockSettings = {
  ...DEFAULT_MOCK_SETTINGS,
  topicRoot: ROOT,
  msPerSec: 1,
  startEnabled: true,
  heartbeats: false,
  telemetrySec: 0,
  arrivalDelaySec: 1,
  transferSec: 2,
  handshakeTimeoutSec: 20,
};


export interface Seen extends Inspection {
  topic: string;
}

export class Recorder {
  readonly seen: Seen[] = [];

  constructor(readonly broker: MemoryBroker, readonly line: LineDef = DEFAULT_LINE) {}

  async start(): Promise<void> {
    this.broker.connect('recorder');
    this.broker.subscribe('recorder', lineFilter(ROOT, this.line.siteId, this.line.lineId), (msg) => {
      this.seen.push({ topic: msg.topic, ...inspectMessage(ROOT, msg.topic, msg.payload) });
    });
  }

  of(machineId: string, kind: string): Envelope[] {
    return this.seen
      .filter((s) => s.parsed?.ident.machineId === machineId && s.parsed.kind === kind && s.body)
      .map((s) => s.body!);
  }

  jobs(machineId: string, event?: string): Record<string, any>[] {
    return this.of(machineId, 'job').map((e) => e.body).filter((b) => !event || b.event === event);
  }

  commands(machineId: string, op?: string): Record<string, any>[] {
    return this.of(machineId, 'cmd').map((e) => e.body).filter((b) => !op || b.op === op);
  }

  replies(machineId: string): Record<string, any>[] {
    return this.of(machineId, 'reply').map((e) => e.body);
  }

  violations(): string[] {
    return this.seen.flatMap((s) => s.violations.map((v) => `${s.topic}: ${v}`));
  }
}

export interface Harness {
  broker: MemoryBroker;
  line: MockLine;
  recorder: Recorder;
  command(machineId: string, op: string, args?: Record<string, any>, cmdId?: string): Promise<Record<string, any> | null>;
  stop(): Promise<void>;
}

/** Redelivery for tests on the real orchestrator: a message racing its row is offered for several seconds, as JetStream would. */
export const REAL_ORCHESTRATOR_BROKER: MemoryBrokerOptions = { redeliverMs: 200 };

/** A line on the memory broker. A redelivery of 5ms suits a fake Long Tail; the real orchestrator needs a longer one. */
export async function startHarness(settings: Partial<MockSettings> = {}, lineDef: LineDef = DEFAULT_LINE, brokerOpts: MemoryBrokerOptions = { redeliverMs: 5 }): Promise<Harness> {
  const broker = new MemoryBroker(brokerOpts);
  const recorder = new Recorder(broker, lineDef);
  await recorder.start();
  const line = new MockLine(lineDef, { ...FAST, ...settings }, () => new MemoryMachineLink(broker));
  await line.start();
  await sleep(1);

  async function command(machineId: string, op: string, args: Record<string, any> = {}, cmdId = `cmd-${randomUUID()}`) {
    const ident = identOf(lineDef, machineId);
    const before = recorder.seen.length;
    broker.publish(machineTopic(ROOT, ident, CHANNEL.CMD), JSON.stringify(buildEnvelope(ident, { cmdId, op, args })));
    for (let i = 0; i < 50; i++) {
      await sleep(2);
      const reply = recorder.seen.slice(before).find((s) => s.parsed?.kind === 'reply' && s.body?.body.cmdId === cmdId);
      if (reply) return reply.body!.body;
    }
    return null;
  }

  return { broker, line, recorder, command, stop: async () => { await line.stop(); broker.shutdown(); } };
}

/** Dispatch arguments for one or more units at `machineId` on the default line; the job is named after the first. */
export function dispatchArgs(machineId: string, units: string | string[], extra: Record<string, any> = {}): Record<string, any> {
  const ids = Array.isArray(units) ? units : [units];
  const def = machineById(DEFAULT_LINE, machineId);
  const [id, versions] = Object.entries(def.recipes)[0];
  return {
    jobId: `${ids[0]}-${machineId}`, orderRef: 'ORD-1', recipe: { id, version: versions[versions.length - 1] },
    units: ids.map((unitId) => ({ unitId, carrierId: `CR-${unitId}` })), from: null, ...extra,
  };
}

/** Wait until `check` returns truthy or the budget runs out. */

export { sleep, until };
