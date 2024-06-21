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
const destinationChannelIds = process.env.DESTINATION_CHANNEL_IDS
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
        timeout: 120000,
        useWSS: true,
      }
    );
  }

  try {
    await client.connect();
    console.log("Telegram client initialized and connected.");
  } catch (error) {
    console.error("Error initializing Telegram client:", error);
    handleTelegramError(error as Error);
  }
}

async function startClient() {
  try {
    await initializeClient();
    await initializeSession();
    axiosInstance = await initializeAxiosInstance();
    axiosInstance = await checkAxiosInstance(axiosInstance);

    if (!client) {
      throw new Error("Telegram client is not initialized.");
    }

    const me = (await client.getEntity("me")) as Api.User;
    const displayName = [me.firstName, me.lastName].filter(Boolean).join(" ");
    console.log(`Signed in successfully as ${displayName}`);

    const dialogs = await client.getDialogs();
    dialogs.forEach((dialog) => {
      console.log(`Chat ID: ${dialog.id}, Title: ${dialog.title}`);
    });

    const newMessageFilter = new NewMessage({});
    console.log("Initializing message forwarding...");
    await client.addEventHandler(handleNewMessage, newMessageFilter);
    console.log("Message forwarding initialized successfully.");

    const allUpdatesFilter = new NewMessage({});
    await client.addEventHandler((update) => {
      console.log("Received message update:", update.message);
    }, allUpdatesFilter);

    await initializeBot(axiosInstance);

    console.log("Telegram client initialized and fully operational.");
  } catch (error) {
    console.error("Failed to start client:", error);
    handleTelegramError(error as Error);
  }
}

async function handleTelegramError(error: Error) {
  console.error("Telegram error:", error);

  if (
    error.message.includes("ECONNREFUSED") ||
    error.message.includes("TIMEOUT") ||
    error.message.includes("Not connected") ||
    error.message.includes("Frame not found")
  ) {
    console.warn("Connection issue, retrying...");
    retryConnection();
  } else if (error.message.includes("Conflict")) {
    console.warn("Conflict detected, restarting service...");
    await restartService();
  } else {
    console.error("Unhandled error, restarting client...");
    setTimeout(startClient, retryInterval);
  }
}

startClient().catch((error) => {
  console.error("Failed to start client:", error);
  process.exit(1);
});

async function initializeSession() {
  if (!client) await initializeClient();

  if (sessionClient) {
    console.log("Using existing session...");
    try {
      await client!.connect();
    } catch (error) {
      console.error("Error using existing session:", error);
      handleTelegramError(error as Error);
    }
  } else {
    console.log("No existing session found. Initiating new session...");
    try {
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
    } catch (error) {
      console.error("Error initiating new session:", error);
      handleTelegramError(error as Error);
    }
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
    setTimeout(restartService, retryInterval);
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
      retryInterval *= 2;
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
    retryInterval = INITIAL_RETRY_INTERVAL;
  }
}

async function handleNewMessage(event: NewMessageEvent) {
  try {
    console.log("handleNewMessage called"); // Initial log to indicate the function is called
    const message = event.message;
    const peer = message.peerId;

    console.log("Received new message:", message.message); // Log received message
    console.log("Peer details:", peer); // Log peer details

    if (peer instanceof Api.PeerChannel) {
      let channelIdAsString = peer.channelId.toString();
      if (!channelIdAsString.startsWith("-")) {
        channelIdAsString = `-100${channelIdAsString}`;
      } else {
        channelIdAsString = `-100${channelIdAsString.slice(1)}`;
      }
      console.log("channelIdAsString:", channelIdAsString);

      if (!destinationChannelIds.includes(channelIdAsString)) {
        console.log("PeerChannel Forward Message Process");
        await forwardMessage(message, destinationChannelId);
      }

      if (sourceChannelIds.includes(channelIdAsString)) {
        if (!destinationChannelIds.includes(channelIdAsString)) {
          console.log("In sourceChannelIds Forward Message Process");
          await forwardMessage(message, destinationChannelId);
        }
      } else {
        console.log(`Channel ID ${channelIdAsString} not in sourceChannelIds`);
      }
    } else if (peer instanceof Api.PeerChat) {
      const chatId = `-${peer.chatId.toString()}`;
      if (!destinationChannelIds.includes(chatId)) {
        console.log("PeerChat Forward Message Process");
        await forwardMessage(message, destinationChannelId);
      }
      if (sourceChannelIds.includes(chatId)) {
        if (!destinationChannelIds.includes(chatId)) {
          console.log("In sourceChannelIds Forward Message Process");
          await forwardMessage(message, destinationChannelId);
        }
      } else {
        console.log(`Chat ID ${chatId} not in sourceChannelIds`);
      }
    } else if (peer instanceof Api.PeerUser) {
      const userId = peer.userId.toString();
      if (!destinationChannelIds.includes(userId)) {
        console.log("PeerUser Forward Message Process");
        await forwardMessage(message, destinationChannelId);
      }

      if (sourceChannelIds.includes(userId)) {
        if (!destinationChannelIds.includes(userId)) {
          console.log("In sourceChannelIds Forward Message Process");
          await forwardMessage(message, destinationChannelId);
        }
      } else {
        console.log(`User ID ${userId} not in sourceChannelIds`);
      }
    }

    console.log("Processing bonus code...");
    await processBonusCode(axiosInstance, message.message); // Log before processing bonus code
    console.log("Bonus code processed.");

    console.log("Sending result message...");
    await sendResultMessage(responseResult); // Log before sending result message
    console.log("Result message sent.");
  } catch (error) {
    console.error("Error in handleNewMessage:", error); // Log error if it occurs
    handleTelegramError(error as Error);
  }
}

async function forwardMessage(
  message: Api.Message,
  destinationChannelId: string
) {
  try {
    const destinationPeer = await client!.getEntity(destinationChannelId);
    await client!.sendMessage(destinationPeer, {
      message: message.message,
    });
    console.log("Message forwarded successfully.");
  } catch (error) {
    console.error("Error forwarding message:", error);
    handleTelegramError(error as Error);
  }
}

async function sendResultMessage(responseResult: any): Promise<void> {
  try {
    if (!client) await initializeClient();

    const resultEntity = await client!.getEntity(resultChannelId);
    const resultData = responseResult.result;
    const username = responseResult.username;
    const summaryData = processH25Response(resultData);

    if (resultData.length > 0) {
      const formattedResponse = resultData
        .map((result: any, index: number) => {
          return (
            `**Result ${index + 1}**\n` +
            `Code: \`${result.code}\`\n` +
            `Message: \`${result.message}\`\n` +
            `Details: \`${JSON.stringify(result.data, null, 2)}\`\n`
          );
        })
        .join("\n");

      const summaryResponse =
        `Summary:\n` +
        `Total Count: ${resultData.length}\n` +
        `Success Count: ${summaryData.success.count}\n` +
        `Failure Count: ${summaryData.failure.count}\n`;

      const responseMessage = `Bonus Code H25 Response User ${username}\n${summaryResponse}\n\n${formattedResponse}`;

      await client!.sendMessage(resultEntity, {
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
    handleTelegramError(error as Error);
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

    while (true) {
      const isConnected = await checkNetworkConnectivity();
      if (isConnected) {
        console.log(
          "Network connectivity restored. Proceeding with service initialization..."
        );
        break;
      } else {
        console.error("No network connectivity. Retrying in 10 seconds...");
        await wait(10000);
      }
    }

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
        error.message.includes("TIMEOUT") ||
        error.message.includes("Frame not found")
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

function regenerateSession() {
  console.log("Regenerating session...");
  if (fs.existsSync(sessionFilePath)) {
    fs.unlinkSync(sessionFilePath);
  }
  sessionClient = "";
  initializeSession().catch((error) => {
    console.error("Error re-initializing session:", error);
    setTimeout(initializeSession, retryInterval);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

initializeService();
