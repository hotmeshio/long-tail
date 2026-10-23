import { describe, it, expect } from 'vitest';

import { authorizationResponseUri, withQuery } from '../../../../services/auth/oauth-server/authorization';

const ISSUER = 'https://api.example.com/longtail';
const params = (uri: string) => Object.fromEntries(new URL(uri).searchParams);

describe('withQuery', () => {
  it('adds params, keeps the existing query, and skips undefined values', () => {
    expect(params(withQuery('https://client.example/cb?x=1', { code: 'c', state: undefined }))).toEqual({ x: '1', code: 'c' });
  });
});

describe('authorizationResponseUri', () => {
  it('carries iss beside the response params', () => {
    expect(params(authorizationResponseUri('https://client.example/cb', ISSUER, { code: 'c', state: 's' })))
      .toEqual({ code: 'c', state: 's', iss: ISSUER });
  });

  it('carries iss on an error response, keeping the redirect URI and its query', () => {
    const uri = new URL(authorizationResponseUri('http://127.0.0.1:9000/cb?session=7', ISSUER, { error: 'access_denied', state: undefined }));
    expect(`${uri.origin}${uri.pathname}`).toBe('http://127.0.0.1:9000/cb');
    expect(Object.fromEntries(uri.searchParams)).toEqual({ session: '7', error: 'access_denied', iss: ISSUER });
  });

  it('iss is always the issuer, whatever the params name', () => {
    expect(params(authorizationResponseUri('https://client.example/cb?iss=other', ISSUER, { iss: 'spoof' })).iss).toBe(ISSUER);
  });
});
