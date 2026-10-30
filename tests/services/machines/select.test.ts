import { afterEach, describe, it, expect } from 'vitest';

import { loadMachineLineConfig } from '../../../services/machines/config';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { CoreEscalationFeed, MqttMachineBus, MqttMachineLink, NatsMachineBus, PubSubEscalationFeed, StreamMachineBus } from '../../../lib/machines/transport';
import { MemoryMessagingProvider, messagingRegistry } from '../../../lib/messaging';
import { createEscalationFeed, createLinkFactory, createMachineBus } from '../../../services/machines/select';

const NATS = { MACHINE_TRANSPORT: 'nats', MACHINE_SITE_NATS_URL: 'nats://site:4222', MACHINE_MQTT_URL: 'mqtts://site:8883', NATS_URL: 'nats://lt:4222' };
const MQTT = { MACHINE_TRANSPORT: 'mqtt', MACHINE_MQTT_URL: 'mqtts://broker:8883', NATS_URL: 'nats://lt:4222' };

describe('transport selection', () => {
  it('nats: JetStream bus on the site broker, Long Tail NATS core feed, MQTT links for machines', () => {
    const config = loadMachineLineConfig(NATS);
    expect(createMachineBus(config, DEFAULT_LINE)).toBeInstanceOf(NatsMachineBus);
    expect(createEscalationFeed(config, DEFAULT_LINE)).toBeInstanceOf(CoreEscalationFeed);
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

  describe('on Long Tail messaging', () => {
    const SHARED = { MACHINE_TRANSPORT: 'nats', MACHINE_MQTT_URL: 'mqtts://site:8883' };
    afterEach(() => messagingRegistry.clear());

    it('reads machine events from Long Tail\'s streams when the site has no NATS of its own', () => {
      messagingRegistry.register(new MemoryMessagingProvider());
      const bus = createMachineBus(loadMachineLineConfig(SHARED), DEFAULT_LINE) as StreamMachineBus;
      expect(bus).toBeInstanceOf(StreamMachineBus);
      expect(bus.durableName).toBe('line-controller-site-1-line-1-events');
      expect(createEscalationFeed(loadMachineLineConfig(SHARED), DEFAULT_LINE)).toBeInstanceOf(PubSubEscalationFeed);
    });

    it('fails loudly when neither Long Tail messaging nor a site NATS is configured', () => {
      expect(() => createMachineBus(loadMachineLineConfig(SHARED), DEFAULT_LINE)).toThrow(/LT_MESSAGING=nats/);
      expect(() => createEscalationFeed(loadMachineLineConfig(SHARED), DEFAULT_LINE)).toThrow(/LT_MESSAGING=nats/);
    });
  });
});
