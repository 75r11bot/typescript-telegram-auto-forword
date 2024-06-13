import fs from "fs";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { NewMessageEvent } from "telegram/events/NewMessage";
import { AxiosInstance } from "axios";
import bigInt from "big-integer";
import { Api } from "telegram/tl";
import {
  initializeAxiosInstance,
  checkAxiosInstance,
} from "./axios/axios.config";

import { Telegraf, Context } from "telegraf";
import { Update } from "telegraf/typings/core/types/typegram";
import {
  processBonusCode,
  responseResult,
  getInput,
  processH25Response,
  checkNetworkConnectivity,
} from "./services";
import { siteConfig } from "./sites.config";

dotenv.config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH || "";
const sourceChannelIds = process.env.SOURCE_CHANNEL_IDS
  ? process.env.SOURCE_CHANNEL_IDS.split(",").map((id) => id.trim())
  : [];
const destinationChannelId = process.env.DESTINATION_CHANNEL_ID || "";
const resultChannelId = process.env.RESPONSE_CHANNEL_ID || "";
const sourceChannelId = process.env.SOURCE_CHANNEL_ID || "";
const phoneNumber = process.env.APP_YOUR_PHONE || "";
const userPassword = process.env.APP_YOUR_PWD || "";
const port = Number(process.env.PORT) || 5000;
const sessionsDirectory = siteConfig.sessionsDirectory;
const sessionFilePath = siteConfig.sessionFileName;
const botToken = siteConfig.botToken;
const MAX_RETRIES = 5;
const INITIAL_RETRY_INTERVAL = 6000; // 5 seconds
let retryInterval = INITIAL_RETRY_INTERVAL;

if (!fs.existsSync(sessionsDirectory)) {
  fs.mkdirSync(sessionsDirectory);
}

let sessionClient = fs.existsSync(sessionFilePath)
  ? fs.readFileSync(sessionFilePath, "utf-8")
  : "";

let client: TelegramClient;
let axiosInstance: AxiosInstance;
let expressServer: any; // Define a variable to store the Express server instance
let lastProcessedMessage: string | null = null; // Variable to store last processed message

if (!botToken) {
  throw new Error("BOT_TOKEN is not set in environment variables");
}

const bot = new Telegraf(botToken);

// Initialize the Telegram bot
async function initializeBot() {
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

      // Check if current caption is the same as previous caption
      if (message.caption !== lastProcessedMessage) {
        await processBonusCode(axiosInstance, message.caption);

        lastProcessedMessage = message.caption; // Update previous caption
      } else {
        console.log(
          "Skipping processBonusCode as caption is the same as previous."
        );
      }

      // Check if the message is from the source channel
      if (message.chat.id === sourceChannelId) {
        // Forward the message to the destination channel
        console.log("Forwarding the message to the destination channel");
        await processBonusCode(axiosInstance, message.caption);
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
    const destinationEntity = await client.getEntity(destinationChannelId);

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

      await bot.telegram.sendMessage(destinationEntity, responseMessage, {
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

//Starting Bot
async function startBot() {
  try {
    console.error("initializeBot");

    await initializeBot();
  } catch (error) {
    console.error("Error starting bot:", error);
  }
}

// Initialize the Telegram client
async function initializeClient() {
  client = new TelegramClient(
    new StringSession(sessionClient),
    apiId,
    apiHash,
    {
      connectionRetries: 5,
      timeout: 86400000, // 24 hours
      useWSS: true,
    }
  );

  await client.connect();
  const isUserAuthorized = await client.isUserAuthorized();
  if (!isUserAuthorized) {
    throw new Error("User is not authorized.");
  }
  console.log("Telegram client initialized and user authorized.");
}

// Initialize session
async function initializeSession() {
  if (sessionClient) {
    console.log("Using existing session...");
    await client.connect();
  } else {
    console.log("No existing session found. Initiating new session...");
    await client.start({
      phoneNumber: async () => phoneNumber,
      password: async () => userPassword,
      phoneCode: async () =>
        await getInput("Please enter the code you received: "),
      onError: (err: Error) => {
        if (err.message.includes("AUTH_KEY_DUPLICATED")) {
          console.log(
            "AUTH_KEY_DUPLICATED error detected. Regenerating session..."
          );
          regenerateSession();
        } else {
          console.log("Client start error:", err);
          handleTelegramError(err);
        }
      },
    });

    // Check if client.session.save() returns a string
    const savedSession = client.session.save();
    if (typeof savedSession === "string") {
      sessionClient = savedSession;
      fs.writeFileSync(sessionFilePath, sessionClient);
      console.log("New session created and saved.");

      await startClient();
    } else {
      console.error("Failed to save session. Expected a string.");
    }
  }
}

async function handleTelegramError(error: Error) {
  console.error("Telegram error:", error);
  if (
    error.message.includes("ECONNREFUSED") ||
    error.message.includes("TIMEOUT")
  ) {
    console.log("Connection issue, retrying...");
    retryConnection();
  } else {
    console.log("Unhandled error, restarting client...");
    setTimeout(startClient, retryInterval);
  }
}

async function listChats() {
  try {
    console.log("Calling listChats...");

    const dialogs = await client.getDialogs();

    for (const dialog of dialogs) {
      console.log(`Chat ID: ${dialog.id}, Title: ${dialog.title}`);
    }
  } catch (error) {
    console.error("Error listing chats:", error);
  }
}

//Starting Client
async function startClient() {
  try {
    await initializeClient();
    await initializeSession();
    axiosInstance = await checkAxiosInstance(axiosInstance);

    const me = (await client.getEntity("me")) as Api.User;
    const displayName = [me.firstName, me.lastName].filter(Boolean).join(" ");
    console.log(`Signed in Successfully as ${displayName}`);
    await listChats();
    await forwardNewMessages(axiosInstance);
    await startBot();
  } catch (error) {
    console.error("Failed to start client:", error);
  }
}

async function regenerateSession() {
  try {
    console.log("Regenerating session...");
    fs.unlinkSync(sessionFilePath);
    await initializeService();
  } catch (error) {
    console.error("Failed to regenerate session:", error);
    setTimeout(regenerateSession, retryInterval);
  }
}

//Initializing Received message and forwarding
async function forwardNewMessages(axiosInstance: AxiosInstance) {
  try {
    console.log("Initializing message forwarding...");
    client.addEventHandler(async (event: NewMessageEvent) => {
      try {
        const message = event.message;
        const peer = message.peerId;

        console.log("Received new message:", message.message);
        console.log("Peer details:", peer);

        console.log("Processing Bonus Codes Call Requests to H25");
        await processBonusCode(axiosInstance, message.message);

        if (peer instanceof Api.PeerChannel) {
          const channelId =
            peer.channelId.valueOf() as unknown as bigInt.BigInteger;
          if (channelId) {
            const channelIdAsString = `-100${channelId.toString()}`;
            console.log("Channel ID as string:", channelIdAsString);
            console.log("Forwarding the message to the destination channel");
            await forwardMessage(message, channelIdAsString);

            if (sourceChannelIds.includes(channelIdAsString)) {
              // Forward the message to the destination channel
              console.log("Forwarding the message to the destination channel");
              await forwardMessage(message, channelIdAsString);
              // Processing Bonus Codes Call Requests to H25
              // console.log("Processing Bonus Codes Call Requests to H25");
              // await processBonusCode(axiosInstance, message.message);

              // // Send responseResult to the destination channel
              // await sendMessageToDestinationChannel();
            }
          } else {
            console.error("channelId is undefined for the message:", message);
          }
        } else if (peer instanceof Api.PeerChat) {
          const chatId = peer.chatId.valueOf() as unknown as bigInt.BigInteger;
          console.log("Chat ID:", chatId.toString());
          const chatIdAsString = `-${chatId.toString()}`;

          if (!destinationChannelId.includes(chatIdAsString)) {
            await forwardMessage(message, chatIdAsString);
          }
        } else if (peer instanceof Api.PeerUser) {
          const userId = peer.userId.valueOf() as unknown as bigInt.BigInteger;
          console.log("User ID:", userId.toString());

          // Handle messages from users if necessary
        } else {
          console.log("Unknown peer type, skipping this message.");
        }
      } catch (error) {
        console.error("Error handling new message event:", error);
        handleTelegramError(error as Error); // Use type assertion
      }
    }, new NewMessage({}));
    console.log("Message forwarding initialized successfully.");
    // Send responseResult to the destination channel
    await sendMessageToDestinationChannel();
  } catch (error) {
    console.error("Error setting up message forwarding:", error);
    handleTelegramError(error as Error); // Use type assertion
  }
}

async function forwardMessage(message: any, channelId: string) {
  try {
    const sourceEntity = await client.getEntity(channelId);
    const destinationEntity = await client.getEntity(destinationChannelId);

    await client.forwardMessages(destinationEntity, {
      fromPeer: sourceEntity,
      messages: [message.id],
    });

    console.log(
      `Message forwarded from ${channelId} to ${destinationChannelId}`
    );
  } catch (error) {
    console.error(
      `Error forwarding message from ${channelId} to ${destinationChannelId}:`,
      error
    );
  }
}

async function sendMessageToDestinationChannel() {
  try {
    const destinationEntity = await client.getEntity(resultChannelId);
    const resultData = responseResult.result;
    const username = responseResult.username;
    const summaryData = processH25Response(resultData);

    if (resultData.length > 0) {
      const formattedResponse = resultData
        .map(
          (result: { code: any; message: any; data: any }, index: number) => {
            return (
              `**Result ${index + 1}**\n` +
              `Code: \`${result.code}\`\n` +
              `Message: \`${result.message}\`\n` +
              `Details: \`${JSON.stringify(result.data, null, 2)}\`\n`
            );
          }
        )
        .join("\n");

      const summaryResponse =
        `Summary:\n` +
        `Total Count: ${resultData.length}\n` +
        `Success Count: ${summaryData.success.count}\n` +
        `Failure Count: ${summaryData.failure.count}\n`;

      const responseMessage = `Bonus Code H25 Response User :${username}\n${summaryResponse}\n\n${formattedResponse}`;

      await client.sendMessage(destinationEntity, {
        message: responseMessage,
        parseMode: "markdown",
      });

      console.log(`Response message sent to ${destinationChannelId}`);
    }
  } catch (error) {
    console.error(
      `Error sending response message to ${destinationChannelId}:`,
      error
    );
  }
}

async function retryConnection() {
  let retries = 0;
  let connected = false;

  while (!connected && retries < MAX_RETRIES) {
    try {
      await startClient();
      console.log("Service restarted successfully.");
      connected = true;
    } catch (error) {
      console.error(`Retry attempt ${retries + 1} failed:`, error);
      retries++;
      await wait(retryInterval);
      retryInterval *= 2; // Exponential backoff
    }
  }

  if (!connected) {
    console.error("Max retries reached. Unable to restart service. Exiting...");
    try {
      await restartService();
    } catch (error) {
      console.error("Error restarting Docker container:", error);
    }
  } else {
    retryInterval = INITIAL_RETRY_INTERVAL;
  }
}

async function startService() {
  try {
    expressServer = express();
    expressServer.use(express.json());

    // Health check endpoint
    expressServer.get("/health", (req: Request, res: Response) => {
      res.status(200).send("OK");
    });

    expressServer.get("/", (req: Request, res: Response) => {
      const resultData = responseResult.result;
      const username = responseResult.username;
      const summaryData = processH25Response(resultData); // Assuming you have access to this function

      res.send(`
        <html>
          <head><title>Telegram Forwarder Service</title></head>
          <body>
            <h1>Telegram Forwarder Service</h1>
            <p>Service is running and ready to forward messages.</p>
            <h2>Bonus Code H25 Response User ${username}</h2>
            <h3>Summary</h3>
            <ul>
              <li>Success Count: ${summaryData.success.count}</li>
              <li>Success Orders: ${summaryData.success.orders.join(", ")}</li>
              <li>Failure Count: ${summaryData.failure.count}</li>
              <li>Failure Details: 
                <ul>
                  ${Object.entries(summaryData.failure.details)
                    .map(
                      ([message, count]) => `
                    <li>${message}: ${count}</li>`
                    )
                    .join("")}
                </ul>
              </li>
            </ul>
            <h3>Individual Results</h3>
            <ul>
              ${resultData
                .map(
                  (
                    result: { code: any; message: any; data: any },
                    index: number
                  ) => `
                <li>
                  <b>Result ${index + 1}</b><br>
                  <b>Code:</b> ${result.code}<br>
                  <b>Message:</b> ${result.message}<br>
                  <b>Details:</b> ${JSON.stringify(result.data)}<br>
                </li>`
                )
                .join("")}
            </ul>
          </body>
        </html>
      `);
    });

    expressServer = expressServer.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });

    return expressServer; // Return the Express server instance
  } catch (error) {
    console.error("Service initialization error:", error);
    handleTelegramError(error as Error); // Use type assertion
  }
}

async function restartService() {
  try {
    console.log("Restarting service...");

    // Stop the current Express server instance
    expressServer.close();

    // Start a new instance of the Express server
    expressServer = await startService();

    console.log("Service restarted successfully.");
  } catch (error) {
    console.error("Error restarting service:", error);
  }
}

async function checkServiceHealth() {
  return new Promise((resolve) => {
    const net = require("net");
    const server = net.createServer();

    server.once("error", () => {
      // If an error occurs, the service is likely not healthy
      resolve(false);
    });

    server.once("listening", () => {
      // If the server is listening, it indicates that the service is healthy
      server.close();
      resolve(true);
    });

    server.listen(port, "0.0.0.0");
  });
}

async function monitorServiceHealth() {
  // Monitor service health and restart if necessary
  if (await checkServiceHealth()) {
    console.log("Service is healthy.");
  } else {
    console.log("Service is not responding. Restarting...");
    await restartService();
  }
}

async function initializeService() {
  try {
    console.log("Initializing service...");

    await startClient();
    await monitorServiceHealth(); // Check service health before starting

    expressServer = await startService(); // Store the Express server instance
    console.log("Service initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize service:", error);
  }
}

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  try {
    axiosInstance = await initializeAxiosInstance();
    await initializeService();
    setInterval(async () => {
      if (!(await checkNetworkConnectivity())) {
        console.log("Network connectivity lost. Attempting to reconnect...");
        await initializeService();
      }
    }, 60000); // Check network connectivity every minute
  } catch (error) {
    console.error("Error in initialization:", error);
  }
})();
