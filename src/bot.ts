import { Telegraf } from "telegraf";
import { siteConfig } from "./sites.config";

const botToken = siteConfig.botToken || "";

const bot = new Telegraf(botToken);

export { bot };
export const initializeBot = async () => {
  try {
    await bot.launch();
    console.log("Bot started");
  } catch (error) {
    console.error("Error starting bot:", error);
    throw error; // Propagate error to handle in the caller
  }
};
