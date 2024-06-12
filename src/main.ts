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
import { ApiCall } from "./axios/axios.config";
import { bot, initializeBot } from "./bot";
import { siteConfig } from "./sites.config";

import {
  processBonusCode,
  responseResult,
  getInput,
  processH25Response,
  checkNetworkConnectivity,
} from "./services";
import { Telegraf, Context } from "telegraf";
import { Update } from "telegraf/typings/core/types/typegram";

dotenv.config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH || "";
const sourceChannelIds = process.env.SOURCE_CHANNEL_IDS
  ? process.env.SOURCE_CHANNEL_IDS.split(",").map((id) => id.trim())
  : [];
const destinationChannelId = process.env.DESTINATION_CHANNEL_ID || "";
const responesChannelId = process.env.RESPONSE_CHANNEL_ID || "";

const phoneNumber = process.env.APP_YOUR_PHONE || "";
const userPassword = process.env.APP_YOUR_PWD || "";
const port = Number(process.env.PORT) || 5000;
const sessionsDirectory = siteConfig.sessionsDirectory;
const sessionFilePath = siteConfig.sessionFileName;

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
  console.log("Telegram client initialized successfully.");
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
    setTimeout(startBot, retryInterval);
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

async function forwardNewMessages(axiosInstance: AxiosInstance) {
  try {
    console.log("Initializing message forwarding...");
    await client.connect(); // Ensure the client is connected before handling messages

    client.addEventHandler(async (event: NewMessageEvent) => {
      try {
        const message = event.message;
        const peer = message.peerId as Api.PeerChannel; // Assert the peerId type
        console.log("client received new message: ", message.message);
        console.log("instanceof peer: ", peer instanceof Api.PeerChannel);
        console.log("peer : ", message.peerId);

        if (peer instanceof Api.PeerChannel) {
          const channelId = peer.channelId as bigInt.BigInteger;
          const channelIdAsString = `-100${channelId.toString()}`;

          console.log("Received message from channel ID:", channelIdAsString);

          // Forward the message to the destination channel
          console.log("Forwarding the message to the destination channel");
          await forwardMessage(message, channelIdAsString);
          await forwardMessage(message, channelId.toString());

          //Check if the message is from one of the source channels
          console.log(
            "Check if the message is from one of the source channels:",
            sourceChannelIds.includes(channelIdAsString) ||
              sourceChannelIds.includes(channelId.toString())
          );

          if (
            sourceChannelIds.includes(channelIdAsString) ||
            sourceChannelIds.includes(channelId.toString())
          ) {
            // Processing Bonus Codes Call Requests to H25
            console.log("Processing Bonus Codes Call Requests to H25");
            await processBonusCode(axiosInstance, message.message);
            // Send responseResult to the destination channel
            await sendMessageToDestinationChannel();
          }
        } else {
          console.log("Peer is not a channel, skipping this message.");
        }
      } catch (error) {
        console.error("Error handling new message event:", error);
        handleTelegramError(error as Error); // Use type assertion
      }
    }, new NewMessage({}));

    console.log("Message forwarding initialized successfully.");
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
    const destinationEntity = await client.getEntity(responesChannelId);
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
        `Success Count: ${summaryData.success.count}\n` +
        `Success Orders: ${summaryData.success.orders.join(", ")}\n` +
        `Failure Count: ${summaryData.failure.count}\n` +
        `Failure Details: ${Object.entries(summaryData.failure.details)
          .map(([message, count]) => `${message}: ${count}`)
          .join(", ")}`;

      const responseMessage = `Bonus Code H25 Response User ${username}:\n${formattedResponse}\n\n${summaryResponse}`;

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

// Send a message to the destination channel using bot
async function botSendMessageToDestinationChannel(
  bot: Telegraf<Context<Update>>
) {
  try {
    const destinationChannelId = responesChannelId;
    const resultData = responseResult.result;
    const username = responseResult.username; // Fixed typo from `responseResult.username` to `responseResult.username`
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
        `Success Count: ${summaryData.success.count}\n` +
        `Success Orders: ${summaryData.success.orders.join(", ")}\n` +
        `Failure Count: ${summaryData.failure.count}\n` +
        `Failure Details: ${Object.entries(summaryData.failure.details)
          .map(([message, count]) => `${message}: ${count}`)
          .join(", ")}`;

      const responseMessage = `Bonus Code H25 Response User ${username}:\n${formattedResponse}\n\n${summaryResponse}`;

      await bot.telegram.sendMessage(destinationChannelId, responseMessage, {
        parse_mode: "Markdown",
      });

      console.log(`Response message sent to ${destinationChannelId} using bot`);
    }
  } catch (error) {
    console.error(
      `Error sending response message to ${destinationChannelId} using bot:`,
      error
    );
  }
}

async function startClient(sessionClient?: string) {
  try {
    if (!axiosInstance) {
      axiosInstance = await ApiCall();
    }

    let session = "";

    if (fs.existsSync(sessionFilePath)) {
      session = fs.readFileSync(sessionFilePath, "utf-8");
      console.log("Session file found and read.");
    } else if (sessionClient) {
      session = sessionClient;
      console.log("Using provided session client.");
    }

    if (!client) {
      client = new TelegramClient(new StringSession(session), apiId, apiHash, {
        connectionRetries: 5,
        timeout: 86400000, // 24 hours
        useWSS: true,
      });
      console.log("Telegram client initialized.");
    }

    await client.start({
      phoneNumber: async () => phoneNumber,
      password: async () => userPassword,
      phoneCode: async () => await getInput("Enter the code: "),
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

    console.log("Client login successful.");

    if (!fs.existsSync(sessionFilePath)) {
      // Save session only if it's a new session
      const savedSession = client.session.save();
      if (typeof savedSession === "string") {
        fs.writeFileSync(sessionFilePath, savedSession, "utf-8");
        console.log("Session saved to file.");
      } else {
        console.error("Failed to save session: Session is not a string");
      }
    }

    const me = (await client.getEntity("me")) as Api.User;
    const displayName = [me.firstName, me.lastName].filter(Boolean).join(" ");
    console.log(`Signed in successfully as ${displayName}`);

    await listChats();
    await forwardNewMessages(axiosInstance);

    bot.on("message", async (ctx: { message: any }) => {
      const message = ctx.message;
      if (message && message.caption !== undefined) {
        console.log("Bot received new message caption:", message.caption);
        console.log("Bot Processing Bonus Codes Call Requests to H25");
        await processBonusCode(axiosInstance, message.caption);
      } else if (message && message.text !== undefined) {
        console.log("Bot received new message text:", message.text);
        console.log("Bot Processing Bonus Codes Call Requests to H25");
      } else {
        console.log("Invalid message received:", message);
      }
      if (!responesChannelId.includes(message.chat.id)) {
        await botSendMessageToDestinationChannel(bot);
      }
    });
  } catch (error) {
    console.error("Failed to start client:", error);
    await retryConnection();
  }
}

// Start the bot
async function startBot() {
  try {
    await initializeBot();
    console.log("Bot started successfully.");
  } catch (error) {
    console.error("Error starting bot:", error);
    retryBotStart();
  }
}

// Retry starting the bot with exponential backoff
function retryBotStart() {
  if (retryInterval <= MAX_RETRIES * INITIAL_RETRY_INTERVAL) {
    setTimeout(startBot, retryInterval);
    retryInterval *= 2; // Exponential backoff
  } else {
    console.error("Max retries reached. Failed to start the bot.");
  }
}

async function regenerateSession() {
  try {
    console.log("Regenerating session...");
    fs.unlinkSync(sessionFilePath);
    await initializeClient();
    await startClient();
    await startBot();
  } catch (error) {
    console.error("Failed to regenerate session:", error);
    setTimeout(regenerateSession, retryInterval);
  }
}

async function retryConnection() {
  let retries = 0;
  let connected = false;

  while (!connected && retries < MAX_RETRIES) {
    try {
      await startClient();
      await startBot();
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
    if (!axiosInstance) {
      axiosInstance = await ApiCall();
    }

    console.log(`======= Serving on http://0.0.0.0:${port} ======`);

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

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function handleClientDisconnect() {
  // Implement logic to handle client disconnection
  console.log("Attempting to reconnect...");
  await startClient();
  await startBot();
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

    // Check if the session file exists
    if (fs.existsSync(sessionFilePath)) {
      console.log(`Session file found at ${sessionFilePath}.`);
      sessionClient = fs.readFileSync(sessionFilePath, "utf-8");

      if (sessionClient) {
        console.log("Session client found. Using existing session.");
        await startClient(sessionClient); // Start the client with the existing session
        await startBot();
      } else {
        console.log(
          "Session client not found. Starting client with new session."
        );
        await startClient(); // Start the client with a new session
        await startBot();
      }
    } else {
      console.log(
        `Session file not found at ${sessionFilePath}. Starting client with new session.`
      );
      await startClient(); // Start the client with a new session
      await startBot();
    }

    await monitorServiceHealth(); // Check service health before starting
    expressServer = await startService(); // Store the Express server instance

    console.log("Service initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize service:", error);
  }
}

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  handleTelegramError(error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  handleTelegramError(new Error(reason as string));
});

(async () => {
  try {
    initializeService(); // Kickstart the service
    setInterval(async () => {
      if (!(await checkNetworkConnectivity())) {
        console.log("Network connectivity lost. Attempting to reconnect...");
        await handleClientDisconnect();
      }
    }, 60000); // Check network connectivity every minute
  } catch (error: any) {
    console.error("Error in initialization:", error);
    handleTelegramError(error);
  }
})();
