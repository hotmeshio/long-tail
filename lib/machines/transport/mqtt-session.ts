/**
 * One MQTT client with a persistent session (clean start off), shared by the
 * machine link and the controller buses. A session resumed after a restart
 * delivers queued QoS 1 messages right after the connect acknowledgement,
 * before anyone has subscribed again; those are held in the process until a
 * handler for their topic registers, so a queued command is not dropped.
 */

import { readFileSync } from 'fs';
import type { IClientOptions, MqttClient } from 'mqtt';

import type { MqttEndpoint } from '../../../services/machines/config';
import { topicMatches, type InboundMessage, type LinkWill } from './delivery';

const HELD_LIMIT = 1_000;
const MQTT_MISSING = 'the MQTT transport needs the "mqtt" package (npm install mqtt)';

/** mqtt is an optional peer dependency, loaded only when an MQTT transport is used. */
function loadMqtt(): typeof import('mqtt') {
  try {
    return require('mqtt');
  } catch (err) {
    const error = new Error(MQTT_MISSING);
    (error as Error & { cause?: unknown }).cause = err;
    throw error;
  }
}
const SESSION_EXPIRY_SEC = 86_400;
const RECONNECT_MS = 1_000;
const CONNECT_TIMEOUT_MS = 10_000;

type Handler = (msg: InboundMessage) => void;

export interface SessionOptions {
  will?: LinkWill;
  onRestored?: () => void;
}

/** Client options for one identity; `{clientId}` in a path or username picks that identity's credentials. */
export function mqttOptions(endpoint: MqttEndpoint, clientId: string, will?: LinkWill): IClientOptions {
  const fill = (value?: string) => value?.split('{clientId}').join(clientId);
  const file = (path?: string) => (path ? readFileSync(fill(path)!) : undefined);
  return {
    clientId,
    protocolVersion: endpoint.protocolVersion,
    clean: false,
    ...(endpoint.protocolVersion === 5 ? { properties: { sessionExpiryInterval: SESSION_EXPIRY_SEC } } : {}),
    ca: file(endpoint.caFile),
    cert: file(endpoint.certFile),
    key: file(endpoint.keyFile),
    username: fill(endpoint.username),
    password: endpoint.password,
    reconnectPeriod: RECONNECT_MS,
    connectTimeout: CONNECT_TIMEOUT_MS,
    will: will ? { topic: will.topic, payload: Buffer.from(will.payload), qos: 1, retain: will.retain } : undefined,
  };
}

export class MqttSession {
  private handlers: { filter: string; handler: Handler }[] = [];
  private held: InboundMessage[] = [];

  private constructor(readonly client: MqttClient) {
    client.on('message', (topic, payload, packet) => {
      this.route({ topic, payload: payload.toString(), retained: packet.retain, deliveries: packet.dup ? 2 : 1 });
    });
  }

  /** Connect and wait for the broker's acknowledgement; a refusal rejects. */
  static open(endpoint: MqttEndpoint, clientId: string, opts: SessionOptions = {}): Promise<MqttSession> {
    const client = loadMqtt().connect(endpoint.url, mqttOptions(endpoint, clientId, opts.will));
    const session = new MqttSession(client);
    return new Promise((resolve, reject) => {
      const fail = (err: Error) => {
        client.end(true);
        reject(new Error(`MQTT ${clientId} could not connect to ${endpoint.url}: ${err.message}`));
      };
      client.once('error', fail);
      client.once('connect', () => {
        client.off('error', fail);
        client.on('error', () => undefined);
        client.on('connect', () => opts.onRestored?.());
        resolve(session);
      });
    });
  }

  get connected(): boolean {
    return this.client.connected;
  }

  async subscribe(filter: string, handler: Handler): Promise<void> {
    this.handlers.push({ filter, handler });
    const ready = this.held.filter((m) => topicMatches(filter, m.topic));
    this.held = this.held.filter((m) => !topicMatches(filter, m.topic));
    await this.client.subscribeAsync(filter, { qos: 1 });
    for (const m of ready) handler(m);
  }

  async publish(topic: string, payload: string, qos: 0 | 1, retain = false): Promise<void> {
    await this.client.publishAsync(topic, payload, { qos, retain });
  }

  /** Retained messages under `filter`, as the broker sends them on subscribe. */
  async retained(filter: string, settleMs = 250): Promise<InboundMessage[]> {
    const seen: InboundMessage[] = [];
    const collect = (topic: string, payload: Buffer, packet: { retain: boolean }) => {
      if (packet.retain && topicMatches(filter, topic)) seen.push({ topic, payload: payload.toString(), retained: true, deliveries: 1 });
    };
    this.client.on('message', collect);
    try {
      await this.client.subscribeAsync(filter, { qos: 1 });
      await new Promise((r) => setTimeout(r, settleMs));
      await this.client.unsubscribeAsync(filter);
    } finally {
      this.client.off('message', collect);
    }
    return seen;
  }

  /** Graceful sends DISCONNECT, so the broker drops the will; otherwise the socket just closes. */
  async close(graceful: boolean): Promise<void> {
    if (graceful) await this.client.endAsync(false);
    else this.client.end(true);
  }

  private route(msg: InboundMessage): void {
    const matching = this.handlers.filter((h) => topicMatches(h.filter, msg.topic));
    if (matching.length) {
      for (const h of matching) h.handler(msg);
      return;
    }
    this.held.push(msg);
    if (this.held.length > HELD_LIMIT) this.held.shift();
  }
}
