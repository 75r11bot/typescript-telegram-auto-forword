import fs from "fs";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { Api } from "telegram/tl";
import { ApiCall } from "./axsios/axsios.config";
import { processBonusCode, responseResult } from "./services";

dotenv.config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH || "";
const sourceChannelId = Number(process.env.SOURCE_CHANNEL_ID);
const destinationChannelId = Number(process.env.DESTINATION_CHANNEL_ID);
const phoneNumber = process.env.APP_YOUR_PHONE || "";
const userPassword = process.env.APP_YOUR_PWD || "";
const telegramChannelId = Number(process.env.TELEGRAM_CHANNEL_ID);
const port = Number(process.env.PORT) || 5000;
const reconnectInterval = 5000; // 5 seconds

const sessionsDirectory = "./sessions";
const sessionFilePath = `${sessionsDirectory}/session.txt`;

const MAX_RETRIES = 3;
const RETRY_INTERVAL = 5000; // 5 seconds

if (!fs.existsSync(sessionsDirectory)) {
  fs.mkdirSync(sessionsDirectory);
}

const sessionString = fs.existsSync(sessionFilePath)
  ? fs.readFileSync(sessionFilePath, "utf-8")
  : "";

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

function handleTelegramError(error: Error) {
  console.error("Telegram error:", error);
}

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
    }, 60000); // 60 seconds

    const handler = async (event: any) => {
      const message = event.message;
      console.log("Received message for login code:", message.message);

      if (message.peerId?.channelId?.equals(telegramChannelId)) {
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
      const message = event.message;

      const sourceEntity = await client.getEntity(sourceChannelId);
      const destinationEntity = await client.getEntity(destinationChannelId);
      const channelId = message.peerId?.channelId;

      console.log("Processing Bonus Code Check Data and Call Requests H25");
      const axiosInstance = await ApiCall(); // Initialize axiosInstance here
      await processBonusCode(axiosInstance, message.message);
      console.log("New message received: ", message);
      console.log(
        "Check message received: ",
        channelId && channelId.equals(sourceEntity.id)
      );

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
}

forwardNewMessages().catch((error) => {
  console.error("Error starting message forwarding:", error);
});

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
    setTimeout(startClient, reconnectInterval); // Retry after interval
  }
}

async function regenerateSession() {
  try {
    console.log("Regenerating session...");
    fs.unlinkSync(sessionFilePath); // Delete the session file
    await startClient();
  } catch (error) {
    console.error("Failed to regenerate session:", error);
    setTimeout(regenerateSession, reconnectInterval); // Retry after interval
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
    startAutoRestart(); // Call the auto-restart function on error
  }
}

// Auto-restart function
function startAutoRestart() {
  console.log("[Started reconnecting]");
  setTimeout(async () => {
    try {
      await restartService(); // Try to restart the service
    } catch (error) {
      console.error("Failed to reconnect:", error);
      startAutoRestart(); // Retry auto-restart after interval
    }
  }, reconnectInterval);
}

startService().catch((error) => {
  console.error("Unexpected error in startService:", error);
  startAutoRestart();
});

async function restartService() {
  let retries = 0;
  let connected = false;

  while (!connected && retries < MAX_RETRIES) {
    try {
      // Restart your service here
      await startService();
      console.log("Service restarted successfully.");
      connected = true; // Set connected to true if the service restarts successfully
    } catch (error) {
      console.error("Failed to restart service:", error);
      retries++;
      await wait(RETRY_INTERVAL); // Wait for a certain interval before retrying
    }
  }

  if (!connected) {
    console.error("Max retries reached. Unable to restart service.");
    // Optionally, perform additional actions like sending alerts or logging the failure
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
