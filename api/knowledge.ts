import * as knowledgeActivity from '../system/activities/knowledge';
import type { LTApiResult } from '../types/sdk';

export async function listDomains(): Promise<LTApiResult> {
  try {
    const result = await knowledgeActivity.listDomains();
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function listEntries(input: {
  domain: string;
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<LTApiResult> {
  try {
    const result = await knowledgeActivity.listKnowledge(input);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function getEntry(input: {
  domain: string;
  key: string;
}): Promise<LTApiResult> {
  try {
    const result = await knowledgeActivity.getKnowledge(input);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function storeEntry(input: {
  domain: string;
  key: string;
  data: Record<string, any>;
  tags?: string[];
  replace?: boolean;
}): Promise<LTApiResult> {
  try {
    const result = await knowledgeActivity.storeKnowledge(input);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function setField(input: {
  domain: string;
  key: string;
  path: string;
  value: any;
  tags?: string[];
}): Promise<LTApiResult> {
  try {
    const result = await knowledgeActivity.setKnowledgeField(input);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function removeField(input: {
  domain: string;
  key: string;
  path: string;
}): Promise<LTApiResult> {
  try {
    const result = await knowledgeActivity.removeKnowledgeField(input);
    if (!result.removed) {
      return { status: 404, error: 'Field not found' };
    }
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function deleteEntry(input: {
  domain: string;
  key: string;
}): Promise<LTApiResult> {
  try {
    const result = await knowledgeActivity.deleteKnowledge(input);
    if (!result.deleted) {
      return { status: 404, error: 'Entry not found' };
    }
    return { status: 200, data: { deleted: true, domain: input.domain, key: input.key } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
