import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

const baseEnv = {
  TELEGRAM_BOT_TOKEN: "token",
  TELEGRAM_ALLOWED_CHAT_ID: "123",
  LTMS_USERNAME: "user",
  LTMS_PASSWORD: "pass",
};

test("loadConfig returns normalized config", () => {
  const config = loadConfig({
    ...baseEnv,
    HEADLESS: "false",
    PERSISTENT_SESSION: "false",
    PLAYWRIGHT_TIMEOUT_MS: "45000",
  });

  assert.equal(config.headless, false);
  assert.equal(config.persistentSession, false);
  assert.equal(config.playwrightTimeoutMs, 45_000);
  assert.equal(config.telegramAllowedChatId, "123");
});

test("loadConfig throws when env is incomplete", () => {
  assert.throws(() => loadConfig({ ...baseEnv, LTMS_PASSWORD: "" }), /Missing required environment variables/);
});
