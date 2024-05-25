import fs from "fs";
import dotenv from "dotenv";
import axios from "axios";
import express, { Request, Response } from "express";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { Api } from "telegram/tl";
import { processBonusCode, responseResult } from "./services";

dotenv.config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH || "";
const sourceChannelId = Number(process.env.TEST_SOURCE_CHANNEL_ID);
const destinationChannelId = Number(process.env.DESTINATION_CHANNEL_ID);
const phoneNumber = process.env.APP_YOUR_PHONE || "";
const userPassword = process.env.APP_YOUR_PWD || "";
const telegramChannelId = Number(process.env.TELEGRAM_CHANNEL_ID);
const port = Number(process.env.PORT) || 5000;

const apiEndpoints: string[] = [];

const sessionsDirectory = "./sessions";

if (!fs.existsSync(sessionsDirectory)) {
  fs.mkdirSync(sessionsDirectory);
}

const sessionFilePath = "./sessions/session.txt";
const sessionString = fs.existsSync(sessionFilePath)
  ? fs.readFileSync(sessionFilePath, "utf-8")
  : "";

const client = new TelegramClient(
  new StringSession(sessionString),
  apiId,
  apiHash,
  {
    connectionRetries: 10,
    timeout: 86400000, // Set timeout to a large number (e.g., 24 hours)
    useWSS: true,
  }
);

async function get_input(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.once("data", (data) => resolve(data.toString().trim()));
  });
}

async function getLoginCode(): Promise<string> {
  return new Promise<string>(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout"));
    }, 60000); // Timeout after 60 seconds

    const handler = async (event: any) => {
      const message = event.message;
      console.log("Received message for login code:", message.message);

      if (
        message.peerId &&
        message.peerId.channelId &&
        message.peerId.channelId.equals(telegramChannelId)
      ) {
        const match = message.message.match(/(\d{5,6})/);
        if (match) {
          clearTimeout(timeout); // Clear the timeout
          client.removeEventHandler(handler, new NewMessage({})); // Remove the handler
          resolve(match[1]);
        }
      }
    };

    client.addEventHandler(handler, new NewMessage({}));
  }).catch(async (error) => {
    console.error("Error getting login code:", error);
    return await get_input("Enter the code: ");
  });
}

async function listChats() {
  await startClient();

  const dialogs = await client.getDialogs();
  for (const dialog of dialogs) {
    console.log(`Chat ID: ${dialog.id}, Title: ${dialog.title}`);
  }
}

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

      console.log("Source Entity:", sourceEntity);
      console.log("Destination Entity:", destinationEntity);

      const message = event.message;
      const peerId = message.peerId;
      const channelId = peerId && peerId.channelId;

      if (channelId && channelId.equals(sourceEntity.id)) {
        console.log(
          `Forwarding message with ID ${message.id} from ${sourceChannelId} to ${destinationChannelId}`
        );

        await client.forwardMessages(destinationEntity, {
          fromPeer: sourceEntity,
          messages: [message.id],
        });

        console.log(
          `Message forwarded from ${sourceChannelId} to ${destinationChannelId}`
        );

        await processBonusCode(apiEndpoints, message.message);
        console.log("processBonusCode called successfully");
      } else {
        console.log(
          "New Message received from the source channel, cannot forward it to the destination channel"
        );
      }
    } catch (error: any) {
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
  }, new NewMessage({}));
}

async function pingEndpoints() {
  const endpoints = [
    process.env.API_ENDPOINT_1,
    process.env.API_ENDPOINT_2,
    process.env.API_ENDPOINT_3,
  ].filter(Boolean) as string[];

  const siteId = "1451470260579512322";
  const siteCode = "ybaxcf-4";
  const platformType = "2";
  const token = process.env.H25_TOKEN1; // Replace YOUR_TOKEN_HERE with the actual token

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
          const token = process.env.H25_TOKEN2; // Replace YOUR_TOKEN_HERE with the actual token
          console.log(`Token ${token} is expired.`);
        }
      } else {
        console.error(
          `Endpoint ${endpoint} is not reachable. Status code: ${response.status}`
        );
      }
    } catch (error) {
      console.error(`Error connecting to ${endpoint}: ${error}`);
    }
  }
}

async function startClient() {
  try {
    await client.start({
      phoneNumber: async () => phoneNumber,
      password: async () => userPassword,
      phoneCode: async () => await getLoginCode(),
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
    setTimeout(startClient, 5000); // Retry
  }
}

async function regenerateSession() {
  try {
    console.log("Regenerating session...");
    await startClient();
  } catch (error) {
    console.error("Failed to regenerate session:", error);
    setTimeout(regenerateSession, 5000); // Retry after 5 seconds
  }
}

async function main() {
  await pingEndpoints();
  console.log(`======= Serving on http://0.0.0.0:${port}/ ======`);
  await listChats();
  await forwardNewMessages();
}

const app = express();

app.get("/", (req: Request, res: Response) => {
  res.send(`
    <html>
      <body>
        <h1>โค้ดโบนัส H25 Response</h1>
        <pre>${JSON.stringify(responseResult, null, 2)}</pre>
      </body>
    </html>
  `); // Display responseResult in a formatted way
});

app.listen(port, () => {
  console.log(`Server is running at http://0.0.0.0:${port}/`);
  main().catch(console.error);
});
