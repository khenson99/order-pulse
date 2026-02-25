import { loadConfig } from "./config";
import { createLogger } from "./lib/logger";
import { createCognitoVerifiers } from "./middleware/auth";
import { createApp } from "./app";

const config = loadConfig();
const logger = createLogger(config.logLevel);

const { accessTokenVerifier, idTokenVerifier } = createCognitoVerifiers(
  config.cognitoUserPoolId,
  config.cognitoClientId,
);

const app = createApp({
  auth: { accessTokenVerifier, idTokenVerifier, logger },
  logger,
});

app.listen(config.port, () => {
  logger.info(
    { port: config.port, env: config.nodeEnv },
    "Onboarding API started",
  );
});
