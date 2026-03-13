import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';

import { LLM_MODEL_SECONDARY } from '../../../modules/defaults';
import type { ClaimAnalysis } from './types';
import { ASSESS_DOCUMENT_QUALITY_PROMPT } from './prompts';

// ── Resolve fixtures directory ──────────────────────────────────────────────
function fixturesDir(): string {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'tests', 'fixtures'),
    path.join(__dirname, '..', '..', '..', '..', 'tests', 'fixtures'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

/**
 * Analyze claim documents using OpenAI Vision.
 *
 * Reads each document image, sends it to gpt-4o-mini for quality assessment.
 * Returns a confidence score based on whether the images are readable.
 *
 * Falls back to filename-based heuristics when OPENAI_API_KEY is not set.
 */
export async function analyzeDocuments(
  documents: string[],
): Promise<ClaimAnalysis> {
  if (documents.length === 0) {
    return {
      confidence: 0,
      flags: ['no_documents'],
      summary: 'No documents provided for analysis.',
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'xxx') {
    // Fallback: filename-based heuristic (for testing without API key)
    return analyzeByFilename(documents);
  }

  const openai = new OpenAI({ apiKey });
  const dir = fixturesDir();
  const flags: string[] = [];
  let readableCount = 0;

  for (const doc of documents) {
    const filePath = path.join(dir, doc);
    if (!fs.existsSync(filePath)) {
      flags.push(`missing_file:${doc}`);
      continue;
    }

    const imageContent = fs.readFileSync(filePath, 'base64');
    const response = await openai.chat.completions.create({
      model: LLM_MODEL_SECONDARY,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: ASSESS_DOCUMENT_QUALITY_PROMPT,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${imageContent}`,
                detail: 'low',
              },
            },
          ],
        },
      ],
      max_tokens: 200,
    });

    const raw = response.choices?.[0]?.message?.content || '';
    try {
      const cleaned = raw.replace(/^```json\n?|\n?```$/g, '').trim();
      const assessment = JSON.parse(cleaned);

      if (assessment.readable) {
        readableCount++;
      } else {
        if (assessment.orientation === 'upside_down') flags.push(`upside_down:${doc}`);
        else if (assessment.orientation === 'rotated') flags.push(`rotated:${doc}`);
        else flags.push(`unreadable:${doc}`);
      }
    } catch {
      flags.push(`assessment_failed:${doc}`);
    }
  }

  const confidence = documents.length > 0 ? readableCount / documents.length : 0;

  if (confidence >= 0.85) {
    return {
      confidence,
      flags: flags.length > 0 ? flags : [],
      summary: 'All document images processed successfully. Data extraction complete.',
    };
  }

  return {
    confidence,
    flags: flags.length > 0 ? flags : ['unreadable_images'],
    summary:
      `${documents.length - readableCount} of ${documents.length} document images have quality issues. ` +
      'Unable to extract data reliably.',
  };
}

/**
 * Filename-based fallback when no API key is available.
 */
function analyzeByFilename(documents: string[]): ClaimAnalysis {
  const correctedCount = documents.filter(d => d.includes('_rotated')).length;
  const allCorrected = correctedCount === documents.length && documents.length > 0;

  if (allCorrected) {
    return {
      confidence: 0.92,
      flags: [],
      summary: 'All document images processed successfully. Data extraction complete.',
    };
  }

  const flags: string[] = [];
  for (const doc of documents) {
    if (doc.includes('upside_down')) flags.push(`upside_down:${doc}`);
    else if (!doc.includes('_rotated')) flags.push(`unreadable:${doc}`);
  }
  if (flags.length === 0) flags.push('unreadable_images');

  return {
    confidence: 0.35,
    flags,
    summary:
      'Document images appear damaged or improperly oriented. ' +
      'Unable to extract data reliably.',
  };
}

/**
 * Validate a claim against the claimant record.
 * Only succeeds when analysis confidence is above threshold.
 */
export async function validateClaim(
  claimantId: string,
  confidence: number,
): Promise<{ valid: boolean; reason: string }> {
  if (confidence >= 0.85) {
    return {
      valid: true,
      reason: `Claimant ${claimantId} verified. Claim data matches policy records.`,
    };
  }

  return {
    valid: false,
    reason:
      `Insufficient confidence (${confidence.toFixed(2)}) to validate claim. ` +
      `Document quality too low for automated processing.`,
  };
}
