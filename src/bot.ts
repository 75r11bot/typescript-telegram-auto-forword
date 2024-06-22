import { Telegraf, Context } from "telegraf";
import { siteConfig } from "./sites.config";
import { checkAxiosInstance } from "./axios/axios.config";
import { AxiosInstance } from "axios";
import {
  processBonusCode,
  processH25Response,
  responseResult,
} from "./services";

const botToken = siteConfig.botToken;
const botResultChannelId = process.env.BOT_RESULT_CHANNEL_ID || "";
const sourceChannelIds = process.env.SOURCE_CHANNEL_IDS
  ? process.env.SOURCE_CHANNEL_IDS.split(",").map((id) => id.trim())
  : [];
let lastProcessedMessage: string | null = null; // Variable to store last processed message
let botStarted = false;
let bot: Telegraf<Context>;

if (!botToken) {
  throw new Error("BOT_TOKEN is not set in environment variables");
}

// Initialize the Telegram bot
async function initializeBot(axiosInstance: AxiosInstance) {
  console.log("Initializing the Telegram bot");
  if (botStarted) return;
  botStarted = true;

  bot = new Telegraf(botToken);

  bot.start((ctx) => ctx.reply("Bot started!"));

  axiosInstance = await checkAxiosInstance(axiosInstance);
  console.log("Bot ready to receive messages");

  bot.on("message", async (ctx: any) => {
    const message = ctx.message;
    if (!message) {
      console.log("Invalid message received:", message);
      return;
    }

    if (message.caption !== undefined) {
      if (message.caption !== lastProcessedMessage) {
        if (
          message.forward_from_chat &&
          sourceChannelIds.includes(message.forward_from_chat.id.toString())
        ) {
          console.log("Processing bonus code via h25 API");
          await processBonusCode(axiosInstance, message.caption);
          await botSendMessageToDestinationChannel(bot);
        }
        lastProcessedMessage = message.caption;
      } else {
        console.log(
          "Skipping processBonusCode as caption is the same as previous."
        );
      }
    }
  });

  bot
    .launch()
    .then(() => console.log("Bot started successfully."))
    .catch((err) => console.error("Error starting bot:", err));
}

async function botSendMessageToDestinationChannel(
  bot: Telegraf<Context>
): Promise<void> {
  try {
    const resultData = responseResult.result;
    const username = siteConfig.h25User;
    const summaryData = processH25Response(resultData);

    if (resultData.length > 0) {
      let formattedResponse = resultData
        .map(
          (result: { code: any; message: any; data: any }, index: number) => `
          **Result ${index + 1}**
          Code: \`${result.code}\`
        `
        )
        .join("\n");

      const summaryResponse = `
        Summary:
        Total: ${resultData.length}
        Success: ${summaryData.success.count}
        Failure: ${summaryData.failure.count}
      `;

      let responseMessage = `Bonus Code H25 Response User: ${username}\n${summaryResponse}\n\n${formattedResponse}`;

      // Validate message length against Telegram's limits (4096 characters)
      if (responseMessage.length > 4096) {
        console.warn(
          "Message length exceeds Telegram limit. Truncating message."
        );
        responseMessage = responseMessage.substring(0, 4096); // Truncate message to fit Telegram's limit
      }

      await bot.telegram.sendMessage(botResultChannelId, responseMessage, {
        parse_mode: "Markdown",
      });

      console.log(`Response message sent to ${botResultChannelId}`);
    }
  } catch (error) {
    console.error(
      `Error sending response message to ${botResultChannelId}:`,
      error
    );
  }
}

async function restartBotService() {
  console.log("Restarting service...");
  if (bot) {
    try {
      await bot.stop();
      botStarted = false;
      console.log("Bot stopped successfully.");
    } catch (error) {
      console.error("Error stopping bot:", error);
    }
  }
}

export { initializeBot, restartBotService };
