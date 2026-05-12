export const GMAIL_TOOLS = [
  {
    name: 'gmail_search',
    description: 'Search Gmail inbox for messages matching a query. Returns message IDs and snippets. Uses Gmail search syntax (e.g., "from:user@example.com", "subject:invoice", "after:2024/01/01").',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query (same syntax as the Gmail search bar)' },
        maxResults: { type: 'number', description: 'Maximum messages to return (default: 10, max: 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_read',
    description: 'Read the full content of a Gmail message by ID. Returns headers (from, to, subject, date) and decoded body text.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'Gmail message ID (from gmail_search results)' },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'gmail_summarize',
    description: 'Fetch all messages in a Gmail thread and produce a structured summary. Returns thread metadata and a concatenated view of all messages for LLM summarization.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Gmail thread ID (from gmail_search results)' },
      },
      required: ['threadId'],
    },
  },
  {
    name: 'gmail_extract',
    description: 'Read a Gmail message and extract structured data. Returns the raw message content along with parsed headers, suitable for downstream extraction by an LLM.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'Gmail message ID' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific fields to extract (e.g., ["account_number", "amount", "due_date"]). If omitted, returns all content for free-form extraction.',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'gmail_draft',
    description: 'Create a draft email in Gmail. The draft appears in the Drafts folder and can be reviewed before sending.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body (plain text)' },
        threadId: { type: 'string', description: 'Thread ID to reply to (optional — creates a reply draft if provided)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
];
