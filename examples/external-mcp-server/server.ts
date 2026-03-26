/**
 * Example External MCP Server
 *
 * Demonstrates how an external MCP server authenticates to Long Tail,
 * receives delegation tokens via tool args, and fetches user-scoped
 * OAuth credentials through the delegation API.
 *
 * This server exposes an SSE-based MCP interface with one tool:
 *   fetch_external_data — simulates fetching data from an external API
 *                         using the user's OAuth credentials.
 *
 * Environment:
 *   LT_API_URL        — Long Tail API base URL (e.g., http://long-tail:3000)
 *   LT_SERVICE_TOKEN  — Service token for authenticating back to Long Tail
 *   PORT              — Port to listen on (default: 9090)
 */

import express from 'express';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '9090', 10);
const LT_API_URL = process.env.LT_API_URL || 'http://localhost:3000';
const LT_SERVICE_TOKEN = process.env.LT_SERVICE_TOKEN || '';

/**
 * Validate a delegation token against Long Tail.
 */
async function validateDelegation(token: string): Promise<{
  valid: boolean;
  userId?: string;
  scopes?: string[];
  error?: string;
}> {
  const res = await fetch(`${LT_API_URL}/api/delegation/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LT_SERVICE_TOKEN}`,
    },
    body: JSON.stringify({ token }),
  });
  return res.json();
}

/**
 * Get a user's OAuth access token via the delegation API.
 */
async function getUserOAuthToken(
  delegationToken: string,
  provider: string,
): Promise<{ access_token: string; expires_at: string | null }> {
  const res = await fetch(`${LT_API_URL}/api/delegation/oauth/${provider}/token`, {
    headers: { Authorization: `Bearer ${delegationToken}` },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `Failed to get OAuth token: ${res.status}`);
  }
  return res.json();
}

// ── MCP Tool: fetch_external_data ────────────────────────────────────────────

/**
 * Simulates an external MCP tool that needs user-scoped credentials.
 *
 * In a real server, this would:
 * 1. Extract the delegation token from _auth.token
 * 2. Call the delegation API to get a fresh OAuth access token
 * 3. Use that token to call an external API (Google Calendar, GitHub, etc.)
 * 4. Return the results
 */
app.post('/tools/fetch_external_data', async (req, res) => {
  const { provider, query, _auth } = req.body;

  if (!_auth?.token) {
    res.status(400).json({
      error: 'No delegation token provided. This tool requires user authorization.',
    });
    return;
  }

  try {
    // 1. Validate the delegation token
    const validation = await validateDelegation(_auth.token);
    if (!validation.valid) {
      res.status(403).json({ error: `Invalid delegation: ${validation.error}` });
      return;
    }

    // 2. Get the user's OAuth token for the requested provider
    const oauth = await getUserOAuthToken(_auth.token, provider || 'google');

    // 3. Simulate calling an external API with the OAuth token
    // In production, this would be a real API call like:
    //   const data = await fetch('https://api.example.com/data', {
    //     headers: { Authorization: `Bearer ${oauth.access_token}` }
    //   });
    res.json({
      success: true,
      userId: validation.userId,
      provider: provider || 'google',
      query,
      result: {
        message: `Successfully fetched data for user ${validation.userId} using ${provider || 'google'} OAuth token`,
        token_preview: `${oauth.access_token.slice(0, 10)}...`,
        expires_at: oauth.expires_at,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'external-mcp-server',
    lt_api: LT_API_URL,
    has_service_token: !!LT_SERVICE_TOKEN,
  });
});

app.listen(PORT, () => {
  console.log(`[external-mcp] listening on :${PORT}`);
  console.log(`[external-mcp] Long Tail API: ${LT_API_URL}`);
  console.log(`[external-mcp] Service token: ${LT_SERVICE_TOKEN ? 'configured' : 'NOT SET'}`);
});
