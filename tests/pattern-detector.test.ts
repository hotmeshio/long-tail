import { describe, it, expect } from 'vitest';
import { collapseIterationPatterns, detectPatterns } from '../services/yaml-workflow/pattern-detector';

const makeStep = (toolName: string, args: Record<string, unknown>, result?: unknown, serverId?: string) => ({
  kind: 'tool' as const,
  toolName,
  arguments: args,
  result: result ?? {},
  source: 'mcp',
  mcpServerId: serverId || 'some_server',
});

describe('pattern-detector (tool-agnostic)', () => {
  describe('collapseIterationPatterns', () => {
    it('should collapse 3+ consecutive calls to the same tool', () => {
      const steps = [
        makeStep('do_thing', { target: '/a', output: 'a.txt', timeout: 5000 }),
        makeStep('do_thing', { target: '/b', output: 'b.txt', timeout: 5000 }),
        makeStep('do_thing', { target: '/c', output: 'c.txt', timeout: 5000 }),
        makeStep('do_thing', { target: '/d', output: 'd.txt', timeout: 5000 }),
      ];

      const collapsed = collapseIterationPatterns(steps);
      expect(collapsed).toHaveLength(1);
      expect(collapsed[0].toolName).toBe('do_thing_batch');

      const iter = collapsed[0].arguments._iteration as any;
      expect(iter.tool).toBe('do_thing');
      expect(iter.count).toBe(4);
      expect(iter.items).toHaveLength(4);
      expect(iter.varyingKeys.sort()).toEqual(['output', 'target']);
      expect(iter.constantArgs.timeout).toBe(5000);
    });

    it('should separate varying from constant arguments', () => {
      const steps = [
        makeStep('process', { url: '/a', mode: 'fast', retries: 3 }),
        makeStep('process', { url: '/b', mode: 'fast', retries: 3 }),
        makeStep('process', { url: '/c', mode: 'fast', retries: 3 }),
      ];

      const collapsed = collapseIterationPatterns(steps);
      const iter = collapsed[0].arguments._iteration as any;

      expect(iter.varyingKeys).toEqual(['url']);
      expect(iter.constantArgs).toEqual({ mode: 'fast', retries: 3 });
      expect(iter.items[0]).toEqual({ url: '/a' });
      expect(iter.items[2]).toEqual({ url: '/c' });
    });

    it('should exclude wired keys (page_id, _handle) from items', () => {
      const steps = [
        makeStep('fetch', { url: '/a', page_id: 'p1', _handle: { type: 'x' } }),
        makeStep('fetch', { url: '/b', page_id: 'p1', _handle: { type: 'x' } }),
        makeStep('fetch', { url: '/c', page_id: 'p1', _handle: { type: 'x' } }),
      ];

      const collapsed = collapseIterationPatterns(steps);
      const iter = collapsed[0].arguments._iteration as any;

      expect(iter.varyingKeys).toEqual(['url']);
      for (const item of iter.items) {
        expect(item.page_id).toBeUndefined();
        expect(item._handle).toBeUndefined();
      }
    });

    it('should find array source from prior step result', () => {
      const steps = [
        makeStep('discover', {}, { items: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
        makeStep('process', { id: 1, config: 'x' }),
        makeStep('process', { id: 2, config: 'x' }),
        makeStep('process', { id: 3, config: 'x' }),
      ];

      const collapsed = collapseIterationPatterns(steps);
      expect(collapsed).toHaveLength(2);

      const iter = collapsed[1].arguments._iteration as any;
      expect(iter.arraySource).toBeTruthy();
      expect(iter.arraySource.stepIndex).toBe(0);
      expect(iter.arraySource.field).toBe('items');
    });

    it('should find array source nested inside prior step result', () => {
      const steps = [
        makeStep('discover', {}, {
          error: null,
          tool: 'capture_authenticated_pages',
          args: {
            login: { url: 'http://localhost', username: 'admin' },
            pages: [
              { url: '/page-a', screenshot_path: 'a.png' },
              { url: '/page-b', screenshot_path: 'b.png' },
              { url: '/page-c', screenshot_path: 'c.png' },
            ],
          },
        }),
        makeStep('process', { url: '/page-a', screenshot_path: 'a.png' }),
        makeStep('process', { url: '/page-b', screenshot_path: 'b.png' }),
        makeStep('process', { url: '/page-c', screenshot_path: 'c.png' }),
      ];

      const collapsed = collapseIterationPatterns(steps);
      expect(collapsed).toHaveLength(2);

      const iter = collapsed[1].arguments._iteration as any;
      expect(iter.arraySource).toBeTruthy();
      expect(iter.arraySource.stepIndex).toBe(0);
      // Should return the dot-path to the nested array
      expect(iter.arraySource.field).toBe('args.pages');
    });

    it('should NOT collapse 2 consecutive calls (requires 3+)', () => {
      const steps = [
        makeStep('fetch', { url: '/a' }),
        makeStep('fetch', { url: '/b' }),
      ];

      const collapsed = collapseIterationPatterns(steps);
      // 2 calls is below the minLength=3 threshold — should NOT collapse
      expect(collapsed).toHaveLength(2);
      expect(collapsed[0].toolName).toBe('fetch');
      expect(collapsed[1].toolName).toBe('fetch');
    });

    it('should collapse 3 consecutive calls to the same tool', () => {
      const steps = [
        makeStep('fetch', { url: '/a' }),
        makeStep('fetch', { url: '/b' }),
        makeStep('fetch', { url: '/c' }),
      ];

      const collapsed = collapseIterationPatterns(steps);
      expect(collapsed).toHaveLength(1);
      expect(collapsed[0].toolName).toBe('fetch_batch');

      const iter = collapsed[0].arguments._iteration as any;
      expect(iter.tool).toBe('fetch');
      expect(iter.count).toBe(3);
      expect(iter.varyingKeys).toEqual(['url']);
    });

    it('should NOT collapse a single call', () => {
      const steps = [
        makeStep('fetch', { url: '/a' }),
      ];

      const collapsed = collapseIterationPatterns(steps);
      expect(collapsed).toHaveLength(1);
      expect(collapsed[0].toolName).toBe('fetch');
    });

    it('should preserve steps before and after a run', () => {
      const steps = [
        makeStep('setup', { config: 'x' }),
        makeStep('work', { item: 'a' }),
        makeStep('work', { item: 'b' }),
        makeStep('work', { item: 'c' }),
        makeStep('cleanup', { done: true }),
      ];

      const collapsed = collapseIterationPatterns(steps);
      expect(collapsed).toHaveLength(3);
      expect(collapsed[0].toolName).toBe('setup');
      expect(collapsed[1].toolName).toBe('work_batch');
      expect(collapsed[2].toolName).toBe('cleanup');
    });

    it('should handle multiple separate runs', () => {
      const steps = [
        makeStep('fetch', { url: '/a' }),
        makeStep('fetch', { url: '/b' }),
        makeStep('fetch', { url: '/c' }),
        makeStep('transform', { data: 'x' }),
        makeStep('store', { key: '1' }),
        makeStep('store', { key: '2' }),
        makeStep('store', { key: '3' }),
      ];

      const collapsed = collapseIterationPatterns(steps);
      expect(collapsed).toHaveLength(3);
      expect(collapsed[0].toolName).toBe('fetch_batch');
      expect(collapsed[1].toolName).toBe('transform');
      expect(collapsed[2].toolName).toBe('store_batch');
    });
  });

  describe('detectPatterns', () => {
    it('should detect iteration pattern with array source', () => {
      const steps = [
        makeStep('discover', {}, { links: [{ href: '/a' }, { href: '/b' }, { href: '/c' }] }),
        makeStep('visit', { url: '/a', save: true }),
        makeStep('visit', { url: '/b', save: true }),
        makeStep('visit', { url: '/c', save: true }),
      ];

      const annotations = detectPatterns(steps);
      expect(annotations).toHaveLength(1);
      expect(annotations[0].type).toBe('iteration');
      expect(annotations[0].toolName).toBe('visit');
      expect(annotations[0].iterationCount).toBe(3);
      expect(annotations[0].varyingKeys).toEqual(['url']);
      expect(annotations[0].constantKeys).toEqual(['save']);
      expect(annotations[0].arraySource).toEqual({ stepIndex: 0, fieldName: 'links' });
    });

    it('should return empty for non-iterating sequences', () => {
      const steps = [
        makeStep('a', { x: 1 }),
        makeStep('b', { y: 2 }),
        makeStep('c', { z: 3 }),
      ];

      expect(detectPatterns(steps)).toHaveLength(0);
    });
  });
});
