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
const resultChannelId = process.env.RESULT_CHANNEL_ID || "";
const sourceChannelIds = process.env.SOURCE_CHANNEL_IDS
  ? process.env.SOURCE_CHANNEL_IDS.split(",").map((id) => id.trim())
  : [];
let lastProcessedMessage: string | null = null; // Variable to store last processed message
let botStarted = false;

if (!botToken) {
  throw new Error("BOT_TOKEN is not set in environment variables");
}

// Initialize the Telegram bot
async function initializeBot(axiosInstance: AxiosInstance) {
  console.log("Initialize the Telegram bot");
  if (botStarted) return;
  botStarted = true;

  const bot = new Telegraf(botToken);

  bot.start((ctx) => ctx.reply("Bot started!"));

  axiosInstance = await checkAxiosInstance(axiosInstance);
  console.log("Bot on Received message");

  bot.on("message", async (ctx: any) => {
    const message = ctx.message;
    if (!message) {
      console.log("Invalid message received:", message);
      return;
    }

    if (message.caption !== undefined) {
      console.log("Bot received new message caption:", message.caption);

      if (message.caption !== lastProcessedMessage) {
        if (sourceChannelIds.includes(message.chat.id.toString())) {
          console.log("Forwarding the message to the destination channel");
          await processBonusCode(axiosInstance, message.caption);
        }
        lastProcessedMessage = message.caption;
      } else {
        console.log(
          "Skipping processBonusCode as caption is the same as previous."
        );
      }
    } else if (message.text !== undefined) {
      console.log("Bot received new message text:", message.text);
    }

    await botSendMessageToDestinationChannel(bot);
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
        Total : ${resultData.length}
        Success : ${summaryData.success.count}
        Failure : ${summaryData.failure.count}
        `;

      let responseMessage = `Bonus Code H25 Response User: ${username}\n${summaryResponse}\n\n${formattedResponse}`;

      // Validate message length against Telegram's limits (4096 characters)
      if (responseMessage.length > 4096) {
        console.warn(
          "Message length exceeds Telegram limit. Truncating message."
        );
        responseMessage = responseMessage.substring(0, 4096); // Truncate message to fit Telegram's limit
      }

      await bot.telegram.sendMessage(resultChannelId, responseMessage, {
        parse_mode: "Markdown",
      });

      console.log(`Response message sent to ${resultChannelId}`);
    }
  } catch (error) {
    console.error(
      `Error sending response message to ${resultChannelId}:`,
      error
    );
  }
}

export { initializeBot };
