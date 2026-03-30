import { Telegraf } from "telegraf";
import { loadConfig } from "./config.js";
import { LtmsClient } from "./ltms.js";
import { SessionManager } from "./session.js";

function isAuthorizedChat(ctx, allowedChatId) {
  return String(ctx.chat?.id ?? "") === String(allowedChatId);
}

function replyUnauthorized(ctx) {
  return ctx.reply("Unauthorized chat.");
}

function formatViolationsReport(violations) {
  const header = violations.anyContent
    ? "LTMS login succeeded. Violations summary:"
    : "LTMS login succeeded. Violations summary:";

  const lines = [header];
  for (const tab of violations.tabs) {
    lines.push("");
    lines.push(`${tab.name}:`);
    lines.push(tab.text || "No visible content.");
  }

  return lines.join("\n");
}

function sessionPersistenceMessage(config) {
  return config.persistentSession
    ? "LTMS session kept alive. Use /recheck to scrape Violations again or /cancel to clear it."
    : "LTMS session closed after this check because PERSISTENT_SESSION is off.";
}

export function createBot(config = loadConfig()) {
  const bot = new Telegraf(config.telegramBotToken);
  const ltmsClient = new LtmsClient(config);
  const session = new SessionManager();

  async function ensureAuthorized(ctx) {
    if (!isAuthorizedChat(ctx, config.telegramAllowedChatId)) {
      await replyUnauthorized(ctx);
      return false;
    }

    return true;
  }

  async function cleanupSession() {
    await ltmsClient.cancel().catch(() => {});
    session.reset();
  }

  function logIncoming(ctx, label) {
    const chatId = String(ctx.chat?.id ?? "unknown");
    const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
    console.log(`[telegram] ${label} chat=${chatId} text=${JSON.stringify(text ?? "")}`);
  }

  async function sendCaptcha(ctx, captchaBuffer, messagePrefix = "Reply with the captcha text.") {
    const sent = await ctx.replyWithPhoto(
      { source: captchaBuffer, filename: "ltms-captcha.png" },
      {
        caption: `${messagePrefix}\nUse /retry for a fresh captcha or /cancel to stop.`,
      },
    );

    const currentRun = session.getRun();
    if (currentRun) {
      currentRun.captchaMessageId = sent.message_id;
    }
  }

  bot.command("check", async (ctx) => {
    logIncoming(ctx, "command:/check");

    if (!(await ensureAuthorized(ctx))) {
      return;
    }

    if (session.isLoggedIn()) {
      await ctx.reply("An LTMS session is already logged in. Use /recheck to scrape Violations again or /cancel to reset.");
      return;
    }

    if (session.hasActiveRun()) {
      await ctx.reply(`A run is already in progress (${session.getState()}). Use /retry or /cancel.`);
      return;
    }

    await ctx.reply("Starting LTMS login attempt.");

    try {
      const attempt = await ltmsClient.startLoginAttempt();
      session.begin({
        runId: attempt.runId,
        chatId: String(ctx.chat.id),
      });
      await sendCaptcha(ctx, attempt.captchaBuffer);
    } catch (error) {
      session.fail(error.message);
      await cleanupSession();
      await ctx.reply(`Failed to start LTMS login flow: ${error.message}`);
    }
  });

  bot.command("retry", async (ctx) => {
    logIncoming(ctx, "command:/retry");

    if (!(await ensureAuthorized(ctx))) {
      return;
    }

    if (session.isLoggedIn()) {
      await ctx.reply("You are already logged in. Use /recheck to rescan Violations or /cancel to clear the session.");
      return;
    }

    if (!session.hasActiveRun()) {
      await ctx.reply("No active LTMS run. Use /check first.");
      return;
    }

    await ctx.reply("Refreshing LTMS captcha.");

    try {
      session.transition("awaiting_captcha");
      const captchaBuffer = await ltmsClient.refreshCaptcha();
      await sendCaptcha(ctx, captchaBuffer, "Fresh captcha ready. Reply with the new captcha text.");
    } catch (error) {
      session.fail(error.message);
      await cleanupSession();
      await ctx.reply(`Failed to refresh captcha: ${error.message}`);
    }
  });

  bot.command("cancel", async (ctx) => {
    logIncoming(ctx, "command:/cancel");

    if (!(await ensureAuthorized(ctx))) {
      return;
    }

    if (!session.hasActiveRun()) {
      await ctx.reply("No active LTMS run.");
      return;
    }

    await cleanupSession();
    await ctx.reply("Active LTMS run cancelled.");
  });

  bot.command("start", async (ctx) => {
    logIncoming(ctx, "command:/start");

    if (!(await ensureAuthorized(ctx))) {
      return;
    }

    await ctx.reply(
      [
        "LTMS captcha relay bot is ready.",
        "Use /check to start a login attempt.",
        config.persistentSession
          ? "Use /recheck to scrape Violations again if the LTMS session is still logged in."
          : "PERSISTENT_SESSION is off, so each /check ends by closing the LTMS session.",
        "Use /retry to fetch a fresh captcha during an active run.",
        "Use /cancel to abort the current run.",
      ].join("\n"),
    );
  });

  bot.command("recheck", async (ctx) => {
    logIncoming(ctx, "command:/recheck");

    if (!(await ensureAuthorized(ctx))) {
      return;
    }

    if (!session.isLoggedIn()) {
      await ctx.reply(
        config.persistentSession
          ? "No logged-in LTMS session is available. Use /check first."
          : "PERSISTENT_SESSION is off, so /recheck is unavailable. Use /check instead.",
      );
      return;
    }

    const currentRun = session.getRun();
    if (!currentRun || currentRun.chatId !== String(ctx.chat.id)) {
      await ctx.reply("This LTMS session is not attached to the current chat. Use /check first.");
      return;
    }

    session.transition("checking_violations");
    await ctx.reply("Rechecking LTMS Violations.");

    try {
      const reusable = await ltmsClient.hasReusableSession();
      if (!reusable) {
        await cleanupSession();
        await ctx.reply("The LTMS session has expired. Use /check to log in again.");
        return;
      }

      const violations = await ltmsClient.checkViolations();
      session.complete({ violations });
      await ctx.reply(formatViolationsReport(violations));
    } catch (error) {
      session.fail(error.message);
      await cleanupSession();
      await ctx.reply(`Failed to recheck Violations: ${error.message}. Use /check to log in again.`);
    }
  });

  bot.on("text", async (ctx) => {
    logIncoming(ctx, "text");

    if (!(await ensureAuthorized(ctx))) {
      return;
    }

    const text = (ctx.message.text || "").trim();
    if (!text || text.startsWith("/")) {
      return;
    }

    if (session.getState() !== "awaiting_captcha") {
      return;
    }

    const currentRun = session.getRun();
    if (!currentRun || currentRun.chatId !== String(ctx.chat.id)) {
      return;
    }

    session.transition("submitting_login");
    await ctx.reply("Submitting captcha to LTMS.");

    try {
      const result = await ltmsClient.submitCaptcha(text);
      if (result.status !== "success") {
        session.fail(result.reason || "LTMS login failed");
        session.transition("awaiting_captcha");
        await ctx.reply(`Login failed: ${result.reason || "Unknown error"}. Use /retry to fetch a new captcha.`);
        return;
      }

      session.complete({ violations: result.violations });
      await ctx.reply(`${formatViolationsReport(result.violations)}\n\n${sessionPersistenceMessage(config)}`);
      if (!config.persistentSession) {
        await cleanupSession();
      }
    } catch (error) {
      session.fail(error.message);
      session.transition("awaiting_captcha");
      await ctx.reply(`Error while submitting captcha: ${error.message}. Use /retry to fetch a new captcha.`);
    }
  });

  bot.catch(async (error, ctx) => {
    console.error("Telegram bot error:", error);
    if (ctx?.reply) {
      await ctx.reply("Unexpected bot error. Use /check to start again or /cancel to clear the current run.");
    }
  });

  return { bot, session, ltmsClient };
}
