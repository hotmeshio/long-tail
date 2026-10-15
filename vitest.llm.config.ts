import { defineConfig } from 'vitest/config';

import base from './vitest.config';

// LLM tests call a real model and spend provider credits.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/**/*.llm.test.ts'],
    exclude: ['node_modules', 'build'],
  },
});
