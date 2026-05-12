/**
 * Gmail API activities — called by the Gmail MCP server tools.
 * Each function takes a Google OAuth access token and calls the Gmail REST API.
 */

const GMAIL_BASE = 'https://www.googleapis.com/gmail/v1/users/me';

async function gmailFetch(path: string, token: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gmail API ${res.status}: ${body}`);
  }
  return res.json();
}

/** Decode base64url-encoded body part from Gmail API */
function decodeBody(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/** Extract header value from Gmail message headers */
function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/** Recursively extract text body from MIME parts */
function extractTextParts(payload: any): string[] {
  const parts: string[] = [];
  if (payload.body?.data) {
    if (payload.mimeType === 'text/plain' || payload.mimeType === 'text/html') {
      parts.push(decodeBody(payload.body.data));
    }
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      parts.push(...extractTextParts(part));
    }
  }
  return parts;
}

// ── Public activities ───────────────────────────────────────────────────────

export async function searchMessages(
  token: string,
  query: string,
  maxResults = 10,
): Promise<{
  messages: Array<{
    id: string;
    threadId: string;
    snippet: string;
    from: string;
    subject: string;
    date: string;
  }>;
  resultCount: number;
}> {
  const limit = Math.min(maxResults, 50);
  const listData = await gmailFetch(
    `/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`,
    token,
  );

  const messageIds: Array<{ id: string; threadId: string }> = listData.messages || [];
  if (messageIds.length === 0) {
    return { messages: [], resultCount: 0 };
  }

  // Fetch metadata for each message (headers + snippet)
  const messages = await Promise.all(
    messageIds.map(async ({ id, threadId }) => {
      const msg = await gmailFetch(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, token);
      const headers = msg.payload?.headers || [];
      return {
        id,
        threadId,
        snippet: msg.snippet || '',
        from: getHeader(headers, 'From'),
        subject: getHeader(headers, 'Subject'),
        date: getHeader(headers, 'Date'),
      };
    }),
  );

  return { messages, resultCount: listData.resultSizeEstimate || messages.length };
}

export async function readMessage(
  token: string,
  messageId: string,
): Promise<{
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  snippet: string;
  labels: string[];
}> {
  const msg = await gmailFetch(`/messages/${messageId}?format=full`, token);
  const headers = msg.payload?.headers || [];
  const textParts = extractTextParts(msg.payload || {});
  // Prefer plain text over HTML
  const plainParts = textParts.filter((_, i) => {
    const part = msg.payload?.parts?.[i];
    return !part || part.mimeType === 'text/plain';
  });
  const body = plainParts.length > 0 ? plainParts.join('\n') : textParts[0] || msg.snippet || '';

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    subject: getHeader(headers, 'Subject'),
    date: getHeader(headers, 'Date'),
    body,
    snippet: msg.snippet || '',
    labels: msg.labelIds || [],
  };
}

export async function getThread(
  token: string,
  threadId: string,
): Promise<{
  id: string;
  messageCount: number;
  messages: Array<{
    id: string;
    from: string;
    date: string;
    snippet: string;
    body: string;
  }>;
}> {
  const thread = await gmailFetch(`/threads/${threadId}?format=full`, token);
  const messages = (thread.messages || []).map((msg: any) => {
    const headers = msg.payload?.headers || [];
    const textParts = extractTextParts(msg.payload || {});
    return {
      id: msg.id,
      from: getHeader(headers, 'From'),
      date: getHeader(headers, 'Date'),
      snippet: msg.snippet || '',
      body: textParts[0] || msg.snippet || '',
    };
  });

  return {
    id: thread.id,
    messageCount: messages.length,
    messages,
  };
}

export async function createDraft(
  token: string,
  to: string,
  subject: string,
  body: string,
  threadId?: string,
): Promise<{ draftId: string; messageId: string }> {
  // Build RFC 2822 message
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ];
  const raw = Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const payload: any = { message: { raw } };
  if (threadId) payload.message.threadId = threadId;

  const draft = await gmailFetch('/drafts', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return {
    draftId: draft.id,
    messageId: draft.message?.id || '',
  };
}
