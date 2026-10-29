/**
 * Transport selection from config. The memory transport only exists inside
 * one process (tests build it directly), so asking for it here throws, as
 * does any mode missing what it needs.
 */

import { ESCALATION_FEED, MACHINE_TRANSPORT, type MachineLineConfig, type MqttEndpoint } from './config';
import { controllerId, type LineDef } from '../../lib/machines/line';
import { genericCodec, lineFilter, type LineCodec } from '../../lib/machines/protocol';
import { MqttMachineBus } from '../../lib/machines/transport/mqtt-bus';
import { MqttMachineLink } from '../../lib/machines/transport/mqtt-link';
import { NatsMachineBus } from '../../lib/machines/transport/nats-bus';
import { StreamMachineBus } from '../../lib/machines/transport/stream-bus';
import { CallbackEscalationFeed } from '../../lib/machines/transport/callback-feed';
import { CoreEscalationFeed } from '../../lib/machines/transport/nats-feed';
import { PubSubEscalationFeed } from '../../lib/machines/transport/pubsub-feed';
import { messagingRegistry } from '../../lib/messaging';
import type { CallbackEventAdapter } from '../../lib/events/callback';
import type { EscalationFeed, MachineBus, MachineLink } from '../../lib/machines/transport/delivery';

const IN_PROCESS_ONLY = 'lives inside one process; build MemoryMachineBus and MemoryEscalationFeed directly';

function mqttOf(config: MachineLineConfig): MqttEndpoint {
  if (!config.mqtt) throw new Error(`MACHINE_TRANSPORT=${config.transport} has no MQTT endpoint (MACHINE_MQTT_URL)`);
  return config.mqtt;
}

/** The codec for a line when the host supplies none: the line protocol under MACHINE_TOPIC_ROOT. */
export function defaultCodec(config: MachineLineConfig, line?: LineDef): LineCodec {
  return genericCodec({ root: config.topicRoot, line });
}

/** What the stream bus needs from Long Tail's messaging; the registry by default. */
export type LineMessaging = Pick<typeof messagingRegistry, 'streams' | 'pubsub'>;

/**
 * The gateway's view of every machine on the line. With `nats`, events are read
 * from Long Tail's messaging streams; MACHINE_SITE_NATS_URL instead names a NATS
 * server of the site's own, which the bus connects to itself.
 */
export function createMachineBus(
  config: MachineLineConfig, line: LineDef, codec: LineCodec = defaultCodec(config, line), messaging: LineMessaging = messagingRegistry,
): MachineBus {
  switch (config.transport) {
    case MACHINE_TRANSPORT.NATS: {
      const where = { mqtt: mqttOf(config), controllerId: controllerId(line), siteId: line.siteId, lineId: line.lineId, codec };
      if (config.siteNatsUrl) {
        return new NatsMachineBus({ natsUrl: config.siteNatsUrl, user: config.siteNatsUser, password: config.siteNatsPassword, ...where });
      }
      return new StreamMachineBus({ streams: messaging.streams, pubsub: messaging.pubsub, ...where });
    }
    case MACHINE_TRANSPORT.MQTT:
      return new MqttMachineBus(mqttOf(config), controllerId(line), lineFilter(codec.root, line.siteId, line.lineId));
    default:
      throw new Error(`MACHINE_TRANSPORT=${config.transport} ${IN_PROCESS_ONLY}`);
  }
}

/** Long Tail's escalation events for the gateway; `in-process` needs the running instance's callback adapter. */
export function createEscalationFeed(config: MachineLineConfig, line: LineDef, callbacks?: CallbackEventAdapter): EscalationFeed {
  switch (config.feed) {
    case ESCALATION_FEED.IN_PROCESS:
      if (!callbacks) throw new Error('MACHINE_ESCALATION_FEED=in-process runs inside start({ machines })');
      return new CallbackEscalationFeed(callbacks);
    case ESCALATION_FEED.CORE:
      if (messagingRegistry.hasProvider) return new PubSubEscalationFeed(messagingRegistry.pubsub);
      if (!config.ltNatsUrl) throw new Error('MACHINE_ESCALATION_FEED=core needs Long Tail messaging (LT_MESSAGING=nats) or NATS_URL');
      return new CoreEscalationFeed({ natsUrl: config.ltNatsUrl, token: config.ltNatsToken });
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
