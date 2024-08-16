import fs from "fs";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { AxiosInstance } from "axios";
import { Api } from "telegram/tl";
import { NewMessage } from "telegram/events";
import { NewMessageEvent } from "telegram/events/NewMessage";

import {
  initializeAxiosInstance,
  initializeAxiosInstanceT6,
  checkAxiosInstance,
  checkAxiosInstanceT6,
} from "./axios/axios.config";
import {
  processBonusCode,
  getInput,
  processH25Response,
  checkNetworkConnectivity,
  processBonusCodeT6,
  getLotteryNum,
  calculateRealTimeRebate,
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

const resultChannelId = process.env.RESULT_CHANNEL_ID || "";
const phoneNumber = process.env.APP_YOUR_PHONE || "";
const userPassword = process.env.APP_YOUR_PWD || "";
const port = Number(process.env.PORT) || 5100;
const sessionsDirectory = siteConfig.sessionsDirectory;
const sessionFilePath = siteConfig.sessionFileName;
const MAX_RETRIES = 5;
const INITIAL_RETRY_INTERVAL = 6000; // 6 seconds
let retryInterval = INITIAL_RETRY_INTERVAL;

const chatT6 = siteConfig.chatT6;
const chatH25 = siteConfig.chatH25;
const bonusT6 = siteConfig.bonusT6;
const bonusH25 = siteConfig.bonusH25;

if (!fs.existsSync(sessionsDirectory)) {
  fs.mkdirSync(sessionsDirectory);
}

let sessionClient = fs.existsSync(sessionFilePath)
  ? fs.readFileSync(sessionFilePath, "utf-8")
  : "";

let client: TelegramClient | null = null;
let axiosInstance: AxiosInstance;
let axiosInstanceT6: AxiosInstance;

let expressServer: any;
let lastMessageClient: string | null = null; // Variable to store last processed message
let lastMessageClientForword: string | null = null; // Variable to store last processed message

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

async function regenerateSession() {
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

async function handleTelegramError(error: Error) {
  console.error("Telegram error:", error);

  if (
    error.message.includes("TIMEOUT") ||
    error.message.includes("Not connected")
  ) {
    console.warn("Connection issue, retrying...");
    retryInterval = Math.min(retryInterval * 2, 60000); // Exponential backoff, max 60 seconds
    await retryConnection(startClient, retryInterval);
  } else if (
    error.message.includes("Conflict") ||
    error.message.includes("EADDRINUSE")
  ) {
    console.warn("Conflict detected, restarting service...");
    await restartService();
  } else if (error.message.includes("AUTH_KEY_DUPLICATED")) {
    console.log("AUTH_KEY_DUPLICATED error detected. Regenerating session...");
    await regenerateSession();
  } else {
    console.error("Unhandled error, restarting client...");
    setTimeout(startClient, retryInterval);
  }
}

async function retryConnection(
  startClient: () => Promise<void>,
  retryInterval: number
) {
  let retries = 0;
  const maxRetries = 5;
  let connected = false;

  while (!connected && retries < maxRetries) {
    try {
      await startClient();
      console.log("Service restarted successfully.");
      connected = true;
    } catch (error) {
      console.error(`Retry attempt ${retries + 1} failed:`, error);
      retries++;
      await new Promise((resolve) => setTimeout(resolve, retryInterval));
      retryInterval = Math.min(retryInterval * 2, 60000); // Exponential backoff, max 60 seconds
    }
  }

  if (!connected) {
    console.error("Failed to reconnect after maximum attempts.");
    process.exit(1);
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
      const summaryResponse =
        `Summary:\n` +
        `Total Count: ${resultData.length}\n` +
        `Success Count: ${summaryData.success.count}\n` +
        `Failure Count: ${summaryData.failure.count}\n`;

      const responseMessage = `Bonus Code H25 Response User ${username}\n${summaryResponse}\n\n`;

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
    if (!client) await initializeClient();
    // Get the entity (channel) to which the message will be forwarded
    const destinationPeer = await client!.getEntity(destinationChannelId);
    // Forward the message using Telegram client's forwardMessages method
    await client!.forwardMessages(destinationPeer, {
      messages: [message.id], // Array of message IDs to forward
      fromPeer: message.peerId!, // The original peer (channel) from which the message is forwarded
    });

    console.log(
      `Message forwarded from Server is running on port: ${port} Successfully `
    );
    console.log(
      `Message forwarded from ${message.peerId} to ${destinationChannelId} Successfully `
    );
  } catch (error) {
    console.error("Error forwarding message:", error);
    handleTelegramError(error as Error); // Handle the error appropriately
  }
}

async function initializeService() {
  await initializeSession();

  const app = express();
  app.use(express.json());

  app.get("/health", (req: Request, res: Response) => {
    res.sendStatus(200);
  });

  if (client) {
    await getChatsList(client);
  } else {
    await initializeSession();
  }

  const addEventHandlers = async (client: TelegramClient) => {
    client.addEventHandler(
      async (event: NewMessageEvent) => {
        const message = event.message;
        if (!message) return;
        const messageText = message.text.toLowerCase();

        // Avoid processing duplicate messages
        if (lastMessageClient === messageText) return;
        const peerId = message.peerId;

        if (messageText && peerId) {
          let peerIdStr;

          if (peerId instanceof Api.PeerChannel) {
            peerIdStr = "-100" + peerId.channelId.toString();
          } else if (peerId instanceof Api.PeerChat) {
            peerIdStr = parseInt(peerId.chatId.toString(), 10);
          } else if (peerId instanceof Api.PeerUser) {
            // Directly convert BigInt to string
            peerIdStr = peerId.userId.toString();
          } else {
            peerIdStr = JSON.stringify(peerId);
          }

          console.log("peerId:", peerId); // Log the entire peerId object
          console.log("peerIdStr:", peerIdStr); // Log the stringified peerId

          console.log(
            `Received message '${messageText}' from peer ID '${peerIdStr}'`
          );

          // Log peerIdStr, chatH25, and chatT6 for debugging
          console.log(`peerIdStr: ${peerIdStr}`);
          console.log(`chatH25: ${chatH25}`);
          console.log(`chatT6: ${chatT6}`);

          if (peerIdStr === chatH25.toString() || peerIdStr === "6742160125") {
            console.log("Received message from H25 THAILAND:", messageText);
            try {
              await processBonusCode(axiosInstance, messageText);
            } catch (error) {
              await forwardMessage(message, bonusH25);
            }
          } else if (peerIdStr === chatT6.toString()) {
            console.log("Received message from T6 Thailand:", messageText);
            try {
              const regex = /\b[A-Z0-9]{10}\b/;
              const match = messageText.match(regex);
              const containsBonusText = messageText.includes("กดรับโค้ด");
              const containsBonusText1 = messageText.includes("แจกแลกรหัส");
              if (
                (match && containsBonusText) ||
                (match && containsBonusText1)
              ) {
                await processBonusCodeT6(axiosInstanceT6, messageText);
              }
            } catch (error) {
              await forwardMessage(message, bonusT6);
            }
          } else {
            console.log("Unrecognized message:", messageText);
          }
          lastMessageClient = messageText;
        }
      },
      new NewMessage({})
      // new NewMessage({
      //   chats: [
      //     -1001836737719, // H25 THAILAND 🇹🇭
      //     -1001951928932, // T6 Thailand ®
      //     6742160125, //Title: H25VIP_bot
      //   ],
      //   incoming: true,
      // })
    );
  };

  const ensureConnectedAndAddHandlers = async () => {
    console.log("Client is Check connect:", client && client.connected);
    if (client && client.connected) {
      console.log("Client is connected :", client.connected);
      await addEventHandlers(client);
    } else {
      console.log("Client is not connected. Attempting to reconnect...");
      await initializeClient();
      console.log("Client is Check reconnected :", client && client.connected);

      if (client && client.connected) {
        console.log("Client reconnected successfully :", client.connected);
        await addEventHandlers(client);
      } else {
        console.log("Failed to reconnect client");
        await restartService();
      }
    }
  };

  await ensureConnectedAndAddHandlers();

  let currentPort = port;

  const startServer = (port: number) => {
    return new Promise<void>((resolve, reject) => {
      expressServer = app
        .listen(port, () => {
          console.log(`Server is running on port ${port}`);
          resolve();
        })
        .on("error", (err: any) => {
          if (err.code === "EADDRINUSE") {
            console.warn(`Port ${port} is in use, trying another port...`);
            resolve(startServer(port + 1));
          } else {
            reject(err);
          }
        });
    });
  };

  try {
    await startServer(currentPort);
  } catch (err) {
    console.error("Failed to start server:", err);
  }

  const gracefulShutdown = () => {
    console.log("Shutting down gracefully...");
    expressServer.close(() => {
      console.log("Express server closed.");
    });

    if (client) {
      client.disconnect().then(() => {
        console.log("Telegram client disconnected.");
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on("SIGTERM", gracefulShutdown);
  process.on("SIGINT", gracefulShutdown);
}

async function startClient() {
  try {
    // Ensure Axios instances are healthy
    if (!axiosInstance) {
      console.log("Axios instance for H25 is not healthy. Reinitializing...");
      axiosInstance = await initializeAxiosInstance();
    }

    if (!axiosInstanceT6) {
      console.log("Axios instance for T6 is not healthy. Reinitializing...");
      axiosInstanceT6 = await initializeAxiosInstanceT6();
    }

    if (!client) await initializeClient();
    console.log("Client Connect ...:", client!.connected);

    await initializeService();

    // const logMessage = (message: string, ...additionalInfo: any[]) => {
    //   console.log(
    //     `[${new Date().toISOString()}] ${message}`,
    //     ...additionalInfo
    //   );
    // };

    // const handleNewMessageEvent = async (event: NewMessageEvent) => {
    //   const message = event.message;
    //   const messageText = message.message;
    //   const peerId = message.peerId;

    //   if (messageText && peerId) {
    //     let peerIdStr;
    //     if (peerId instanceof Api.PeerChannel) {
    //       peerIdStr = "-100" + peerId.channelId.valueOf().toString();
    //     } else {
    //       peerIdStr = peerId.toString();
    //     }

    //     logMessage(
    //       `Received message '${messageText}' from peer ID '${peerIdStr}'`
    //     );

    //     // Log peerIdStr, chatH25, and chatT6 for debugging
    //     logMessage(`peerIdStr: ${peerIdStr}`);
    //     logMessage(`chatH25: ${chatH25}`);
    //     logMessage(`chatT6: ${chatT6}`);

    //     if (peerIdStr === chatH25.toString()) {
    //       logMessage("Received message from H25 THAILAND:", messageText);
    //       await forwardMessage(message, bonusH25);
    //       try {
    //         logMessage("processBonusCode message to Bonus Code H25:", bonusH25);
    //         const result = await processBonusCode(axiosInstance, messageText);
    //         if (result) {
    //           await sendResultMessage(result);
    //         }
    //       } catch (error) {
    //         logMessage("Error processing Forward H25 bonus code:", error);
    //       }
    //     } else if (peerIdStr === chatT6.toString()) {
    //       logMessage("Received message from T6 Thailand:", messageText);
    //       await forwardMessage(message, bonusT6);
    //       try {
    //         logMessage("processBonusCode message to Bonus Code T6:", bonusT6);
    //         const result = await processBonusCodeT6(
    //           axiosInstanceT6,
    //           messageText
    //         );
    //         if (result) {
    //           await sendResultMessage(result);
    //         }
    //       } catch (error) {
    //         logMessage("Error processing Forward T6 bonus code:", error);
    //       }
    //     } else {
    //       logMessage("Unrecognized message:", messageText);
    //       logMessage("log message peerId:", message.peerId);
    //     }
    //   }
    // };
    // client!.addEventHandler(handleNewMessageEvent, new NewMessage({}));

    await initializeBot(axiosInstance, axiosInstanceT6);
  } catch (error) {
    console.error("Error during service initialization:", error);
    setTimeout(startClient, retryInterval);
  }
}

async function messageEventProcress(client: TelegramClient) {
  console.log("Client is messageEventProcress");
  const forwardMessageEvent = async (event: NewMessageEvent) => {
    console.log("Client is message Forword Procress");

    const message = event.message;
    const messageText = message.message;
    const peerId = message.peerId;

    if (messageText && peerId) {
      if (lastMessageClientForword === messageText) return;

      let peerIdStr;

      if (peerId instanceof Api.PeerChannel) {
        peerIdStr = "-100" + peerId.channelId.toString();
      } else if (peerId instanceof Api.PeerChat) {
        peerIdStr = parseInt(peerId.chatId.toString(), 10);
      } else if (peerId instanceof Api.PeerUser) {
        // Directly convert BigInt to string
        peerIdStr = peerId.userId.toString();
      } else {
        peerIdStr = JSON.stringify(peerId);
      }

      console.log("peerId:", peerId); // Log the entire peerId object
      console.log("peerIdStr:", peerIdStr); // Log the stringified peerId

      console.log(
        `Received message '${messageText}' from peer ID Channel :'${peerIdStr}'`
      );

      // Log peerIdStr, chatH25, and chatT6 for debugging
      console.log(`peerIdStr: ${peerIdStr}`);
      console.log(`chatH25: ${chatH25}`);
      console.log(`chatT6: ${chatT6}`);

      if (peerIdStr === chatH25.toString() || peerIdStr === "6742160125") {
        console.log("Forword message from H25 THAILAND:", messageText);
        await forwardMessage(message, bonusH25);
      } else if (peerIdStr === chatT6.toString()) {
        console.log("Forword message from T6 Thailand:", messageText);
        const regex = /\b[A-Z0-9]{10}\b/;
        const match = messageText.match(regex);
        const containsBonusText = messageText.includes("กดรับโค้ด");
        const containsBonusText1 = messageText.includes("แจกแลกรหัส");
        if ((match && containsBonusText) || (match && containsBonusText1)) {
          await forwardMessage(message, bonusT6);
        }
      } else {
        console.log("Unrecognized message:", messageText);
        console.log("log message peerId:", message.peerId);
      }
      lastMessageClientForword = messageText;
    }
  };
  // // Add the event handler to the client
  // client.addEventHandler(
  //   forwardMessageEvent,
  //   new NewMessage({
  //     chats: [
  //       -1001836737719, // H25 THAILAND 🇹🇭
  //       -1001951928932, // T6 Thailand ®
  //       6742160125, //Title: H25VIP_bot
  //     ],
  //     incoming: true,
  //   })
  // );
  client.addEventHandler(forwardMessageEvent, new NewMessage({}));
}

async function getChatsList(client: TelegramClient) {
  try {
    const dialogs = await client.getDialogs();
    dialogs.forEach((dialog: any) => {
      console.log(`Chat ID: ${dialog.id}, Title: ${dialog.title}`);
    });
  } catch (error) {
    console.error("Client get ChatsList Error:", error);
    handleTelegramError(error as Error);
  }
}

(async () => {
  await startClient();

  const checkConnectivity = async () => {
    try {
      await checkNetworkConnectivity();
      console.log("Network connectivity is good.");
      console.log("Client connected atatus :", client!.connected);
      if (client && client.connected) {
        console.log("Client is still connected");
        await messageEventProcress(client);
      } else {
        console.warn("Client is disconnected, attempting to reconnect...");
        await initializeSession();
        if (client && client.connected) {
          console.log("Client reconnected successfully :", client.connected);
          await messageEventProcress(client);
        } else {
          console.log("Failed to reconnect client");
          await restartService();
        }
      }
    } catch (error) {
      console.error("Network connectivity issue:", error);
      handleTelegramError(error as Error);
    }
  };
  setInterval(checkConnectivity, 200000); // Check every 2 minutes

  // Fetch and log user details
  const me = (await client!.getEntity("me")) as Api.User;
  const displayName = [me.firstName, me.lastName].filter(Boolean).join(" ");
  console.log(`Signed in successfully as ${displayName}`);
})();
