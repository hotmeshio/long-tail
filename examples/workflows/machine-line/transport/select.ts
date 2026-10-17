/**
 * Transport selection from config. The memory transport only exists inside
 * one process (tests build it directly), so asking for it here throws, as
 * does any mode missing what it needs.
 */

import { ESCALATION_FEED, MACHINE_TRANSPORT, type MachineLineConfig, type MqttEndpoint } from '../config';
import { controllerId, type LineDef } from '../line';
import { lineFilter } from '../protocol';
import { MqttMachineBus } from './mqtt-bus';
import { MqttMachineLink } from './mqtt-link';
import { NatsMachineBus } from './nats-bus';
import { CoreEscalationFeed, JetStreamEscalationFeed } from './nats-feed';
import type { EscalationFeed, MachineBus, MachineLink } from './types';

const IN_PROCESS_ONLY = 'lives inside one process; build MemoryMachineBus and MemoryEscalationFeed directly';

function mqttOf(config: MachineLineConfig): MqttEndpoint {
  if (!config.mqtt) throw new Error(`MACHINE_TRANSPORT=${config.transport} has no MQTT endpoint (MACHINE_MQTT_URL)`);
  return config.mqtt;
}

/** The gateway's view of every machine on the line. */
export function createMachineBus(config: MachineLineConfig, line: LineDef): MachineBus {
  switch (config.transport) {
    case MACHINE_TRANSPORT.NATS:
      return new NatsMachineBus({
        natsUrl: config.siteNatsUrl!, user: config.siteNatsUser, password: config.siteNatsPassword,
        mqtt: mqttOf(config), controllerId: controllerId(line), root: config.topicRoot, siteId: line.siteId, lineId: line.lineId,
      });
    case MACHINE_TRANSPORT.MQTT:
      return new MqttMachineBus(mqttOf(config), controllerId(line), lineFilter(config.topicRoot, line.siteId, line.lineId));
    default:
      throw new Error(`MACHINE_TRANSPORT=${config.transport} ${IN_PROCESS_ONLY}`);
  }
}

/** Long Tail's escalation events for the gateway. */
export function createEscalationFeed(config: MachineLineConfig, line: LineDef): EscalationFeed {
  switch (config.feed) {
    case ESCALATION_FEED.JETSTREAM:
      return new JetStreamEscalationFeed({
        natsUrl: config.siteNatsUrl!, user: config.siteNatsUser, password: config.siteNatsPassword,
        root: config.topicRoot, durableName: `${controllerId(line)}-escalations`,
      });
    case ESCALATION_FEED.CORE:
      return new CoreEscalationFeed({ natsUrl: config.ltNatsUrl!, token: config.ltNatsToken });
    default:
      throw new Error(`MACHINE_ESCALATION_FEED=${config.feed} ${IN_PROCESS_ONLY}`);
  }
}

/** One MQTT link per simulated machine; machines speak MQTT in every networked mode. */
export function createLinkFactory(config: MachineLineConfig): () => MachineLink {
  if (config.transport === MACHINE_TRANSPORT.MEMORY) throw new Error(`MACHINE_TRANSPORT=memory ${IN_PROCESS_ONLY}`);
  const endpoint = mqttOf(config);
  return () => new MqttMachineLink(endpoint);
}
