export interface Config {
  cognitoUserPoolId: string;
  cognitoClientId: string;
  awsRegion: string;
  redisUrl: string;
  onboardingApiOrigin: string;
  onboardingFrontendOrigin: string;
  onboardingTokenEncryptionKey: Buffer | null;
  googleClientId: string | null;
  googleClientSecret: string | null;
  port: number;
  logLevel: string;
  nodeEnv: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  // Let URL constructor validate. This throws if invalid.
  // eslint-disable-next-line no-new
  new URL(trimmed);
  return trimmed;
}

function decodeEncryptionKeyBase64(value: string): Buffer {
  const buf = Buffer.from(value, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "Invalid ONBOARDING_TOKEN_ENCRYPTION_KEY_BASE64 (must be 32 bytes base64)",
    );
  }
  return buf;
}

export function loadConfig(): Config {
  const encryptionKeyBase64 = optionalEnv("ONBOARDING_TOKEN_ENCRYPTION_KEY_BASE64");

  return {
    cognitoUserPoolId: requireEnv("COGNITO_USER_POOL_ID"),
    cognitoClientId: requireEnv("COGNITO_CLIENT_ID"),
    awsRegion: process.env.AWS_REGION ?? "us-east-1",
    redisUrl: requireEnv("REDIS_URL"),
    onboardingApiOrigin: normalizeOrigin(requireEnv("ONBOARDING_API_ORIGIN")),
    onboardingFrontendOrigin: normalizeOrigin(requireEnv("ONBOARDING_FRONTEND_ORIGIN")),
    onboardingTokenEncryptionKey: encryptionKeyBase64
      ? decodeEncryptionKeyBase64(encryptionKeyBase64)
      : null,
    googleClientId: optionalEnv("GOOGLE_CLIENT_ID"),
    googleClientSecret: optionalEnv("GOOGLE_CLIENT_SECRET"),
    port: parseInt(process.env.PORT ?? "3001", 10),
    logLevel: process.env.LOG_LEVEL ?? "info",
    nodeEnv: process.env.NODE_ENV ?? "development",
  };
}
