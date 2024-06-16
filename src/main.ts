import fs from "fs";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { NewMessageEvent } from "telegram/events/NewMessage";
import { AxiosInstance } from "axios";
import { Api } from "telegram/tl";
import {
  initializeAxiosInstance,
  checkAxiosInstance,
} from "./axios/axios.config";

import {
  processBonusCode,
  responseResult,
  getInput,
  processH25Response,
  checkNetworkConnectivity,
} from "./services";
import { siteConfig } from "./sites.config";
import { initializeBot } from "./bot";

dotenv.config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH || "";
const destinationsChannelIds = process.env.DESTINATION_CHANNEL_IDS
  ? process.env.DESTINATION_CHANNEL_IDS.split(",").map((id) => id.trim())
  : [];
const sourceChannelIds = process.env.SOURCE_CHANNEL_IDS
  ? process.env.SOURCE_CHANNEL_IDS.split(",").map((id) => id.trim())
  : [];
const destinationChannelId = process.env.DESTINATION_CHANNEL_ID || "";
const resultChannelId = process.env.RESULT_CHANNEL_ID || "";
const phoneNumber = process.env.APP_YOUR_PHONE || "";
const userPassword = process.env.APP_YOUR_PWD || "";
const port = Number(process.env.PORT) || 5003;
const sessionsDirectory = siteConfig.sessionsDirectory;
const sessionFilePath = siteConfig.sessionFileName;
const MAX_RETRIES = 5;
const INITIAL_RETRY_INTERVAL = 6000; // 6 seconds
let retryInterval = INITIAL_RETRY_INTERVAL;

if (!fs.existsSync(sessionsDirectory)) {
  fs.mkdirSync(sessionsDirectory);
}

let sessionClient = fs.existsSync(sessionFilePath)
  ? fs.readFileSync(sessionFilePath, "utf-8")
  : "";

let client: TelegramClient | null = null;
let axiosInstance: AxiosInstance;
let expressServer: any;

async function initializeClient() {
  if (!client) {
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
    console.log("Telegram client initialized and connected.");
  }
}

async function initializeSession() {
  if (!client) await initializeClient(); // Ensure client is initialized

  if (sessionClient) {
    console.log("Using existing session...");
    await client!.connect();
  } else {
    console.log("No existing session found. Initiating new session...");
    await client!.start({
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

    const savedSession = client!.session.save();
    if (typeof savedSession === "string") {
      sessionClient = savedSession;
      fs.writeFileSync(sessionFilePath, sessionClient);
      console.log("New session created and saved.");
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
  } else if (error.message.includes("Conflict")) {
    console.log("Conflict detected, restarting service...");
    await restartService();
  } else {
    console.log("Unhandled error, restarting client...");
    setTimeout(startClient, retryInterval);
  }
}

async function restartService() {
  try {
    console.log("Restarting service...");

    if (expressServer) {
      await new Promise<void>((resolve, reject) => {
        expressServer.close((err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });
      expressServer = null;
    }

    if (client) {
      await client.disconnect();
      client = null;
    }

    await initializeService();
    console.log("Service restarted successfully.");
  } catch (error) {
    console.error("Error restarting service:", error);
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
      console.error("Error restarting service:", error);
    }
  } else {
    retryInterval = INITIAL_RETRY_INTERVAL; // Reset backoff interval on successful connection
  }
}

async function listChats() {
  try {
    if (!client) await initializeClient(); // Ensure client is initialized

    console.log("Calling listChats...");
    const dialogs = await client!.getDialogs();

    for (const dialog of dialogs) {
      console.log(`Chat ID: ${dialog.id}, Title: ${dialog.title}`);
    }
  } catch (error) {
    console.error("Error listing chats:", error);
  }
}

async function startClient() {
  try {
    await initializeClient();
    await initializeSession();
    axiosInstance = await checkAxiosInstance(axiosInstance);

    if (client) {
      const me = (await client.getEntity("me")) as Api.User;
      const displayName = [me.firstName, me.lastName].filter(Boolean).join(" ");
      console.log(`Signed in Successfully as ${displayName}`);
      await listChats();
      await forwardNewMessages(axiosInstance);
      await initializeBot(axiosInstance);
    }
  } catch (error) {
    console.error("Failed to start client:", error);
  }
}

async function regenerateSession() {
  try {
    console.log("Regenerating session...");
    fs.unlinkSync(sessionFilePath);
    await initializeSession();
  } catch (error) {
    console.error("Failed to regenerate session:", error);
    setTimeout(regenerateSession, retryInterval);
  }
}

async function forwardNewMessages(axiosInstance: AxiosInstance) {
  try {
    if (!client) await initializeClient(); // Ensure client is initialized

    console.log("Initializing message forwarding...");
    client!.addEventHandler(async (event: NewMessageEvent) => {
      try {
        const message = event.message;
        const peer = message.peerId;

        console.log("Received new message:", message.message);
        console.log("Peer details:", peer);

        await processBonusCode(axiosInstance, message.message);

        if (peer instanceof Api.PeerChannel) {
          const channelId = `-100${peer.channelId.toString()}`;
          console.log("Channel ID as string:", channelId);

          if (sourceChannelIds.includes(channelId)) {
            console.log("Forwarding the message to the destination channel");
            await forwardMessage(message, destinationChannelId);
          } else {
            console.log(`Channel ID ${channelId} not in sourceChannelIds`);
          }
        } else if (peer instanceof Api.PeerChat) {
          const chatId = `-${peer.chatId.toString()}`;
          if (!destinationsChannelIds.includes(chatId)) {
            console.log("Forward Message Procress");
            await forwardMessage(message, destinationChannelId);
          }
        } else if (peer instanceof Api.PeerUser) {
          const userId = peer.userId.toString();
          console.log("User ID as string:", userId);
        } else {
          console.log("Unknown peer type, skipping this message.");
        }
      } catch (error) {
        console.error("Error handling new message event:", error);
        handleTelegramError(error as Error);
      }
    }, new NewMessage({}));

    console.log("Message forwarding initialized successfully.");
    await sendResultMessage(responseResult);
  } catch (error) {
    console.error("Error setting up message forwarding:", error);
    handleTelegramError(error as Error);
  }
}

async function forwardMessage(message: any, destination: string) {
  try {
    if (!client) await initializeClient(); // Ensure client is initialized

    const destinationPeer = await client!.getEntity(destination);
    await client!.sendMessage(destinationPeer, { message: message.message });
    console.log("Message forwarded successfully.");
  } catch (error) {
    console.error("Error forwarding message:", error);
    handleTelegramError(error as Error);
  }
}

// Update the sendResultMessage function to use the defined type
async function sendResultMessage(responseResult: any): Promise<void> {
  try {
    if (!client) throw new Error("Client is not initialized"); // Ensure client is initialized

    const resultEntity = await client.getEntity(resultChannelId);
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

      const responseMessage = `Bonus Code H25 Response User ${username}\n${summaryResponse}\n\n${formattedResponse}`;

      await client.sendMessage(resultEntity, {
        message: responseMessage,
        parseMode: "markdown",
      });

      console.log(`Response message sent to ${resultEntity}`);
    }
  } catch (error) {
    console.error(
      `Error sending response message to ${resultChannelId}:`,
      error
    );
  }
}

async function healthCheck(req: Request, res: Response) {
  try {
    const response = await axiosInstance.get("/");
    if (response.status === 200) {
      res.status(200).send("Service is healthy");
    } else {
      res.status(500).send("Service is unhealthy");
    }
  } catch (error) {
    res.status(500).send("Service is unhealthy");
  }
}

async function initializeService() {
  try {
    axiosInstance = await initializeAxiosInstance();
    await checkNetworkConnectivity();
    await startClient();

    const app = express();

    app.get("/health", healthCheck);
    expressServer = app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });

    process.on("SIGINT", () => {
      console.log("Received SIGINT. Exiting gracefully...");
      if (expressServer) expressServer.close();
      if (client) client!.disconnect();
      process.exit(0);
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("Unhandled Rejection at:", promise, "reason:", reason);
    });

    process.on("uncaughtException", (error) => {
      console.error("Uncaught Exception:", error);
      if (
        error.message.includes("Conflict") ||
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("TIMEOUT")
      ) {
        console.log("Critical error detected. Restarting service...");
        restartService();
      } else {
        console.log("Unhandled exception. Exiting...");
        process.exit(1);
      }
    });
  } catch (error) {
    console.error("Error initializing service:", error);
    setTimeout(initializeService, retryInterval);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

initializeService().catch((error) => {
  console.error("Error initializing service:", error);
});
