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
import { initializeBot, restartBotService } from "./bot";

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
const port = Number(process.env.PORT) || 5000;
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
let lastMessageClient: string | null = null; // Variable to store last processed message

async function initializeClient() {
  if (!client) {
    client = new TelegramClient(
      new StringSession(sessionClient),
      apiId,
      apiHash,
      {
        connectionRetries: 5,
        timeout: 30000, // 30 seconds
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

    await restartBotService();

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

async function forwardMessage(
  message: Api.Message,
  destinationChannelId: string
) {
  try {
    const destinationPeer = await client!.getEntity(destinationChannelId);

    await client!.forwardMessages(destinationPeer, {
      messages: [message.id],
      fromPeer: message.peerId,
    });

    console.log("Message forwarded successfully.");
  } catch (error) {
    console.error("Error forwarding message:", error);
    handleTelegramError(error as Error);
  }
}

async function startClient() {
  try {
    await initializeClient();
    await initializeSession();
    axiosInstance = await checkAxiosInstance(axiosInstance);

    if (!client) {
      throw new Error("Telegram client is not initialized.");
    }

    console.log("Initializing message forwarding...");
    const messageFilter = new NewMessage({
      chats: sourceChannelIds.map((id) => parseInt(id, 10)), // Source channels
      incoming: true, // Filter only incoming messages
    });

    client.addEventHandler(async (event: NewMessageEvent) => {
      try {
        const message = event.message;
        const peer = message.peerId;
        console.log(`Message ID: ${message.id}, Peer ID: ${peer.toString()}`);
        console.log(`Last Message Client Form Chat : ${lastMessageClient}`);
        console.log(`Received  New Message: ${message.message}`);

        let channelIdAsString: string | null = null;
        if (peer instanceof Api.PeerChannel) {
          channelIdAsString = `-100${peer.channelId.toString()}`;
        } else if (peer instanceof Api.PeerChat) {
          channelIdAsString = `-${peer.chatId.toString()}`;
        }
        console.log(`Received Message Form Chat : ${channelIdAsString}`);

        if (lastMessageClient !== message.message) {
          console.log(`Call process BonusCode ...`);
          await processBonusCode(axiosInstance, message.message);
          if (responseResult.result.length > 0) {
            console.log(
              `Send Message Result process Bonus Code to Chat Result`
            );
            await sendResultMessage(responseResult);
          }
          console.log(`Forward Message Bonus Code to Chat`);
          await forwardMessage(message, destinationChannelId);
          lastMessageClient = message.message;
        }
      } catch (error) {
        handleTelegramError(error as Error);
      }
    }, messageFilter);

    await initializeBot(axiosInstance);

    const me = (await client.getEntity("me")) as Api.User;
    const displayName = [me.firstName, me.lastName].filter(Boolean).join(" ");
    console.log(`Signed in successfully as ${displayName}`);

    const dialogs = await client.getDialogs();
    dialogs.forEach((dialog) => {
      console.log(`Chat ID: ${dialog.id}, Title: ${dialog.title}`);
    });
    console.log("Telegram client initialized and fully operational.");
  } catch (error) {
    console.error("Failed to start client:", error);
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

    const startServer = (port: number): Promise<boolean> => {
      return new Promise((resolve, reject) => {
        expressServer = app
          .listen(port, () => {
            console.log(`Server is running on port ${port}`);
            resolve(true);
          })
          .on("error", (err: any) => {
            if (err.code === "EADDRINUSE") {
              console.error(
                `Port ${port} is already in use, trying next port...`
              );
              resolve(false);
            } else {
              reject(err);
            }
          });
      });
    };

    let serverStarted = false;
    let currentPort = port;

    while (!serverStarted) {
      serverStarted = await startServer(currentPort);
      if (!serverStarted) {
        currentPort++;
      }
    }

    process.on("SIGINT", () => {
      console.log("Received SIGINT. Exiting gracefully...");
      if (expressServer) expressServer.close();
      if (client) client!.disconnect();
      restartBotService();
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
      } else if (error.message.includes("EADDRINUSE")) {
        console.error("Address in use, restarting with a different port...");
        initializeService();
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
