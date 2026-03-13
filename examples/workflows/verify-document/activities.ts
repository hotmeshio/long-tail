import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';

import { LLM_MODEL_SECONDARY } from '../../../modules/defaults';
import type { MemberInfo } from './types';
import { EXTRACT_MEMBER_INFO_PROMPT } from './prompts';

/**
 * Local filesystem abstraction that mirrors cloud storage (GCS/S3).
 * In production, swap for your cloud provider's SDK.
 */
class LocalStorage {
  constructor(private baseDir: string) {}

  async getObject(key: string): Promise<string> {
    const filePath = path.join(this.baseDir, key);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${key}`);
    }
    return fs.readFileSync(filePath, 'base64');
  }

  async listObjects(prefix: string): Promise<string[]> {
    const dir = path.join(this.baseDir, prefix);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
      .map(f => path.join(prefix, f));
  }
}

const storage = new LocalStorage(
  path.join(__dirname, '..', '..', '..', 'tests', 'fixtures'),
);

/**
 * List available document pages from storage.
 */
export async function listDocumentPages(): Promise<string[]> {
  const refs = await storage.listObjects('');
  if (refs.length === 0) {
    throw new Error('No image files found in storage');
  }
  return refs;
}

/**
 * Extract member information from a document image using OpenAI Vision.
 */
export async function extractMemberInfo(
  imageRef: string,
  pageNumber: number,
): Promise<MemberInfo | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'xxx') {
    throw new Error(
      'OPENAI_API_KEY required. Set it in .env to run vision workflows.',
    );
  }

  const imageContent = await storage.getObject(imageRef);
  const openai = new OpenAI({ apiKey });

  const response = await openai.chat.completions.create({
    model: LLM_MODEL_SECONDARY,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: EXTRACT_MEMBER_INFO_PROMPT(pageNumber),
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${imageContent}`,
              detail: 'high',
            },
          },
        ],
      },
    ],
    max_tokens: 1000,
  });

  const raw = response.choices?.[0]?.message?.content;
  if (!raw) return null;

  try {
    const cleaned = raw.replace(/^```json\n?|\n?```$/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.memberId) {
      return { ...parsed, isPartialInfo: true };
    }
    return parsed as MemberInfo;
  } catch {
    console.warn(`[verify-document] Failed to parse vision response for page ${pageNumber}:`, raw);
    return null;
  }
}

/**
 * Validate extracted member info against the member database.
 * Returns 'match', 'mismatch', or 'not_found'.
 */
export async function validateMember(
  memberInfo: MemberInfo,
): Promise<{
  result: 'match' | 'mismatch' | 'not_found';
  databaseRecord?: Record<string, any>;
}> {
  if (!memberInfo.memberId) {
    return { result: 'not_found' };
  }

  const dbPath = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'member-database.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const record = db.members[memberInfo.memberId];

  if (!record) {
    return { result: 'not_found' };
  }

  // Address match check
  if (memberInfo.address && record.address) {
    const a = memberInfo.address;
    const b = record.address;
    const addressMatch =
      a.street === b.street &&
      a.city === b.city &&
      a.state === b.state &&
      a.zip === b.zip;

    if (!addressMatch) {
      return { result: 'mismatch', databaseRecord: record };
    }
  }

  // Status check
  if (record.status !== 'active') {
    return { result: 'mismatch', databaseRecord: record };
  }

  return { result: 'match', databaseRecord: record };
}
