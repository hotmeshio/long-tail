import type { LTToolManifestEntry } from '../../types';

// ── Machines tool manifests ──────────────────────────────────────────────────
// Each entry mirrors the exact tool registered in system/mcp-servers/machines.ts

const siteLine = {
  siteId: { type: 'string', description: 'Site id' },
  lineId: { type: 'string', description: 'Line id' },
};

export const MACHINE_TOOLS: LTToolManifestEntry[] = [
  {
    name: 'list_machine_lines',
    gate: 'caller',
    description: 'The lines index: every declared line with its machines and health (offline, alarms, rows waiting on people, work in flight), searchable, filtered by site or attention, paginated.',
    read_safe: true,
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search site, line, machine ids, processes, roles and addresses' },
        site: { type: 'string', description: 'Only this site' },
        attention: { type: 'boolean', description: 'Only lines with an offline machine, an active alarm or a row waiting on a person' },
        sort: { type: 'string', enum: ['attention', 'site', 'updated'], description: 'attention first (default), site, or recently changed' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        offset: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'get_machine_line',
    gate: 'caller',
    description: 'One line as its leader sees it: machine links, held units, open rows, alarms, last snapshots and contested claims, with the stored summary (machines, roles, addresses, command ops). A replica not leading the line answers leading: false.',
    read_safe: true,
    inputSchema: { type: 'object', properties: { ...siteLine }, required: ['siteId', 'lineId'] },
  },
  {
    name: 'inspect_machine_message',
    gate: 'caller',
    description: 'A dry run of one wire message on the leader\'s state: what the codec reads, the contract violations found, and what the gateway would do, with nothing applied.',
    read_safe: true,
    inputSchema: {
      type: 'object',
      properties: {
        ...siteLine,
        topic: { type: 'string', description: 'The MQTT topic the message would arrive on' },
        payload: { description: 'The message body: an object is serialized as JSON, a string passes through' },
        retained: { type: 'boolean', description: 'Whether the broker would deliver it as retained' },
      },
      required: ['siteId', 'lineId', 'topic'],
    },
  },
  {
    name: 'send_machine_command',
    gate: 'caller',
    description: 'Park a machine-command row on the machine\'s role as the caller; the line\'s gateway sends it and resolves the row with the machine\'s reply. Ops: start, stop, pause, resume, changeover, ack-alarm, snapshot, and any the codec declares.',
    read_safe: false,
    inputSchema: {
      type: 'object',
      properties: {
        ...siteLine,
        machineId: { type: 'string', description: 'The machine on the line' },
        op: { type: 'string', description: 'A control op, snapshot, or an op the line\'s codec declares' },
        args: { type: 'object', description: 'Arguments the op takes, such as jobId or recipe' },
      },
      required: ['siteId', 'lineId', 'machineId', 'op'],
    },
  },
  {
    name: 'declare_machine_line',
    gate: 'admin',
    description: 'Declare or update a line in the registry: the definition is validated, its roles applied where none exist, the line run on every replica, and the row versioned once per change.',
    read_safe: false,
    inputSchema: {
      type: 'object',
      properties: {
        definition: { type: 'object', description: 'The line definition: siteId, lineId, machines in route order (machineId, process, cycleSec), roles, addressing' },
        version: { type: 'integer', minimum: 1, description: 'The version the row is expected to be at; a mismatch is a conflict' },
      },
      required: ['definition'],
    },
  },
  {
    name: 'retire_machine_line',
    gate: 'admin',
    description: 'Retire a line: the row leaves the registry and every replica stops running it. Its roles and bot accounts stay.',
    read_safe: false,
    inputSchema: { type: 'object', properties: { ...siteLine }, required: ['siteId', 'lineId'] },
  },
];
