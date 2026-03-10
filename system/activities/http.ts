const DEFAULT_TIMEOUT = parseInt(process.env.LT_HTTP_FETCH_TIMEOUT_MS || '30000', 10);

export async function httpRequest(args: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout_ms?: number;
}): Promise<{ status: number; headers: Record<string, string>; body: string; elapsed_ms: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeout_ms || DEFAULT_TIMEOUT);

  try {
    const response = await fetch(args.url, {
      method: args.method || 'GET',
      headers: args.headers,
      body: args.body,
      signal: controller.signal,
    });

    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });

    return {
      status: response.status,
      headers,
      body,
      elapsed_ms: Date.now() - start,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson(args: {
  url: string;
  headers?: Record<string, string>;
}): Promise<{ data: any; status: number }> {
  const result = await httpRequest({
    url: args.url,
    method: 'GET',
    headers: { Accept: 'application/json', ...args.headers },
  });
  try {
    return { data: JSON.parse(result.body), status: result.status };
  } catch {
    return { data: result.body, status: result.status };
  }
}

export async function fetchText(args: {
  url: string;
  headers?: Record<string, string>;
}): Promise<{ text: string; status: number; content_type: string }> {
  const result = await httpRequest({
    url: args.url,
    method: 'GET',
    headers: args.headers,
  });
  return {
    text: result.body,
    status: result.status,
    content_type: result.headers['content-type'] || 'text/plain',
  };
}
