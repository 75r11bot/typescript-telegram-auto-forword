import { Telegraf } from "telegraf";
import { siteConfig } from "./sites.config";

const botToken = siteConfig.botToken || "";

const bot = new Telegraf(botToken);

bot
  .launch()
  .then(() => console.log("Bot started"))
  .catch((err: any) => console.error("Error starting bot:", err));

export { bot };
