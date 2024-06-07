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
  ? process.env.SOURCE_CHANNEL_IDS.split(",").map((id) => Number(id.trim()))
  : [];
const destinationChannelId = Number(process.env.DESTINATION_CHANNEL_ID);
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
  try {
    client = new TelegramClient(
      new StringSession(sessionString),
      apiId,
      apiHash,
      {
        connectionRetries: 5, // Disable internal retries
        timeout: 86400000, // 24 hours
        useWSS: true,
      }
    );
    console.log("Telegram client initialized successfully.");
  } catch (error: any) {
    console.error("Failed to initialize Telegram client:", error.message);
    setTimeout(initializeClient, 5000); // Retry after 5 seconds
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

async function getInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.once("data", (data) => resolve(data.toString().trim()));
  });
}

async function listChats() {
  try {
    console.log("Calling listChats...");
    console.log("Listing chats...");
    await startClient();

    const dialogs = await client.getDialogs();
    for (const dialog of dialogs) {
      console.log(`Chat ID: ${dialog.id}, Title: ${dialog.title}`);
    }
    console.log("listChats completed");
  } catch (error) {
    console.error("Error listing chats:", error);
  }
}

async function forwardNewMessages() {
  try {
    console.log("Calling forwardNewMessages...");
    console.log("Setting up message forwarding...");
    await startClient();

    const session = client.session.save();
    if (typeof session === "string") {
      await fs.promises.writeFile(sessionFilePath, session);
    } else {
      console.error("Session is not a string:", session);
    }

    client.addEventHandler(async (event: any) => {
      try {
        const message = event.message;
        const channelId = message.peerId?.channelId;

        console.log("Processing Bonus Code Check Data and Call Requests H25");
        const axiosInstance = await ApiCall(); // Initialize axiosInstance here
        await processBonusCode(axiosInstance, message.message);
        console.log("New message received: ", message.message);
        console.log(
          "Check message received: ",
          channelId && sourceChannelIds.includes(channelId)
        );

        if (channelId && sourceChannelIds.includes(channelId)) {
          await forwardMessage(message, channelId);
        } else {
          console.log(
            "New message received from a different source, cannot forward it to the destination channel"
          );
        }
      } catch (error: any) {
        console.error("Error handling new message event:", error);
        handleTelegramError(error);
      }
    }, new NewMessage({}));
  } catch (error) {
    console.error("Error setting up message forwarding:", error);
  }
  await startClient();
}

async function forwardMessage(message: any, channelId: number) {
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
    await initializeClient();
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
    setTimeout(startClient, retryInterval); // Retry after interval
  }
}

async function regenerateSession() {
  try {
    console.log("Regenerating session...");
    fs.unlinkSync(sessionFilePath); // Delete the session file
    await initializeClient();
    await startClient();
  } catch (error) {
    console.error("Failed to regenerate session:", error);
    setTimeout(regenerateSession, retryInterval); // Retry after interval
  }
}

async function restartDockerContainer() {
  console.log("Restarting Docker container...");
  try {
    const { execSync } = require("child_process");
    execSync("docker restart telegram-auto-forword-telegram-auto-forward-1");
    console.log("Docker container restarted successfully.");
  } catch (error) {
    console.error("Error restarting Docker container:", error);
    // Handle the error appropriately, such as logging or retrying
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
      restartDockerContainer(); // Restart Docker container if max retries reached
    } catch (error) {
      console.error("Error restarting Docker container:", error);
      // Handle the error appropriately
    }
  } else {
    retryInterval = INITIAL_RETRY_INTERVAL; // Reset the retry interval
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
    retryConnection(); // Retry connection after Docker container restart
  }
}

// Entry point of the application
startService().catch((error) => {
  console.error("Unexpected error in startService:", error);
  retryConnection();
});

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
