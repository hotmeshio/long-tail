import { describe, it, expect } from 'vitest';
import {
  RESOLVER_TEMPLATES,
  INVOCATION_TEMPLATES,
  getResolverTemplate,
  getInvocationTemplate,
} from '../templates';

describe('RESOLVER_TEMPLATES', () => {
  it('has templates for known workflow types', () => {
    expect(RESOLVER_TEMPLATES).toHaveProperty('reviewContent');
    expect(RESOLVER_TEMPLATES).toHaveProperty('verifyDocument');
    expect(RESOLVER_TEMPLATES).toHaveProperty('verifyDocumentMcp');
  });
});

describe('INVOCATION_TEMPLATES', () => {
  it('has templates for known orchestrator types', () => {
    expect(INVOCATION_TEMPLATES).toHaveProperty('reviewContentOrchestrator');
    expect(INVOCATION_TEMPLATES).toHaveProperty('verifyDocumentOrchestrator');
    expect(INVOCATION_TEMPLATES).toHaveProperty('verifyDocumentMcpOrchestrator');
  });
});

describe('getResolverTemplate', () => {
  it('returns template JSON for known type', () => {
    const result = getResolverTemplate('reviewContent');
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('approved');
  });

  it('returns empty object JSON for unknown type', () => {
    expect(getResolverTemplate('unknown')).toBe('{}');
  });

  it('returns empty object JSON for null', () => {
    expect(getResolverTemplate(null)).toBe('{}');
  });
});

describe('getInvocationTemplate', () => {
  it('returns template JSON for known type', () => {
    const result = getInvocationTemplate('reviewContentOrchestrator');
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('data');
    expect(parsed).toHaveProperty('metadata');
  });

  it('returns default empty JSON for unknown type', () => {
    expect(getInvocationTemplate('unknown')).toBe('{\n  \n}');
  });
});
