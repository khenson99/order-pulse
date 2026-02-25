export interface Config {
  cognitoUserPoolId: string;
  cognitoClientId: string;
  awsRegion: string;
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

export function loadConfig(): Config {
  return {
    cognitoUserPoolId: requireEnv("COGNITO_USER_POOL_ID"),
    cognitoClientId: requireEnv("COGNITO_CLIENT_ID"),
    awsRegion: process.env.AWS_REGION ?? "us-east-1",
    port: parseInt(process.env.PORT ?? "3001", 10),
    logLevel: process.env.LOG_LEVEL ?? "info",
    nodeEnv: process.env.NODE_ENV ?? "development",
  };
}
