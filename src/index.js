import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";

async function main() {
  const config = loadConfig();
  const { bot } = createBot(config);

  process.once("SIGINT", () => {
    bot.stop("SIGINT");
    process.exit(0);
  });

  process.once("SIGTERM", () => {
    bot.stop("SIGTERM");
    process.exit(0);
  });

  await bot.launch();
  console.log("LTMS Telegram bot is running.");
}

main().catch((error) => {
  console.error("Failed to start LTMS Telegram bot:", error);
  process.exit(1);
});
