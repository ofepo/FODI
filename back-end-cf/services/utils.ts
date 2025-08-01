import {
  AccessTokenResponse,
  BatchReqPayload,
  BatchRespData,
  OAUTH,
  FODI_CACHE,
} from '../types/apiType';

export async function fetchAccessToken(
  envOauth: Env['OAUTH'],
  envFodi?: Env['FODI_CACHE'],
): Promise<string> {
  let refreshToken = envOauth.refreshToken;
  if (envFodi !== undefined) {
    const tokenData = await envFodi.get('token_data');
    const cache = tokenData ? JSON.parse(tokenData) : null;
    if (cache?.refresh_token) {
      const passedMilis = Date.now() - cache.save_time;
      if (passedMilis / 1000 < cache.expires_in - 600) {
        return cache.access_token;
      }

      if (passedMilis < 6912000000) {
        refreshToken = cache.refresh_token;
      }
    }
  }

  const url = envOauth['oauthUrl'] + 'token';
  const data = {
    client_id: envOauth['clientId'],
    client_secret: envOauth['clientSecret'],
    grant_type: 'refresh_token',
    requested_token_use: 'on_behalf_of',
    refresh_token: refreshToken,
  };
  const result = await postFormData<AccessTokenResponse>(url, data);

  if (envFodi !== undefined && result?.refresh_token) {
    result.save_time = Date.now();
    await envFodi.put('token_data', JSON.stringify(result));
  }
  return result.access_token;
}

export async function fetchWithAuth(uri: string, options: RequestInit = {}) {
  const accessToken = await fetchAccessToken(OAUTH, FODI_CACHE);
  return fetch(uri, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...((options.headers as Record<string, string>) || {}),
    },
  });
}

export async function fetchBatchRes(batch: BatchReqPayload): Promise<BatchRespData> {
  const batchResponse = await fetchWithAuth(`${OAUTH.apiHost}/v1.0/$batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
  });
  return batchResponse.json();
}

export async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function postFormData<T>(url: string, data: Record<string, string>): Promise<T> {
  const formData = new FormData();
  for (const key in data) {
    formData.append(key, data[key]);
  }
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });
  const result = await response.json();
  return result as T;
}

export async function fetchSaveSkipToken(path: string, tokensToSave?: string[]): Promise<string[]> {
  path = path.toLocaleLowerCase();
  const skipTokenString = await FODI_CACHE.get('skip_token');
  const skipTokenData = skipTokenString ? JSON.parse(skipTokenString) : {};
  const currentTokens = skipTokenData[path]?.split(',') || [];

  const tokenChanged = tokensToSave && currentTokens.join(',') !== tokensToSave.join(',');
  if (tokenChanged) {
    skipTokenData[path] = tokensToSave.join(',');
    await FODI_CACHE.put('skip_token', JSON.stringify(skipTokenData));
  }

  return currentTokens;
}
