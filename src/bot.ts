import { Telegraf } from "telegraf";
import dotenv from "dotenv";
dotenv.config();

const botToken = process.env.BOT_TOKEN || "";

const bot = new Telegraf(botToken);

bot
  .launch()
  .then(() => console.log("Bot started"))
  .catch((err: any) => console.error("Error starting bot:", err));

export { bot };
