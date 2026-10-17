/**
 * Environment for the machine line example. Every backend is chosen here and
 * an unknown or incomplete selection throws; nothing falls back silently.
 */

import type { MqttEndpoint } from '../../types/machines';

export type { MqttEndpoint };
import { REPLY_DEADLINE_MS } from '../../lib/machines/protocol';

export const MACHINE_TRANSPORT = { MEMORY: 'memory', NATS: 'nats', MQTT: 'mqtt' } as const;
export type MachineTransportMode = typeof MACHINE_TRANSPORT[keyof typeof MACHINE_TRANSPORT];

export const ESCALATION_FEED = { MEMORY: 'memory', CORE: 'core', IN_PROCESS: 'in-process' } as const;
export type EscalationFeedMode = typeof ESCALATION_FEED[keyof typeof ESCALATION_FEED];

export interface MachineLineConfig {
  transport: MachineTransportMode;
  feed: EscalationFeedMode;
  topicRoot: string;
  lineConfigPath?: string;
  siteNatsUrl?: string;
  siteNatsUser?: string;
  siteNatsPassword?: string;
  ltNatsUrl?: string;
  ltNatsToken?: string;
  mqtt?: MqttEndpoint;
  replyTimeoutMs: number;
  dispatchAttempts: number;
  handoffTimeout: string;
  offlineDebounceMs: number;
  /** A connected machine silent this long gets a quiet row; 0 turns the check off. */
  quietMs: number;
  /** How long a dispatch stays valid at the machine. */
  dispatchTtlMs: number;
  ltBaseUrl: string;
}

type Env = Record<string, string | undefined>;

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${name}="${value}" is not one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function int(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name}="${raw}" must be a non-negative integer`);
  return n;
}

function required(env: Env, name: string, mode: string): string {
  const value = env[name];
  if (!value) throw new Error(`MACHINE_TRANSPORT=${mode} needs ${name}`);
  return value;
}

function mqttEndpoint(env: Env, mode: string, defaultVersion: 4 | 5): MqttEndpoint {
  const version = int(env, 'MACHINE_MQTT_PROTOCOL', defaultVersion);
  if (version !== 4 && version !== 5) throw new Error('MACHINE_MQTT_PROTOCOL must be 4 or 5');
  return {
    url: required(env, 'MACHINE_MQTT_URL', mode),
    protocolVersion: version,
    caFile: env.MACHINE_MQTT_CA,
    certFile: env.MACHINE_MQTT_CERT,
    keyFile: env.MACHINE_MQTT_KEY,
    username: env.MACHINE_MQTT_USERNAME,
    password: env.MACHINE_MQTT_PASSWORD,
  };
}

const DEFAULT_FEED: Record<MachineTransportMode, EscalationFeedMode> = {
  memory: ESCALATION_FEED.MEMORY,
  nats: ESCALATION_FEED.CORE,
  mqtt: ESCALATION_FEED.CORE,
};

export function loadMachineLineConfig(env: Env = process.env): MachineLineConfig {
  const transport = oneOf('MACHINE_TRANSPORT', env.MACHINE_TRANSPORT ?? MACHINE_TRANSPORT.MEMORY, Object.values(MACHINE_TRANSPORT));
  const feed = oneOf('MACHINE_ESCALATION_FEED', env.MACHINE_ESCALATION_FEED ?? DEFAULT_FEED[transport], Object.values(ESCALATION_FEED));
  const config: MachineLineConfig = {
    transport,
    feed,
    topicRoot: env.MACHINE_TOPIC_ROOT ?? 'line/v1',
    lineConfigPath: env.MACHINE_LINE_CONFIG || undefined,
    replyTimeoutMs: int(env, 'MACHINE_REPLY_TIMEOUT_MS', REPLY_DEADLINE_MS),
    dispatchAttempts: Math.max(1, int(env, 'MACHINE_DISPATCH_ATTEMPTS', 3)),
    handoffTimeout: env.MACHINE_HANDOFF_TIMEOUT ?? '10m',
    offlineDebounceMs: int(env, 'MACHINE_OFFLINE_DEBOUNCE_MS', 15_000),
    quietMs: int(env, 'MACHINE_QUIET_MS', 90_000),
    dispatchTtlMs: int(env, 'MACHINE_DISPATCH_TTL_MS', 600_000),
    ltBaseUrl: env.LT_BASE_URL ?? 'http://localhost:3000',
  };
  if (transport === MACHINE_TRANSPORT.NATS) {
    config.siteNatsUrl = required(env, 'MACHINE_SITE_NATS_URL', transport);
    config.siteNatsUser = env.MACHINE_SITE_NATS_USER;
    config.siteNatsPassword = env.MACHINE_SITE_NATS_PASSWORD;
    config.mqtt = mqttEndpoint(env, transport, 5);
  }
  if (transport === MACHINE_TRANSPORT.MQTT) config.mqtt = mqttEndpoint(env, transport, 5);
  if (feed === ESCALATION_FEED.CORE) {
    config.ltNatsUrl = env.NATS_URL;
    config.ltNatsToken = env.NATS_TOKEN;
    if (!config.ltNatsUrl) throw new Error('MACHINE_ESCALATION_FEED=core needs NATS_URL (Long Tail NATS)');
  }
  return config;
}
