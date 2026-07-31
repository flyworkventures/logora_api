const dotenv = require('dotenv');

dotenv.config();

const required = (value, name) => {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || '',
  dbHost: process.env.DB_HOST || '',
  dbPort: Number(process.env.DB_PORT || 3306),
  dbUser: process.env.DB_USER || '',
  dbPassword: process.env.DB_PASSWORD || '',
  dbName: process.env.DB_NAME || '',
  jwtSecret: required(process.env.JWT_SECRET, 'JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  logoServiceUrl: process.env.LOGO_SERVICE_URL || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
  openAiApiKey: process.env.OPENAI_API_KEY || '',
  openAiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openAiImageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
  logoGenerateTimeoutMs: Number(process.env.LOGO_GENERATE_TIMEOUT_MS || 300000),
  serverRequestTimeoutMs: Number(process.env.SERVER_REQUEST_TIMEOUT_MS || 300000),
  serverHeadersTimeoutMs: Number(process.env.SERVER_HEADERS_TIMEOUT_MS || 305000),
  serverKeepAliveTimeoutMs: Number(process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS || 65000),
  revenueCatTokenMap:
    process.env.REVENUECAT_TOKEN_MAP ||
    'logora_tokens_50:50,logora_tokens_100:100,logora_tokens_200:200',
  revenueCatWebhookAuth: process.env.REVENUECAT_WEBHOOK_AUTH || '',
  revenueCatEntitlementId: process.env.REVENUECAT_ENTITLEMENT_ID || '',
  revenueCatSecretApiKey: process.env.REVENUECAT_SECRET_API_KEY || '',
};

const hasDbUrl = env.databaseUrl.trim().length > 0;
const hasDbSessionFields =
  env.dbHost.trim().length > 0 &&
  env.dbUser.trim().length > 0 &&
  env.dbName.trim().length > 0;

if (!hasDbUrl && !hasDbSessionFields) {
  throw new Error(
    'Missing database configuration. Set DATABASE_URL or DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME.',
  );
}

module.exports = { env };
