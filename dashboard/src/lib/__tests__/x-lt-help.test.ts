import { describe, it, expect } from 'vitest';
import {
  interpolateHelp,
  resolveHelpSource,
  buildHelpMarkdown,
  defaultHelpMarkdown,
  type HelpTokenContext,
} from '../x-lt-help';

const CTX: HelpTokenContext = {
  escalation: { role: 'intake-reviewer', status: 'pending', priority: 2 },
  metadata: { schema_version: 1, region: 'us-east' },
  envelope: { formDefaults: { customer: { name: 'Acme Widgets LLC' }, tags: ['a', 'b'] } },
  payload: { category: 'missing_credential' },
  resolver: { notes: 'looks good' },
};

describe('interpolateHelp', () => {
  it('interpolates values from each domain', () => {
    expect(interpolateHelp('{{escalation.role}}', CTX)).toBe('intake-reviewer');
    expect(interpolateHelp('{{metadata.region}}', CTX)).toBe('us-east');
    expect(interpolateHelp('{{envelope.formDefaults.customer.name}}', CTX)).toBe('Acme Widgets LLC');
    expect(interpolateHelp('{{payload.category}}', CTX)).toBe('missing_credential');
    expect(interpolateHelp('{{resolver.notes}}', CTX)).toBe('looks good');
  });

  it('interpolates multiple tokens inside surrounding text', () => {
    expect(interpolateHelp('Queue **{{escalation.role}}** at P{{escalation.priority}}.', CTX))
      .toBe('Queue **intake-reviewer** at P2.');
  });

  it('formats numbers and booleans as plain strings', () => {
    const ctx: HelpTokenContext = { metadata: { count: 3, ok: false } };
    expect(interpolateHelp('{{metadata.count}}/{{metadata.ok}}', ctx)).toBe('3/false');
  });

  it('supports array indices via x-lt-bind path syntax', () => {
    expect(interpolateHelp('{{envelope.formDefaults.tags[1]}}', CTX)).toBe('b');
  });

  it('renders an em dash for missing paths, unknown domains, and null context', () => {
    expect(interpolateHelp('{{metadata.absent}}', CTX)).toBe('—');
    expect(interpolateHelp('{{nope.anything}}', CTX)).toBe('—');
    expect(interpolateHelp('{{resolver.notes}}', {})).toBe('—');
  });

  it('renders an em dash for invalid path expressions', () => {
    expect(interpolateHelp('{{metadata.__proto__.x}}', CTX)).toBe('—');
  });

  it('stringifies object values inline', () => {
    expect(interpolateHelp('{{payload}}', CTX)).toBe('{"category":"missing_credential"}');
  });

  it('tolerates whitespace inside token braces', () => {
    expect(interpolateHelp('{{  escalation.status  }}', CTX)).toBe('pending');
  });

  it('passes text without tokens through unchanged', () => {
    const md = '### Checklist\n\n- no tokens here';
    expect(interpolateHelp(md, CTX)).toBe(md);
  });
});

describe('resolveHelpSource', () => {
  it('prefers x-lt-help over x-lt-context', () => {
    expect(resolveHelpSource({ 'x-lt-help': 'rich', 'x-lt-context': 'plain' })).toBe('rich');
  });

  it('falls back to x-lt-context', () => {
    expect(resolveHelpSource({ 'x-lt-context': 'plain' })).toBe('plain');
  });

  it('returns null for absent, blank, or non-string sources', () => {
    expect(resolveHelpSource(null)).toBeNull();
    expect(resolveHelpSource({})).toBeNull();
    expect(resolveHelpSource({ 'x-lt-help': '   ' })).toBeNull();
    expect(resolveHelpSource({ 'x-lt-help': 42 })).toBeNull();
  });
});

describe('buildHelpMarkdown', () => {
  it('returns the interpolated schema help', () => {
    const schema = { 'x-lt-help': 'Working {{escalation.role}}.' };
    expect(buildHelpMarkdown(schema, CTX)).toBe('Working intake-reviewer.');
  });

  it('returns null when the schema declares no help', () => {
    expect(buildHelpMarkdown({}, CTX)).toBeNull();
  });
});

describe('defaultHelpMarkdown', () => {
  it('guides an unclaimed escalation toward claiming', () => {
    expect(defaultHelpMarkdown({ isTerminal: false, claimed: false, claimedByMe: false }))
      .toMatch(/claim/i);
  });

  it('guides the claimer toward filling out the form', () => {
    expect(defaultHelpMarkdown({ isTerminal: false, claimed: true, claimedByMe: true }))
      .toMatch(/fill out the form/i);
  });

  it('explains a claim held by another user', () => {
    expect(defaultHelpMarkdown({ isTerminal: false, claimed: true, claimedByMe: false }))
      .toMatch(/another user/i);
  });

  it('describes terminal states', () => {
    expect(defaultHelpMarkdown({ isTerminal: true, status: 'resolved', claimed: false, claimedByMe: false }))
      .toMatch(/resolved/i);
    expect(defaultHelpMarkdown({ isTerminal: true, status: 'cancelled', claimed: false, claimedByMe: false }))
      .toMatch(/cancelled/i);
  });
});
