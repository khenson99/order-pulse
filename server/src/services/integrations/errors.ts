export class IntegrationAuthError extends Error {
  public readonly retryable: boolean;
  public readonly code: string;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'IntegrationAuthError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new IntegrationAuthError('INTEGRATION_ENV_MISSING', `${name} is not configured`);
  }
  return value;
}

export async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function asDateFromExpiresIn(expiresInSeconds?: number): Date {
  const expires = Number(expiresInSeconds || 3600);
  return new Date(Date.now() + Math.max(60, expires) * 1000);
}
