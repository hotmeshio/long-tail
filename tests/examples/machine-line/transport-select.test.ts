import { describe, it, expect } from 'vitest';

import { loadMachineLineConfig } from '../../../examples/workflows/machine-line/config';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import {
  CoreEscalationFeed, JetStreamEscalationFeed, MqttMachineBus, MqttMachineLink, NatsMachineBus,
  createEscalationFeed, createLinkFactory, createMachineBus,
} from '../../../examples/workflows/machine-line/transport';

const NATS = { MACHINE_TRANSPORT: 'nats', MACHINE_SITE_NATS_URL: 'nats://site:4222', MACHINE_MQTT_URL: 'mqtts://site:8883' };
const MQTT = { MACHINE_TRANSPORT: 'mqtt', MACHINE_MQTT_URL: 'mqtts://broker:8883', NATS_URL: 'nats://lt:4222' };

describe('transport selection', () => {
  it('nats: JetStream bus and feed on the site broker, MQTT links for machines', () => {
    const config = loadMachineLineConfig(NATS);
    expect(createMachineBus(config, DEFAULT_LINE)).toBeInstanceOf(NatsMachineBus);
    expect(createEscalationFeed(config, DEFAULT_LINE)).toBeInstanceOf(JetStreamEscalationFeed);
    expect(createLinkFactory(config)()).toBeInstanceOf(MqttMachineLink);
  });

  it('mqtt: a plain MQTT bus and Long Tail NATS core feed', () => {
    const config = loadMachineLineConfig(MQTT);
    expect(createMachineBus(config, DEFAULT_LINE)).toBeInstanceOf(MqttMachineBus);
    expect(createEscalationFeed(config, DEFAULT_LINE)).toBeInstanceOf(CoreEscalationFeed);
  });

  it('names the gateway durable after the line controller', () => {
    const bus = createMachineBus(loadMachineLineConfig(NATS), DEFAULT_LINE) as NatsMachineBus;
    expect(bus.durableName).toBe('line-controller-site-1-line-1-events');
  });

  it('memory lives in one process, so selecting it throws', () => {
    const config = loadMachineLineConfig({});
    expect(() => createMachineBus(config, DEFAULT_LINE)).toThrow(/one process/);
    expect(() => createEscalationFeed(config, DEFAULT_LINE)).toThrow(/one process/);
    expect(() => createLinkFactory(config)).toThrow(/one process/);
  });

  it('a networked mode without an MQTT endpoint throws', () => {
    const config = { ...loadMachineLineConfig(MQTT), mqtt: undefined };
    expect(() => createMachineBus(config, DEFAULT_LINE)).toThrow(/MACHINE_MQTT_URL/);
    expect(() => createLinkFactory(config)).toThrow(/MACHINE_MQTT_URL/);
  });
});
