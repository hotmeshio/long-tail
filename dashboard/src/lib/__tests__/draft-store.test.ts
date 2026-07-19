import { describe, it, expect, beforeEach } from 'vitest';
import { readDraft, saveDraft, clearDraft } from '../draft-store';

const ESC_ID = 'esc-123';

describe('draft-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no draft exists', () => {
    expect(readDraft(ESC_ID)).toBeNull();
  });

  it('round-trips a saved draft', () => {
    const json = JSON.stringify({ notes: 'work in progress' });
    saveDraft(ESC_ID, json);
    expect(readDraft(ESC_ID)).toBe(json);
  });

  it('scopes drafts per escalation id', () => {
    saveDraft(ESC_ID, '{"a":1}');
    saveDraft('esc-456', '{"b":2}');
    expect(readDraft(ESC_ID)).toBe('{"a":1}');
    expect(readDraft('esc-456')).toBe('{"b":2}');
  });

  it('clearDraft removes only the targeted draft', () => {
    saveDraft(ESC_ID, '{"a":1}');
    saveDraft('esc-456', '{"b":2}');
    clearDraft(ESC_ID);
    expect(readDraft(ESC_ID)).toBeNull();
    expect(readDraft('esc-456')).toBe('{"b":2}');
  });

  it('overwrites an existing draft on save', () => {
    saveDraft(ESC_ID, '{"v":1}');
    saveDraft(ESC_ID, '{"v":2}');
    expect(readDraft(ESC_ID)).toBe('{"v":2}');
  });

  it('clearDraft on a missing draft is a no-op', () => {
    expect(() => clearDraft('never-saved')).not.toThrow();
  });
});
