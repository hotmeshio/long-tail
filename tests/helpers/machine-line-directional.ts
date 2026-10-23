/**
 * A test codec shaped like a third-party machine protocol: a direction level
 * in every topic, machines addressed by UUID, receipts for each job and alarm
 * event, strict validation, and an optional dispatch on arrival. A relay
 * carries the mock line's own topics to and from that layout, so the mock
 * stands in for machines that speak it.
 */

import { randomUUID } from 'crypto';

import {
  CHANNEL, DISPATCH_ON, MESSAGE_KIND, buildEnvelope, genericCodec, machineTopic, topicOf, type DispatchOn, type LineCodec, type TopicScope,
} from '../../lib/machines/protocol';
import type { MemoryBroker } from '../../lib/machines/transport';
import { identOf, type LineDef } from '../../lib/machines/line';
import { ROOT } from './machine-line-fixtures';

export const WIRE_ROOT = 'plant/v1';
export const DIRECTION = { TO_HOST: 'to-host', TO_MACHINE: 'to-machine' } as const;

const DOWN_CHANNELS: string[] = [CHANNEL.CMD, 'receipt'];
const RECEIPTED: string[] = [MESSAGE_KIND.JOB, MESSAGE_KIND.ALARM];
/** A live delivery carries no retain flag, so the relay restores it, as a broker bridge does. */
const RETAINED_CHANNELS: string[] = [CHANNEL.PRESENCE, CHANNEL.SNAPSHOT, CHANNEL.ALARM];
const rootDepth = (root: string) => root.split('/').length;

/** The line with a UUID wire address on every machine. */
export function addressedLine(line: LineDef): LineDef {
  return { ...line, machines: line.machines.map((m) => ({ ...m, address: randomUUID() })) };
}

function directionOf(channel: string): string {
  return DOWN_CHANNELS.includes(channel) ? DIRECTION.TO_MACHINE : DIRECTION.TO_HOST;
}

/** `{root}/{site}/{line}/{direction}/{address}/{channel}` back to `{root}/{site}/{line}/{address}/{channel}`, or null. */
function withoutDirection(topic: string, root: string, direction: string): string | null {
  const levels = topic.split('/');
  const at = rootDepth(root) + 2;
  if (!topic.startsWith(`${root}/`) || levels[at] !== direction) return null;
  return [...levels.slice(0, at), ...levels.slice(at + 1)].join('/');
}

function withDirection(topic: string, root: string, direction: string): string {
  const levels = topic.split('/');
  const at = rootDepth(root) + 2;
  return [...levels.slice(0, at), direction, ...levels.slice(at)].join('/');
}

export function directionalCodec(line: LineDef, dispatchOn: DispatchOn = DISPATCH_ON.CREATED): LineCodec {
  const base = genericCodec({ root: WIRE_ROOT, line, dispatchOn });
  const codec: LineCodec = {
    ...base,
    strict: true,
    topicFor: (scope: TopicScope, channel: string) => {
      const level = (v?: string) => v ?? '+';
      return `${WIRE_ROOT}/${level(scope.siteId)}/${level(scope.lineId)}/${directionOf(channel.split('/')[0])}/${level(scope.address)}/${channel}`;
    },
    decode(topic, payload, retained) {
      const plain = withoutDirection(topic, WIRE_ROOT, DIRECTION.TO_HOST);
      if (!plain) return [];
      return base.decode(plain, payload, retained)
        .map((seen) => (seen.body && RECEIPTED.includes(seen.parsed!.kind) ? { ...seen, receiptId: seen.body.id } : seen));
    },
    encode: (ident, command) => base.encode(ident, command)
      .map((m) => ({ ...m, topic: withDirection(m.topic, WIRE_ROOT, DIRECTION.TO_MACHINE) })),
    receipt: (ident, ids) => [{
      topic: topicOf(codec, { siteId: ident.siteId, lineId: ident.lineId, address: ident.address ?? ident.machineId }, 'receipt'),
      payload: JSON.stringify({ ids }),
    }],
  };
  return codec;
}

/** Carries the mock line's topics (under ROOT) to the directional layout and its commands back. */
export function relayMockLine(broker: MemoryBroker, line: LineDef): void {
  const mockPrefix = `${ROOT}/${line.siteId}/${line.lineId}/`;
  broker.connect('relay');
  broker.subscribe('relay', `${mockPrefix}#`, (msg) => {
    const rest = msg.topic.slice(mockPrefix.length);
    const channel = rest.split('/').slice(1);
    if (channel.join('/') === CHANNEL.CMD) return;
    const wire = withDirection(`${WIRE_ROOT}/${line.siteId}/${line.lineId}/${rest}`, WIRE_ROOT, DIRECTION.TO_HOST);
    broker.publish(wire, msg.payload, RETAINED_CHANNELS.includes(channel[0]));
  });
  broker.subscribe('relay', `${WIRE_ROOT}/${line.siteId}/${line.lineId}/${DIRECTION.TO_MACHINE}/+/${CHANNEL.CMD}`, (msg) => {
    const plain = withoutDirection(msg.topic, WIRE_ROOT, DIRECTION.TO_MACHINE)!;
    broker.publish(`${ROOT}/${plain.slice(WIRE_ROOT.length + 1)}`, msg.payload);
  });
}

/** Every receipt the gateway sends, as `{ topic, ids }`. */
export function watchReceipts(broker: MemoryBroker, line: LineDef): { topic: string; ids: string[] }[] {
  const seen: { topic: string; ids: string[] }[] = [];
  broker.connect('receipts');
  broker.subscribe('receipts', `${WIRE_ROOT}/${line.siteId}/${line.lineId}/${DIRECTION.TO_MACHINE}/+/receipt`, (msg) => {
    seen.push({ topic: msg.topic, ids: JSON.parse(msg.payload).ids });
  });
  return seen;
}

/** A message as a machine sends it on the directional layout; `again` sends the same message once more. */
export function sendAsMachine(broker: MemoryBroker, line: LineDef, machineId: string, channel: string, body: Record<string, any>): { id: string; again(): void } {
  const ident = identOf(line, machineId);
  const env = buildEnvelope(ident, body);
  const topic = withDirection(machineTopic(WIRE_ROOT, ident, channel), WIRE_ROOT, DIRECTION.TO_HOST);
  const send = () => broker.publish(topic, JSON.stringify(env));
  send();
  return { id: env.id, again: send };
}
