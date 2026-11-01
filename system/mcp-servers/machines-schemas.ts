import { z } from 'zod';

/** Zod input schemas for the machines MCP server; the manifest mirrors them as JSON schema. */

const siteLine = {
  siteId: z.string().min(1).describe('Site id'),
  lineId: z.string().min(1).describe('Line id'),
};

export const listMachineLinesSchema = {
  q: z.string().optional().describe('Search site, line, machine ids, processes, roles and addresses'),
  site: z.string().optional().describe('Only this site'),
  attention: z.boolean().optional().describe('Only lines with an offline machine, an active alarm or a row waiting on a person'),
  sort: z.enum(['attention', 'site', 'updated']).optional().describe('attention first (default), site, or recently changed'),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
};

export const getMachineLineSchema = { ...siteLine };

export const inspectMachineMessageSchema = {
  ...siteLine,
  topic: z.string().min(1).describe('The MQTT topic the message would arrive on'),
  payload: z.any().optional().describe('The message body: an object is serialized as JSON, a string passes through'),
  retained: z.boolean().optional().describe('Whether the broker would deliver it as retained'),
};

export const sendMachineCommandSchema = {
  ...siteLine,
  machineId: z.string().min(1).describe('The machine on the line'),
  op: z.string().min(1).describe('A control op, snapshot, or an op the line\'s codec declares'),
  args: z.record(z.any()).optional().describe('Arguments the op takes, such as jobId or recipe'),
};

export const declareMachineLineSchema = {
  definition: z.record(z.any()).describe('The line definition: siteId, lineId, machines in route order (machineId, process, cycleSec), roles, addressing'),
  version: z.number().int().min(1).optional().describe('The version the row is expected to be at; a mismatch is a conflict'),
};

export const retireMachineLineSchema = { ...siteLine };
