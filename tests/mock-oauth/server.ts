import express from 'express';
import * as crypto from 'crypto';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = parseInt(process.env.PORT || '9080', 10);

// Parse mock users from env: "email:name:id,email:name:id"
const MOCK_USERS = (process.env.MOCK_USERS || 'alice@test.local:Alice Test:test-user-1')
  .split(',')
  .map((u) => {
    const [email, name, id] = u.split(':');
    return { email, name, id: id || email };
  });

// In-memory code → user mapping (authorization codes)
const codes = new Map<string, { userId: string; redirectUri: string }>();
// In-memory access tokens
const tokens = new Map<string, string>(); // token → userId

/**
 * GET /authorize — OAuth2 authorization endpoint.
 * Immediately redirects with a code (no consent UI — it's a test server).
 */
app.get('/authorize', (req, res) => {
  const { redirect_uri, state } = req.query;
  if (!redirect_uri || !state) {
    res.status(400).json({ error: 'redirect_uri and state required' });
    return;
  }

  // Always authorize as the first mock user
  const code = crypto.randomBytes(16).toString('hex');
  codes.set(code, { userId: MOCK_USERS[0].id, redirectUri: redirect_uri as string });

  // Redirect back with code and state
  const url = new URL(redirect_uri as string);
  url.searchParams.set('code', code);
  url.searchParams.set('state', state as string);
  res.redirect(url.toString());
});

/**
 * POST /token — OAuth2 token endpoint.
 * Exchanges authorization code for access + refresh tokens.
 */
app.post('/token', (req, res) => {
  const { code, grant_type, refresh_token } = req.body;

  if (grant_type === 'refresh_token') {
    // Refresh: issue new access token for the same user
    const userId = refresh_token ? MOCK_USERS[0].id : null;
    if (!userId) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    const accessToken = `mock_at_${crypto.randomBytes(16).toString('hex')}`;
    const newRefreshToken = `mock_rt_${crypto.randomBytes(16).toString('hex')}`;
    tokens.set(accessToken, userId);
    res.json({
      access_token: accessToken,
      refresh_token: newRefreshToken,
      token_type: 'bearer',
      expires_in: 3600,
    });
    return;
  }

  // Authorization code exchange
  const entry = codes.get(code);
  if (!entry) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown code' });
    return;
  }
  codes.delete(code);

  const accessToken = `mock_at_${crypto.randomBytes(16).toString('hex')}`;
  const refreshToken = `mock_rt_${crypto.randomBytes(16).toString('hex')}`;
  tokens.set(accessToken, entry.userId);

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: 3600,
  });
});

/**
 * GET /userinfo — Returns the mock user profile for the given access token.
 */
app.get('/userinfo', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const accessToken = auth.slice(7);
  const userId = tokens.get(accessToken);
  if (!userId) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  const user = MOCK_USERS.find((u) => u.id === userId) || MOCK_USERS[0];
  res.json({
    sub: user.id,
    id: user.id,
    email: user.email,
    name: user.name,
    email_verified: true,
  });
});

/**
 * GET /health — Simple health check.
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', users: MOCK_USERS.length });
});

app.listen(PORT, () => {
  console.log(`[mock-oauth] listening on :${PORT} with ${MOCK_USERS.length} user(s)`);
});
