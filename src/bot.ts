import { Telegraf } from "telegraf";
import { siteConfig } from "./sites.config";

const botToken = siteConfig.botToken || "";

const bot = new Telegraf(botToken);

export { bot };
