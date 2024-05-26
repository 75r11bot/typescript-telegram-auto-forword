import fs from "fs";
import dotenv from "dotenv";
import axios from "axios";
import axiosRetry from "axios-retry";
import express, { Request, Response } from "express";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { Api } from "telegram/tl";
import { processBonusCode, responseResult } from "./services";

dotenv.config();

// Environment Variables
const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH || "";
const sourceChannelId = Number(process.env.SOURCE_CHANNEL_ID);
const destinationChannelId = Number(process.env.DESTINATION_CHANNEL_ID);
const phoneNumber = process.env.APP_YOUR_PHONE || "";
const userPassword = process.env.APP_YOUR_PWD || "";
const telegramChannelId = Number(process.env.TELEGRAM_CHANNEL_ID);
const port = Number(process.env.PORT) || 5000;
const reconnectInterval = 5000; // Reconnect interval in milliseconds

const apiEndpoints: string[] = [];

// Ensure sessions directory exists
const sessionsDirectory = "./sessions";
if (!fs.existsSync(sessionsDirectory)) {
  fs.mkdirSync(sessionsDirectory);
}

// Load or create session file
const sessionFilePath = "./sessions/session.txt";
const sessionString = fs.existsSync(sessionFilePath)
  ? fs.readFileSync(sessionFilePath, "utf-8")
  : "";

// Initialize Telegram Client
const client = new TelegramClient(
  new StringSession(sessionString),
  apiId,
  apiHash,
  {
    connectionRetries: 10,
    timeout: 86400000, // 24 hours
    useWSS: true,
  }
);

// Axios retry configuration
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => {
    return retryCount * 1000; // time interval between retries
  },
  retryCondition: (error) => {
    if (
      error.code === "ECONNABORTED" ||
      (error.response && error.response.status >= 500)
    ) {
      return true;
    }
    return false; // Ensure the function returns a boolean
  },
});

// Function to get user input
async function getInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.once("data", (data) => resolve(data.toString().trim()));
  });
}

// Function to get login code from Telegram messages
async function getLoginCode(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout")), 60000);

    const handler = async (event: any) => {
      const message = event.message;
      if (message.peerId?.channelId?.equals(telegramChannelId)) {
        const match = message.message.match(/(\d{5,6})/);
        if (match) {
          clearTimeout(timeout);
          client.removeEventHandler(handler, new NewMessage({}));
          resolve(match[1]);
        }
      }
    };

    client.addEventHandler(handler, new NewMessage({}));
  }).catch(async (error) => {
    console.error("Error getting login code:", error);
    return await getInput("Enter the code: ");
  });
}

// Function to list all chats
async function listChats() {
  await startClient();
  const dialogs = await client.getDialogs();
  dialogs.forEach((dialog) =>
    console.log(`Chat ID: ${dialog.id}, Title: ${dialog.title}`)
  );
}

// Function to forward new messages
async function forwardNewMessages() {
  console.log("Process subscribed message to auto forward successfully");
  await startClient();

  const session = client.session.save();
  if (typeof session === "string") {
    await fs.promises.writeFile(sessionFilePath, session);
  } else {
    console.error("Session is not a string:", session);
  }

  client.addEventHandler(async (event: any) => {
    try {
      const sourceEntity = await client.getEntity(sourceChannelId);
      const destinationEntity = await client.getEntity(destinationChannelId);
      const message = event.message;
      const peerId = message.peerId;

      if (peerId?.channelId?.equals(sourceEntity.id)) {
        await processBonusCode(apiEndpoints, message.message);
        await client.forwardMessages(destinationEntity, {
          fromPeer: sourceEntity,
          messages: [message.id],
        });
        console.log(
          `Message forwarded from ${sourceChannelId} to ${destinationChannelId}`
        );
      } else {
        console.log(
          "New message received from the source channel, cannot forward it to the destination channel"
        );
      }
    } catch (error: any) {
      handleForwardingError(error);
    }
  }, new NewMessage({}));
}

// Error handling for message forwarding
function handleForwardingError(error: any) {
  console.error("Error handling new message event:", error);
  if (error.message.includes("FloodWait")) {
    console.error(
      "FloodWait error: Too many requests in a short period. Try again later."
    );
  } else if (
    error.message.includes("ChatWriteForbidden") ||
    error.message.includes("ChatForbidden")
  ) {
    console.error(
      "ChatWriteForbidden error: Bot or user does not have permission to write to the destination channel"
    );
  } else if (
    error.message.includes("MessageNotModified") ||
    error.message.includes("WebPageNotModified")
  ) {
    console.error(
      "MessageNotModified error: Message content has not been modified"
    );
  } else {
    console.error("Unexpected error:", error);
  }
}

// Function to ping endpoints
async function pingEndpoints() {
  const endpoints = [
    process.env.API_ENDPOINT_1,
    // Add more endpoints as needed
  ].filter(Boolean) as string[];

  const siteId = "1451470260579512322";
  const siteCode = "ybaxcf-4";
  const platformType = "2";
  const token = process.env.H25_TOKEN1; // Replace with actual token

  const headers = {
    token: token,
    Accept: "application/json, text/plain, */*",
  };

  for (const endpoint of endpoints) {
    try {
      const url = `${endpoint}/v/user/refreshUserFund?siteId=${siteId}&siteCode=${siteCode}&platformType=${platformType}`;
      const response = await axios.get(url, { headers });
      if (response.status === 200) {
        apiEndpoints.push(endpoint);
        if (response.data.code === 10000) {
          console.log(`Token ${token} is ready.`);
        } else if (response.data.code === 10140) {
          console.log(`Token ${token} is expired.`);
        }
      } else {
        console.error(
          `Endpoint ${endpoint} is not reachable. Status code: ${response.status}`
        );
      }
    } catch (error: any) {
      console.error(`Error connecting to ${endpoint}: ${error}`);
    }
  }
}

// Function to start Telegram client
async function startClient() {
  try {
    await client.start({
      phoneNumber: async () => phoneNumber,
      password: async () => userPassword,
      phoneCode: async () => await getLoginCode(),
      onError: handleClientError,
    });
    const me = (await client.getEntity("me")) as Api.User;
    const displayName = [me.firstName, me.lastName].filter(Boolean).join(" ");
    console.log(`Signed in successfully as ${displayName}`);
  } catch (error) {
    console.error("Failed to start client:", error);
    setTimeout(startClient, 5000); // Retry
  }
}

// Handle errors during client start
function handleClientError(err: Error) {
  if (err.message.includes("AUTH_KEY_DUPLICATED")) {
    console.log("AUTH_KEY_DUPLICATED error detected. Regenerating session...");
    regenerateSession();
  } else {
    console.log("Client start error:", err);
  }
}

// Regenerate session on AUTH_KEY_DUPLICATED error
async function regenerateSession() {
  try {
    console.log("Regenerating session...");
    await startClient();
  } catch (error) {
    console.error("Failed to regenerate session:", error);
    setTimeout(regenerateSession, 5000); // Retry after 5 seconds
  }
}

// Reconnection logic
function startReconnect() {
  console.log("[Started reconnecting]");
  setTimeout(async () => {
    try {
      await startClient();
    } catch (error) {
      console.error("Failed to reconnect:", error);
      startReconnect();
    }
  }, reconnectInterval);
}

// Main function to start the bot
async function main() {
  await pingEndpoints();
  console.log(`======= Serving on http://0.0.0.0:${port}/ ======`);
  await listChats();
  await forwardNewMessages();
  startReconnect();
}

// Express setup
const app = express();

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
  main().catch(console.error);
});
