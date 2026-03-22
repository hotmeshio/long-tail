import { describe, it, expect } from 'vitest';
import {
  classifyArgument,
  extractSemanticInputs,
  buildEnrichedInputSchema,
} from '../services/yaml-workflow/input-analyzer';

describe('input-analyzer', () => {
  // ── classifyArgument ─────────────────────────────────────────

  describe('classifyArgument', () => {
    it('should classify URL fields as dynamic', () => {
      expect(classifyArgument('url', 'http://localhost:3000')).toBe('dynamic');
      expect(classifyArgument('base_url', 'http://example.com')).toBe('dynamic');
      expect(classifyArgument('target_url', 'http://example.com')).toBe('dynamic');
    });

    it('should classify credential fields as dynamic', () => {
      expect(classifyArgument('username', 'admin')).toBe('dynamic');
      expect(classifyArgument('password', 'secret')).toBe('dynamic');
    });

    it('should classify path fields as dynamic', () => {
      expect(classifyArgument('screenshot_path', '/screenshots/home.png')).toBe('dynamic');
      expect(classifyArgument('directory', 'knowledge/sites')).toBe('dynamic');
      expect(classifyArgument('path', '/output/file.txt')).toBe('dynamic');
    });

    it('should classify selector fields as fixed', () => {
      expect(classifyArgument('selector', '#username')).toBe('fixed');
      expect(classifyArgument('submit_selector', 'button[type=submit]')).toBe('fixed');
      expect(classifyArgument('username_selector', '#user')).toBe('fixed');
      expect(classifyArgument('password_selector', '#pass')).toBe('fixed');
    });

    it('should classify timing fields as fixed', () => {
      expect(classifyArgument('timeout', 5000)).toBe('fixed');
      expect(classifyArgument('wait_ms', 3000)).toBe('fixed');
      expect(classifyArgument('wait_until', 'load')).toBe('fixed');
    });

    it('should classify boolean options as fixed', () => {
      expect(classifyArgument('full_page', true)).toBe('fixed');
      expect(classifyArgument('extract_links', true)).toBe('fixed');
      expect(classifyArgument('extract_metadata', false)).toBe('fixed');
    });

    it('should classify inter-step data as wired', () => {
      expect(classifyArgument('page_id', 'page_1')).toBe('wired');
      expect(classifyArgument('_handle', { type: 'playwright_page' })).toBe('wired');
      expect(classifyArgument('content', 'page text...')).toBe('wired');
      expect(classifyArgument('links', [])).toBe('wired');
    });

    it('should use suffix heuristics for unknown keys', () => {
      expect(classifyArgument('custom_url', 'http://x.com')).toBe('dynamic');
      expect(classifyArgument('output_path', '/out')).toBe('dynamic');
      expect(classifyArgument('nav_selector', 'nav a')).toBe('fixed');
      expect(classifyArgument('session_id', 'abc')).toBe('wired');
    });

    it('should default unknown keys to fixed', () => {
      expect(classifyArgument('unknown_field', 'value')).toBe('fixed');
    });

    it('should classify objects containing dynamic keys as dynamic', () => {
      expect(classifyArgument('login', { url: 'http://localhost:3000', username: 'admin', password: 'secret' })).toBe('dynamic');
      expect(classifyArgument('config', { target_url: 'http://example.com', retries: 3 })).toBe('dynamic');
    });

    it('should keep objects without dynamic keys as fixed', () => {
      expect(classifyArgument('options', { timeout: 5000, retries: 3 })).toBe('fixed');
    });

    it('should classify large arrays as dynamic (execution-specific data)', () => {
      const bigArray = Array.from({ length: 10 }, (_, i) => ({ url: `/page-${i}` }));
      expect(classifyArgument('pages', bigArray)).toBe('dynamic');
    });

    it('should keep small arrays as fixed', () => {
      expect(classifyArgument('formats', ['json', 'csv'])).toBe('fixed');
    });
  });

  // ── extractSemanticInputs ────────────────────────────────────

  describe('extractSemanticInputs', () => {
    const steps = [
      {
        kind: 'tool' as const,
        toolName: 'list_files',
        arguments: { directory: 'knowledge/sites' },
      },
      {
        kind: 'tool' as const,
        toolName: 'login_and_capture',
        arguments: {
          url: 'http://localhost:3000/login',
          username: 'admin',
          password: 'secret',
          submit_selector: 'button[type=submit]',
          page_id: 'page_1',
        },
      },
      {
        kind: 'tool' as const,
        toolName: 'capture_page',
        arguments: {
          url: 'http://localhost:3000/dashboard',
          screenshot_path: '/screenshots/dash.png',
          full_page: true,
          page_id: 'page_1',
        },
      },
    ];

    it('should extract dynamic and fixed fields, skip wired', () => {
      const result = extractSemanticInputs(steps, '');
      const keys = result.map(f => f.key);

      // Dynamic fields present
      expect(keys).toContain('directory');
      expect(keys).toContain('url');
      expect(keys).toContain('username');
      expect(keys).toContain('password');
      expect(keys).toContain('screenshot_path');

      // Fixed fields present
      expect(keys).toContain('submit_selector');
      expect(keys).toContain('full_page');

      // Wired fields excluded
      expect(keys).not.toContain('page_id');
      expect(keys).not.toContain('_handle');
    });

    it('should deduplicate by key (first occurrence wins)', () => {
      const result = extractSemanticInputs(steps, '');
      const urlFields = result.filter(f => f.key === 'url');
      expect(urlFields).toHaveLength(1);
      // First occurrence is from login_and_capture (step index 1)
      expect(urlFields[0].source_tool).toBe('login_and_capture');
    });

    it('should classify fields correctly', () => {
      const result = extractSemanticInputs(steps, '');
      const byKey = Object.fromEntries(result.map(f => [f.key, f]));

      expect(byKey.url.classification).toBe('dynamic');
      expect(byKey.username.classification).toBe('dynamic');
      expect(byKey.submit_selector.classification).toBe('fixed');
      expect(byKey.full_page.classification).toBe('fixed');
    });

    it('should set defaults only for fixed fields', () => {
      const result = extractSemanticInputs(steps, '');
      const byKey = Object.fromEntries(result.map(f => [f.key, f]));

      expect(byKey.url.default).toBeUndefined();
      expect(byKey.submit_selector.default).toBe('button[type=submit]');
      expect(byKey.full_page.default).toBe(true);
    });

    it('should enhance descriptions from original prompt', () => {
      const result = extractSemanticInputs(steps, 'login to http://localhost:3000/login and take screenshots');
      const urlField = result.find(f => f.key === 'url');
      expect(urlField?.description).toContain('from prompt');
    });

    it('should skip LLM steps', () => {
      const withLlm = [
        ...steps,
        { kind: 'llm' as const, toolName: 'interpret', arguments: { prompt: 'analyze' } },
      ];
      const result = extractSemanticInputs(withLlm, '');
      expect(result.find(f => f.key === 'prompt' && f.source_tool === 'interpret')).toBeUndefined();
    });

    it('should flatten nested objects containing dynamic keys', () => {
      const stepsWithNested = [
        {
          kind: 'tool' as const,
          toolName: 'capture_authenticated_pages',
          arguments: {
            login: {
              url: 'http://localhost:3000/login',
              username: 'superadmin',
              password: 'l0ngt@1l',
              submit_selector: 'button[type=submit]',
            },
            pages: [
              { url: '/dashboard', screenshot_path: 'dash.png' },
              { url: '/settings', screenshot_path: 'settings.png' },
            ],
          },
        },
      ];

      const result = extractSemanticInputs(stepsWithNested, '');
      const keys = result.map(f => f.key);

      // The login object should be flattened into individual fields
      expect(keys).toContain('url');
      expect(keys).toContain('username');
      expect(keys).toContain('password');
      expect(keys).toContain('submit_selector');

      // The parent key 'login' should NOT appear as-is
      expect(keys).not.toContain('login');

      // Dynamic fields from nested object
      const urlField = result.find(f => f.key === 'url');
      expect(urlField?.classification).toBe('dynamic');

      // Fixed fields from nested object
      const selectorField = result.find(f => f.key === 'submit_selector');
      expect(selectorField?.classification).toBe('fixed');
    });

    it('should not embed large arrays as defaults', () => {
      const stepsWithLargeArray = [
        {
          kind: 'tool' as const,
          toolName: 'batch_process',
          arguments: {
            items: Array.from({ length: 18 }, (_, i) => ({ url: `/page-${i}` })),
            timeout: 5000,
          },
        },
      ];

      const result = extractSemanticInputs(stepsWithLargeArray, '');
      const itemsField = result.find(f => f.key === 'items');

      // Large arrays should be classified as dynamic (no default)
      expect(itemsField?.classification).toBe('dynamic');
      expect(itemsField?.default).toBeUndefined();
    });

    it('should handle key collisions when flattening nested objects', () => {
      const stepsWithCollision = [
        {
          kind: 'tool' as const,
          toolName: 'navigate',
          arguments: { url: 'http://example.com' },
        },
        {
          kind: 'tool' as const,
          toolName: 'login',
          arguments: {
            login: {
              url: 'http://example.com/login',
              username: 'admin',
              password: 'secret',
            },
          },
        },
      ];

      const result = extractSemanticInputs(stepsWithCollision, '');
      const keys = result.map(f => f.key);

      // 'url' already exists from step 0, so login's url should be prefixed
      expect(keys).toContain('url');
      expect(keys).toContain('login_url');
      expect(keys).toContain('username');
      expect(keys).toContain('password');
    });
  });

  // ── buildEnrichedInputSchema ─────────────────────────────────

  describe('buildEnrichedInputSchema', () => {
    it('should return empty schema for no fields', () => {
      const schema = buildEnrichedInputSchema([]);
      expect(schema).toEqual({ type: 'object' });
    });

    it('should make dynamic fields required with no defaults', () => {
      const schema = buildEnrichedInputSchema([
        { key: 'url', type: 'string', description: 'URL', classification: 'dynamic', source_step_index: 0, source_tool: 'navigate' },
      ]) as any;

      expect(schema.required).toContain('url');
      expect(schema.properties.url.default).toBeUndefined();
    });

    it('should make fixed fields optional with defaults', () => {
      const schema = buildEnrichedInputSchema([
        { key: 'timeout', type: 'number', default: 5000, description: 'Timeout', classification: 'fixed', source_step_index: 0, source_tool: 'wait_for' },
      ]) as any;

      expect(schema.required).toBeUndefined();
      expect(schema.properties.timeout.default).toBe(5000);
    });

    it('should produce a complete schema with both types', () => {
      const schema = buildEnrichedInputSchema([
        { key: 'url', type: 'string', description: 'URL', classification: 'dynamic', source_step_index: 0, source_tool: 'navigate' },
        { key: 'username', type: 'string', description: 'Username', classification: 'dynamic', source_step_index: 0, source_tool: 'login' },
        { key: 'timeout', type: 'number', default: 5000, description: 'Timeout', classification: 'fixed', source_step_index: 1, source_tool: 'wait' },
      ]) as any;

      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['url', 'username']);
      expect(Object.keys(schema.properties)).toHaveLength(3);
      expect(schema.properties.timeout.default).toBe(5000);
      expect(schema.properties.url.description).toBe('URL');
    });
  });
});
