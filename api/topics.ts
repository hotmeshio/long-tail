import * as topicService from '../services/topics';
import { eventRegistry } from '../lib/events';
import type { LTEvent } from '../types';
import type { LTApiResult } from '../types/sdk';

export async function listTopics(
  input: { category?: string; search?: string; limit?: number; offset?: number },
): Promise<LTApiResult> {
  try {
    const result = await topicService.listTopics(input);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function getTopic(input: { topic: string }): Promise<LTApiResult> {
  try {
    const topic = await topicService.getTopic(input.topic);
    if (!topic) {
      return { status: 404, error: 'Topic not found' };
    }
    return { status: 200, data: topic };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function createTopic(
  input: { topic: string; category: string; [key: string]: any },
): Promise<LTApiResult> {
  try {
    const topic = await topicService.createTopic(input);
    return { status: 201, data: topic };
  } catch (err: any) {
    if (err.code === '23505') {
      return { status: 409, error: `Topic "${input.topic}" already exists` };
    }
    return { status: 500, error: err.message };
  }
}

export async function updateTopic(
  input: { topic: string; [key: string]: any },
): Promise<LTApiResult> {
  try {
    const { topic, ...data } = input;
    const updated = await topicService.updateTopic(topic, data);
    if (!updated) {
      return { status: 404, error: 'Topic not found' };
    }
    return { status: 200, data: updated };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function deleteTopic(input: { topic: string }): Promise<LTApiResult> {
  try {
    // Check if it exists and if it's a system topic
    const existing = await topicService.getTopic(input.topic);
    if (!existing) {
      return { status: 404, error: 'Topic not found' };
    }
    if (existing.source === 'system') {
      return { status: 403, error: 'System topics cannot be deleted' };
    }
    await topicService.deleteTopic(input.topic);
    return { status: 200, data: { deleted: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function publishTopic(input: {
  topic: string;
  data: Record<string, any>;
  source?: string;
}): Promise<LTApiResult> {
  try {
    const event: LTEvent = {
      type: input.topic,
      source: input.source || 'dashboard',
      workflowId: '',
      workflowName: '',
      taskQueue: '',
      data: input.data,
      timestamp: new Date().toISOString(),
    };
    await eventRegistry.publish(event);
    return { status: 200, data: { published: true, topic: input.topic, timestamp: event.timestamp } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
