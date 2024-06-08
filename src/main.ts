import fs from "fs";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { Api } from "telegram/tl";
import { ApiCall } from "./axios/axios.config";
import { processBonusCode, responseResult } from "./services";

dotenv.config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH || "";
const sourceChannelIds = process.env.SOURCE_CHANNEL_IDS
  ? process.env.SOURCE_CHANNEL_IDS.split(",").map((id) => id.trim())
  : [];
const destinationChannelId = process.env.DESTINATION_CHANNEL_ID || "";
const phoneNumber = process.env.APP_YOUR_PHONE || "";
const userPassword = process.env.APP_YOUR_PWD || "";
const port = Number(process.env.PORT) || 5000;
const sessionsDirectory = "./sessions";
const sessionFilePath = `${sessionsDirectory}/session.txt`;

const MAX_RETRIES = 5;
const INITIAL_RETRY_INTERVAL = 5000; // 5 seconds
let retryInterval = INITIAL_RETRY_INTERVAL;

if (!fs.existsSync(sessionsDirectory)) {
  fs.mkdirSync(sessionsDirectory);
}

const sessionString = fs.existsSync(sessionFilePath)
  ? fs.readFileSync(sessionFilePath, "utf-8")
  : "";

let client: TelegramClient;

async function initializeClient() {
  client = new TelegramClient(
    new StringSession(sessionString),
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
  }
}

async function getInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.once("data", (data) => resolve(data.toString().trim()));
  });
}

async function listChats() {
  try {
    console.log("Calling listChats...");
    await startClient();

    const dialogs = await client.getDialogs();

    for (const dialog of dialogs) {
      console.log(`Chat ID: ${dialog.id}, Title: ${dialog.title}`);
      // if (
      //   dialog.title === "H25 THAILAND 🇹🇭" ||
      //   dialog.title === "TestForwardMessage"
      // ) {
      //   sourceChannelIds.push(dialog.id);
      // }
    }
    console.log("listChats completed");

    // Once the sourceChannelIds are populated, call forwardNewMessages
  } catch (error) {
    console.error("Error listing chats:", error);
  }
}

async function forwardNewMessages() {
  try {
    console.log("Calling forwardNewMessages...");

    client.addEventHandler(async (event: any) => {
      try {
        const message = event.message;
        const channelId = message.peerId?.channelId;
        const channelIdAsString = channelId
          ? `-100${channelId.toString()}`
          : null;

        console.log("New message received: ", message.message);
        console.log("Message received from channelId: ", channelIdAsString);

        // console.log("Processing Bonus Codes Call Requests to H25");
        // const axiosInstance = await ApiCall();
        // await processBonusCode(axiosInstance, message.message);

        if (!channelIdAsString) {
          console.log("channelIdAsString is null, skipping this message.");
          return;
        }

        // Check if the message is from one of the source channels
        if (!sourceChannelIds.includes(channelIdAsString)) {
          console.log(
            "Message not from a source channel. Skipping forwarding."
          );
          return;
        }

        // Forward the message to the destination channel
        console.log(
          "Processing Forward the message to the destination channel"
        );
        await forwardMessage(message, channelIdAsString);

        console.log("Processing Bonus Codes Call Requests to H25");
        const axiosInstance = await ApiCall();
        await processBonusCode(axiosInstance, message.message);
      } catch (error: any) {
        console.error("Error handling new message event:", error);
        handleTelegramError(error);
      }
    }, new NewMessage({}));
  } catch (error) {
    console.error("Error setting up message forwarding:", error);
  }
}

async function forwardMessage(message: any, channelId: string) {
  const sourceEntity = await client.getEntity(channelId);
  const destinationEntity = await client.getEntity(destinationChannelId);

  console.log(
    `Forwarding message with ID ${message.id} from ${channelId} to ${destinationChannelId}`
  );
  await client.forwardMessages(destinationEntity, {
    fromPeer: sourceEntity,
    messages: [message.id],
  });
  console.log(`Message forwarded from ${channelId} to ${destinationChannelId}`);
}

async function startClient() {
  try {
    if (!client) {
      await initializeClient();
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
        }
      },
    });
    const me = (await client.getEntity("me")) as Api.User;
    const displayName = [me.firstName, me.lastName].filter(Boolean).join(" ");
    console.log(`Signed in successfully as ${displayName}`);
  } catch (error) {
    console.error("Failed to start client:", error);
    setTimeout(startClient, retryInterval);
  }
}

async function regenerateSession() {
  try {
    console.log("Regenerating session...");
    fs.unlinkSync(sessionFilePath);
    await initializeClient();
    await startClient();
  } catch (error) {
    console.error("Failed to regenerate session:", error);
    setTimeout(regenerateSession, retryInterval);
  }
}

async function restartDockerContainer() {
  console.log("Restarting Docker container...");
  try {
    const { execSync } = require("child_process");
    execSync("docker restart telegram-auto-forward-1");
    console.log("Docker container restarted successfully.");
  } catch (error) {
    console.error("Error restarting Docker container:", error);
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
      restartDockerContainer();
    } catch (error) {
      console.error("Error restarting Docker container:", error);
    }
  } else {
    retryInterval = INITIAL_RETRY_INTERVAL;
  }
}

async function startService() {
  try {
    const axiosInstance = await ApiCall();
    console.log(`======= Serving on http://0.0.0.0:${port} ======`);

    const app = express();
    app.use(express.json());

    app.get("/", (req: Request, res: Response) => {
      res.send(`
        <html>
          <body>
            <h1>Bonus Code H25 Response</h1>
            <pre>${JSON.stringify(responseResult, null, 2)}</pre>
          </body>
        </html>
      `);
    });

    app.listen(port, () => {
      console.log(`Server is running at http://0.0.0.0:${port}/`);
    });

    await listChats();
    await forwardNewMessages();
  } catch (error) {
    console.error("Error in main service:", error);
    retryConnection();
  }
}

startService().catch((error) => {
  console.error("Unexpected error in startService:", error);
  retryConnection();
});

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
