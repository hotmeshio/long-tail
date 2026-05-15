import * as agentService from '../services/agent';
import type { LTApiResult, LTApiAuth } from '../types/sdk';

export async function listAgents(
  input: { status?: string; knowledge_domain?: string; limit?: number; offset?: number },
): Promise<LTApiResult> {
  try {
    const result = await agentService.listAgents(input);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function getAgent(input: { id: string }): Promise<LTApiResult> {
  try {
    const agent = await agentService.getAgent(input.id);
    if (!agent) {
      return { status: 404, error: 'Agent not found' };
    }
    const stats = await agentService.getAgentStats(agent);
    return { status: 200, data: { ...agent, stats } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function createAgent(
  input: { name: string; [key: string]: any },
  _auth?: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const agent = await agentService.createAgent(input);
    return { status: 201, data: agent };
  } catch (err: any) {
    if (err.code === '23505') {
      return { status: 409, error: `Agent "${input.name}" already exists` };
    }
    return { status: 500, error: err.message };
  }
}

export async function updateAgent(
  input: { id: string; [key: string]: any },
): Promise<LTApiResult> {
  try {
    const { id, ...data } = input;
    const agent = await agentService.updateAgent(id, data);
    if (!agent) {
      return { status: 404, error: 'Agent not found' };
    }
    return { status: 200, data: agent };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function deleteAgent(input: { id: string }): Promise<LTApiResult> {
  try {
    const deleted = await agentService.deleteAgent(input.id);
    if (!deleted) {
      return { status: 404, error: 'Agent not found' };
    }
    return { status: 200, data: { deleted: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
