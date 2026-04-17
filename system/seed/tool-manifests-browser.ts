// ── Browser automation tool manifests ────────────────────────────────────────

export const PLAYWRIGHT_TOOLS = [
  { name: 'navigate', description: 'Open a URL in a browser page. Returns a page_id handle for subsequent tool calls.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, wait_until: { type: 'string', description: 'load | domcontentloaded | networkidle' } }, required: ['url'] } },
  { name: 'screenshot', description: 'Capture a screenshot and save as PNG. Pass url for a self-contained navigate+screenshot, or page_id to screenshot an existing page.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, wait_until: { type: 'string' }, path: { type: 'string' }, page_id: { type: 'string' }, full_page: { type: 'boolean' }, selector: { type: 'string' } }, required: ['path'] } },
  { name: 'click', description: 'Click an element by CSS selector. Waits 500ms after click for SPA transitions.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, page_id: { type: 'string' } }, required: ['selector'] } },
  { name: 'fill', description: 'Type a value into an input field by CSS selector.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, value: { type: 'string' }, page_id: { type: 'string' } }, required: ['selector', 'value'] } },
  { name: 'wait_for', description: 'Wait for a CSS selector to appear on the page. For URL-based waiting, use run_script with wait_for_url action instead.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, page_id: { type: 'string' }, timeout: { type: 'number' } }, required: ['selector'] } },
  { name: 'evaluate', description: 'Evaluate JavaScript in the page context. Returns the expression result.', inputSchema: { type: 'object', properties: { script: { type: 'string' }, page_id: { type: 'string' } }, required: ['script'] } },
  {
    name: 'run_script',
    description: 'Execute a multi-step browser script in a single call. All steps share one page. Actions: navigate (go to URL), screenshot (save PNG), click (CSS selector), fill (input value), wait_for (CSS selector appears), wait_for_url (URL matches/not-matches pattern), wait (fixed delay in ms), evaluate (run JS). Use wait_for_url with not=true after login clicks to wait for SPA navigation.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: 'Ordered list of browser actions to execute sequentially on a single page',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['navigate', 'screenshot', 'click', 'fill', 'wait_for', 'wait_for_url', 'wait', 'evaluate'] },
              url: { type: 'string', description: 'URL for navigate, or URL pattern for wait_for_url' },
              wait_until: { type: 'string' },
              path: { type: 'string' },
              full_page: { type: 'boolean' },
              selector: { type: 'string' },
              value: { type: 'string' },
              script: { type: 'string' },
              timeout: { type: 'number', description: 'Timeout in ms for wait_for/wait_for_url, or delay for wait' },
              not: { type: 'boolean', description: 'For wait_for_url: wait until URL does NOT match (default: false)' },
            },
            required: ['action'],
          },
        },
      },
      required: ['steps'],
    },
  },
  { name: 'list_pages', description: 'List all open browser pages.', inputSchema: { type: 'object', properties: {} } },
  { name: 'close_page', description: 'Close a browser page by ID.', inputSchema: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] } },
];

export const PLAYWRIGHT_CLI_TOOLS = [
  {
    name: 'login_and_capture',
    description: 'Log into a website and capture a screenshot of the authenticated page. Handles navigation, credential entry, form submission, and post-login waiting in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Login page URL' },
        username_selector: { type: 'string', description: 'CSS selector for username input' },
        password_selector: { type: 'string', description: 'CSS selector for password input' },
        username: { type: 'string', description: 'Username value' },
        password: { type: 'string', description: 'Password value' },
        submit_selector: { type: 'string', description: 'CSS selector for submit button' },
        wait_after_login: { type: 'string', description: 'CSS selector or URL pattern to wait for after login' },
        screenshot_path: { type: 'string', description: 'Path for post-login screenshot' },
        full_page: { type: 'boolean' },
        timeout: { type: 'number', description: 'Max wait time in ms (default: 15000)' },
      },
      required: ['url', 'username_selector', 'password_selector', 'username', 'password', 'submit_selector'],
    },
  },
  {
    name: 'capture_page',
    description: 'Navigate to a URL, capture a screenshot, and save it to persistent file storage in one call. The returned `path` and `storage_ref` are the storage reference — no separate write_file call is needed. Optionally waits for a selector or fixed delay before capture. Pass page_id to reuse an existing authenticated session from login_and_capture.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        screenshot_path: { type: 'string', description: 'Storage path for the screenshot PNG (persisted to file storage). Auto-derived from URL if omitted. No separate write_file call needed.' },
        page_id: { type: 'string', description: 'Reuse an existing page to preserve session' },
        full_page: { type: 'boolean' },
        wait_for_selector: { type: 'string' },
        wait_ms: { type: 'number', description: 'Fixed delay in ms before capture (default: 2000)' },
        wait_until: { type: 'string' },
        timeout: { type: 'number' },
      },
      required: ['url'],
    },
  },
  {
    name: 'capture_authenticated_pages',
    description: 'Log in once, then navigate to multiple URLs capturing a screenshot of each. Reuses the authenticated session across all pages. Ideal for generating documentation screenshots.',
    inputSchema: {
      type: 'object',
      properties: {
        login: {
          type: 'object',
          description: 'Login parameters',
          properties: {
            url: { type: 'string', description: 'Login page URL' },
            username_selector: { type: 'string', description: 'CSS selector for username input' },
            password_selector: { type: 'string', description: 'CSS selector for password input' },
            username: { type: 'string' },
            password: { type: 'string' },
            submit_selector: { type: 'string', description: 'CSS selector for submit button' },
            wait_after_login: { type: 'string', description: 'CSS selector or URL pattern to wait for after login' },
            timeout: { type: 'number' },
          },
          required: ['url', 'username_selector', 'password_selector', 'username', 'password', 'submit_selector'],
        },
        pages: {
          type: 'array',
          description: 'Pages to capture after login',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to navigate to' },
              screenshot_path: { type: 'string', description: 'Path to save screenshot' },
              wait_for_selector: { type: 'string', description: 'Wait for this selector before capture' },
              wait_ms: { type: 'number', description: 'Fixed delay before capture (default: 3000)' },
              full_page: { type: 'boolean' },
            },
            required: ['url', 'screenshot_path'],
          },
        },
      },
      required: ['login', 'pages'],
    },
  },
  {
    name: 'extract_content',
    description: 'Extract structured content (text, links, metadata) from a page. Navigate to a URL or pass page_id to extract from an existing authenticated session. Returns page text by default, with optional link and meta tag extraction.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to. Omit to extract from existing page_id.' },
        page_id: { type: 'string', description: 'Reuse an existing page (from login_and_capture)' },
        selector: { type: 'string', description: 'CSS selector to extract text from' },
        script: { type: 'string', description: 'Custom JS to evaluate' },
        extract_links: { type: 'boolean' },
        extract_metadata: { type: 'boolean' },
        wait_for_selector: { type: 'string' },
        wait_ms: { type: 'number' },
      },
    },
  },
  {
    name: 'submit_form',
    description: 'Navigate to a form page, fill multiple fields, submit, and capture the result. Handles the full form lifecycle in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        fields: { type: 'array', description: 'Fields to fill', items: { type: 'object', properties: { selector: { type: 'string' }, value: { type: 'string' } }, required: ['selector', 'value'] } },
        submit_selector: { type: 'string' },
        wait_after_submit: { type: 'string', description: 'CSS selector or URL pattern to wait for' },
        screenshot_path: { type: 'string' },
        full_page: { type: 'boolean' },
        timeout: { type: 'number' },
      },
      required: ['url', 'fields', 'submit_selector'],
    },
  },
];
