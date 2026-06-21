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

/**
 * Validate that a subject is a valid variant of a topic pattern.
 * Each `*` in the pattern matches exactly one literal segment in the subject.
 * Each `>` in the pattern matches one or more trailing segments.
 * Literal segments must match exactly.
 */
export function isValidVariant(pattern: string, subject: string): boolean {
  const patternParts = pattern.split('.');
  const subjectParts = subject.split('.');

  let pi = 0;
  let si = 0;
  while (pi < patternParts.length && si < subjectParts.length) {
    const pp = patternParts[pi];
    if (pp === '>') return true; // match-rest: everything from here is valid
    if (pp !== '*' && pp !== subjectParts[si]) return false;
    pi++;
    si++;
  }
  return pi === patternParts.length && si === subjectParts.length;
}

/**
 * A publishable event envelope. The request body IS the event: any `LTEvent`
 * field the caller wants to set (`id`, `source`, `data`, and — for system
 * families — `workflowId` / `workflowName` / `taskQueue` / `status` / etc.),
 * minus the server-managed ones (`type` is derived from the subject, `timestamp`
 * is stamped). `subject` is an optional concrete variant of a wildcard topic.
 *
 * One typed object, infinitely extensible — no per-field API parameters.
 */
export type PublishEventInput = Partial<Omit<LTEvent, 'type' | 'timestamp'>> & {
  subject?: string;
};

export async function publishTopic(input: {
  topic: string;
  event?: PublishEventInput;
}): Promise<LTApiResult> {
  try {
    const { subject, ...fields } = input.event ?? {};
    const publishSubject = subject || input.topic;

    // Validate subject is a valid variant of the topic pattern
    if (subject && !isValidVariant(input.topic, subject)) {
      return { status: 400, error: `Subject "${subject}" does not match topic pattern "${input.topic}"` };
    }

    // The envelope is the caller's; the server owns type/timestamp (and mints id
    // downstream in eventRegistry.publish if the caller didn't supply one).
    const event: LTEvent = {
      ...fields,
      type: publishSubject,
      source: fields.source || 'dashboard',
      data: fields.data ?? {},
      timestamp: new Date().toISOString(),
    };
    await eventRegistry.publish(event);
    return { status: 200, data: { published: true, topic: publishSubject, timestamp: event.timestamp } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
