import { config as loadDotenv } from "dotenv";

const REQUIRED_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALLOWED_CHAT_ID",
  "LTMS_USERNAME",
  "LTMS_PASSWORD",
];

function toBoolean(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function toInteger(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer value: ${value}`);
  }

  return parsed;
}

export function loadConfig(env = process.env) {
  loadDotenv();

  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramAllowedChatId: String(env.TELEGRAM_ALLOWED_CHAT_ID),
    ltmsUsername: env.LTMS_USERNAME,
    ltmsPassword: env.LTMS_PASSWORD,
    nodeEnv: env.NODE_ENV || "production",
    headless: toBoolean(env.HEADLESS, true),
    playwrightTimeoutMs: toInteger(env.PLAYWRIGHT_TIMEOUT_MS, 30_000),
    ltmsPortalUrl: "https://portal.lto.gov.ph/",
  };
}
