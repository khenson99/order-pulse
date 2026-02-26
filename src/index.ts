import { createClient } from "redis";
import { loadConfig } from "./config";
import { createLogger } from "./lib/logger";
import { createCognitoVerifiers } from "./middleware/auth";
import { createApp } from "./app";
import { OnboardingSessionStore } from "./lib/onboarding-session-store";
import { S3Client } from "@aws-sdk/client-s3";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const redis = createClient({ url: config.redisUrl });
  redis.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, "Redis client error");
  });

  await redis.connect();
  logger.info({ redisUrl: config.redisUrl }, "Redis connected");

  const sessionStore = new OnboardingSessionStore(redis as any, {
    ttlSeconds: config.onboardingSessionTtlSeconds,
    frontendOrigin: config.onboardingFrontendOrigin,
  });

  const s3 = new S3Client({ region: config.awsRegion });

  const { accessTokenVerifier, idTokenVerifier } = createCognitoVerifiers(
    config.cognitoUserPoolId,
    config.cognitoClientId,
  );

  const app = createApp({
    auth: { accessTokenVerifier, idTokenVerifier, logger },
    logger,
    config,
    kv: redis as any,
    sessionStore,
    s3,
  });

  app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv },
      "Onboarding API started",
    );
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start onboarding-api:", err);
  process.exit(1);
});
