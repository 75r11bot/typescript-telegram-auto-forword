"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
const axios_1 = __importDefault(require("axios"));
const express_1 = __importDefault(require("express"));
const telegram_1 = require("telegram");
const sessions_1 = require("telegram/sessions");
const events_1 = require("telegram/events");
const tl_1 = require("telegram/tl");
const services_1 = require("./services");
dotenv_1.default.config();
const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH || "";
const sourceChannelId = Number(process.env.TEST_SOURCE_CHANNEL_ID);
const destinationChannelId = Number(process.env.DESTINATION_CHANNEL_ID);
const phoneNumber = process.env.APP_YOUR_PHONE || "";
const userPassword = process.env.APP_YOUR_PWD || "";
const telegramChannelId = Number(process.env.TELEGRAM_CHANNEL_ID);
const port = Number(process.env.PORT) || 5000;
const apiEndpoints = [];
const sessionFilePath = "./sessions/session.txt";
const sessionString = fs_1.default.existsSync(sessionFilePath)
    ? fs_1.default.readFileSync(sessionFilePath, "utf-8")
    : "";
const client = new telegram_1.TelegramClient(new sessions_1.StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 10,
    timeout: 86400000, // Set timeout to a large number (e.g., 24 hours)
    useWSS: true,
});
function get_input(prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => {
            process.stdout.write(prompt);
            process.stdin.on("data", (data) => resolve(data.toString().trim()));
        });
    });
}
function getLoginCode() {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            const timeout = setTimeout(() => {
                reject(new Error("Timeout"));
            }, 30000); // Timeout after 30 seconds
            const handler = (event) => {
                const message = event.message;
                console.log("getLoginCode: received message", message);
                if ("chatId" in message && message.chatId === telegramChannelId) {
                    const match = message.message.match(/Login code: (\d+)/);
                    if (match) {
                        clearTimeout(timeout); // Clear the timeout
                        client.removeEventHandler(handler, new events_1.NewMessage({})); // Remove the handler
                        resolve(match[1]);
                    }
                }
            };
            client.addEventHandler(handler, new events_1.NewMessage({}));
        })).catch((error) => __awaiter(this, void 0, void 0, function* () {
            console.error("Error getting login code:", error);
            // Handle error or prompt user for login code input
            return yield get_input("Enter the code: ");
        }));
    });
}
function listChats() {
    return __awaiter(this, void 0, void 0, function* () {
        yield startClient();
        const dialogs = yield client.getDialogs();
        for (const dialog of dialogs) {
            console.log(`Chat ID: ${dialog.id}, Title: ${dialog.title}`);
        }
    });
}
function forwardNewMessages() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Process subscribed message to auto forward successfully");
        yield startClient();
        const session = client.session.save();
        if (typeof session === "string") {
            yield fs_1.default.promises.writeFile(sessionFilePath, session);
        }
        else {
            console.error("Session is not a string:", session);
        }
        client.addEventHandler((event) => __awaiter(this, void 0, void 0, function* () {
            try {
                const sourceEntity = yield client.getEntity(sourceChannelId);
                const destinationEntity = yield client.getEntity(destinationChannelId);
                console.log("Source Entity:", sourceEntity);
                console.log("Destination Entity:", destinationEntity);
                // Check if the message is from the correct source channel
                if (event.message &&
                    event.message.peerId &&
                    event.message.peerId.channelId.equals(sourceEntity.id)) {
                    console.log(`Forwarding message with ID ${event.message.id} from ${sourceChannelId} to ${destinationChannelId}`);
                    // Forward the message to the destination channel
                    yield client.forwardMessages(destinationEntity, {
                        fromPeer: sourceEntity,
                        messages: [event.message.id],
                    });
                    console.log(`Message forwarded from ${sourceChannelId} to ${destinationChannelId}`);
                    // Call processBonusCode function
                    yield (0, services_1.processBonusCode)(apiEndpoints, event.message.message);
                    console.log("processBonusCode called successfully");
                }
                else {
                    console.log("New Message received from the source channel, cannot forward it to the destination channel");
                }
            }
            catch (error) {
                console.error("Error handling new message event:", error);
                // Check specific error types
                if (error instanceof tl_1.Api.errors.FloodWait) {
                    // Handle FloodWait error
                }
                else if (error instanceof tl_1.Api.errors.ChatWriteForbidden) {
                    console.error("ChatWriteForbidden error: Bot or user does not have permission to write to the destination channel");
                }
                else if (error instanceof tl_1.Api.errors.MessageNotModified) {
                    console.error("MessageNotModified error: Message content has not been modified");
                }
                else {
                    console.error("Unexpected error:", error);
                }
            }
        }), new events_1.NewMessage({}));
    });
}
function pingEndpoints() {
    return __awaiter(this, void 0, void 0, function* () {
        const endpoints = [
            process.env.API_ENDPOINT_1,
            // process.env.API_ENDPOINT_2,
            // process.env.API_ENDPOINT_3,
        ].filter(Boolean);
        for (const endpoint of endpoints) {
            try {
                const response = yield axios_1.default.get(endpoint);
                if (response.status === 200) {
                    apiEndpoints.push(endpoint);
                    console.log(`Endpoint ${endpoint} is reachable.`);
                }
                else {
                    console.error(`Endpoint ${endpoint} is not reachable. Status code: ${response.status}`);
                }
            }
            catch (error) {
                console.error(`Error connecting to ${endpoint}: ${error}`);
            }
        }
    });
}
function startClient() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield client.start({
                phoneNumber: () => __awaiter(this, void 0, void 0, function* () { return phoneNumber; }),
                password: () => __awaiter(this, void 0, void 0, function* () { return userPassword; }),
                phoneCode: () => __awaiter(this, void 0, void 0, function* () { return yield getLoginCode(); }),
                onError: (err) => console.log("Client start error:", err),
            });
            const me = (yield client.getEntity("me"));
            const displayName = [me.firstName, me.lastName].filter(Boolean).join(" ");
            console.log(`Signed in successfully as ${displayName}`);
        }
        catch (error) {
            console.error("Failed to start client:", error);
            setTimeout(startClient, 5000); // Retry after 5 seconds
        }
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        yield pingEndpoints();
        console.log(`======= Serving on http://0.0.0.0:${port}/ ======`);
        yield listChats();
        yield forwardNewMessages();
    });
}
const app = (0, express_1.default)();
app.get("/", (req, res) => {
    res.send(`
    <html>
      <body>
        <h1>โค้ดโบนัส H25 Response</h1>
        <pre>${JSON.stringify(services_1.responseResult, null, 2)}</pre>
      </body>
    </html>
  `); // Display responseResult in a formatted way
});
app.listen(port, () => {
    console.log(`Server is running at http://0.0.0.0:${port}/`);
    main().catch(console.error);
});
