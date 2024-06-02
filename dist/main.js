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
const express_1 = __importDefault(require("express"));
const telegram_1 = require("telegram");
const sessions_1 = require("telegram/sessions");
const events_1 = require("telegram/events");
const axios_config_1 = require("./axios/axios.config");
const services_1 = require("./services");
dotenv_1.default.config();
const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH || "";
const sourceChannelId = Number(process.env.SOURCE_CHANNEL_ID);
const destinationChannelId = Number(process.env.DESTINATION_CHANNEL_ID);
const phoneNumber = process.env.APP_YOUR_PHONE || "";
const userPassword = process.env.APP_YOUR_PWD || "";
const telegramChannelId = Number(process.env.TELEGRAM_CHANNEL_ID);
const port = Number(process.env.PORT) || 5000;
const sessionsDirectory = "./sessions";
const sessionFilePath = `${sessionsDirectory}/session.txt`;
const MAX_RETRIES = 5;
const INITIAL_RETRY_INTERVAL = 5000; // 5 seconds
let retryInterval = INITIAL_RETRY_INTERVAL;
if (!fs_1.default.existsSync(sessionsDirectory)) {
    fs_1.default.mkdirSync(sessionsDirectory);
}
const sessionString = fs_1.default.existsSync(sessionFilePath)
    ? fs_1.default.readFileSync(sessionFilePath, "utf-8")
    : "";
let client;
function initializeClient() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            client = new telegram_1.TelegramClient(new sessions_1.StringSession(sessionString), apiId, apiHash, {
                connectionRetries: 5, // Disable internal retries
                timeout: 86400000, // 24 hours
                useWSS: true,
            });
            console.log("Telegram client initialized successfully.");
        }
        catch (error) {
            console.error("Failed to initialize Telegram client:", error.message);
            setTimeout(initializeClient, 5000); // Retry after 5 seconds
        }
    });
}
function handleTelegramError(error) {
    return __awaiter(this, void 0, void 0, function* () {
        console.error("Telegram error:", error);
        if (error.message.includes("ECONNREFUSED")) {
            console.log("Connection refused, retrying...");
            retryConnection();
        }
        else {
            console.log("Unhandled error, restarting client...");
            setTimeout(startClient, retryInterval);
        }
    });
}
function getInput(prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => {
            process.stdout.write(prompt);
            process.stdin.once("data", (data) => resolve(data.toString().trim()));
        });
    });
}
function getLoginCode() {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Timeout"));
            }, 60000); // 60 seconds
            const handler = (event) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                const message = event.message;
                console.log("Received message for login code:", message.message);
                if ((_b = (_a = message.peerId) === null || _a === void 0 ? void 0 : _a.channelId) === null || _b === void 0 ? void 0 : _b.equals(telegramChannelId)) {
                    const match = message.message.match(/(\d{5,6})/);
                    if (match) {
                        clearTimeout(timeout); // Clear the timeout
                        client.removeEventHandler(handler, new events_1.NewMessage({})); // Remove the handler
                        resolve(match[1]);
                    }
                }
            });
            client.addEventHandler(handler, new events_1.NewMessage({}));
        }).catch((error) => __awaiter(this, void 0, void 0, function* () {
            console.error("Error getting login code:", error);
            return yield getInput("Enter the code: ");
        }));
    });
}
function listChats() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log("Calling listChats..."); // เพิ่มบรรทัดนี้
            console.log("Listing chats...");
            yield startClient();
            const dialogs = yield client.getDialogs();
            for (const dialog of dialogs) {
                console.log(`Chat ID: ${dialog.id}, Title: ${dialog.title}`);
            }
            console.log("listChats completed"); // เพิ่มบรรทัดนี้
        }
        catch (error) {
            console.error("Error listing chats:", error);
        }
    });
}
function forwardNewMessages() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log("Calling forwardNewMessages..."); // เพิ่มบรรทัดนี้
            console.log("Setting up message forwarding...");
            yield startClient();
            const session = client.session.save();
            if (typeof session === "string") {
                yield fs_1.default.promises.writeFile(sessionFilePath, session);
            }
            else {
                console.error("Session is not a string:", session);
            }
            client.addEventHandler((event) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                try {
                    const message = event.message;
                    const sourceEntity = yield client.getEntity(sourceChannelId);
                    const destinationEntity = yield client.getEntity(destinationChannelId);
                    const channelId = (_a = message.peerId) === null || _a === void 0 ? void 0 : _a.channelId;
                    console.log("Processing Bonus Code Check Data and Call Requests H25");
                    const axiosInstance = yield (0, axios_config_1.ApiCall)(); // Initialize axiosInstance here
                    yield (0, services_1.processBonusCode)(axiosInstance, message.message);
                    console.log("New message received: ", message);
                    console.log("Check message received: ", channelId && channelId.equals(sourceEntity.id));
                    if (channelId && channelId.equals(sourceEntity.id)) {
                        console.log(`Forwarding message with ID ${message.id} from ${sourceChannelId} to ${destinationChannelId}`);
                        yield client.forwardMessages(destinationEntity, {
                            fromPeer: sourceEntity,
                            messages: [message.id],
                        });
                        console.log(`Message forwarded from ${sourceChannelId} to ${destinationChannelId}`);
                    }
                    else {
                        console.log("New message received from a different source, cannot forward it to the destination channel");
                    }
                }
                catch (error) {
                    console.error("Error handling new message event:", error);
                    handleTelegramError(error);
                }
            }), new events_1.NewMessage({}));
            console.log("forwardNewMessages completed"); // เพิ่มบรรทัดนี้
        }
        catch (error) {
            console.error("Error setting up message forwarding:", error);
        }
    });
}
function startClient() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield initializeClient();
            yield client.start({
                phoneNumber: () => __awaiter(this, void 0, void 0, function* () { return phoneNumber; }),
                password: () => __awaiter(this, void 0, void 0, function* () { return userPassword; }),
                phoneCode: () => __awaiter(this, void 0, void 0, function* () { return yield getLoginCode(); }),
                onError: (err) => {
                    if (err.message.includes("AUTH_KEY_DUPLICATED")) {
                        console.log("AUTH_KEY_DUPLICATED error detected. Regenerating session...");
                        regenerateSession();
                    }
                    else {
                        console.log("Client start error:", err);
                    }
                },
            });
            const me = (yield client.getEntity("me"));
            const displayName = [me.firstName, me.lastName].filter(Boolean).join(" ");
            console.log(`Signed in successfully as ${displayName}`);
        }
        catch (error) {
            console.error("Failed to start client:", error);
            setTimeout(startClient, retryInterval); // Retry after interval
        }
    });
}
function regenerateSession() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log("Regenerating session...");
            fs_1.default.unlinkSync(sessionFilePath); // Delete the session file
            yield initializeClient();
            yield startClient();
        }
        catch (error) {
            console.error("Failed to regenerate session:", error);
            setTimeout(regenerateSession, retryInterval); // Retry after interval
        }
    });
}
function retryConnection() {
    return __awaiter(this, void 0, void 0, function* () {
        let retries = 0;
        let connected = false;
        while (!connected && retries < MAX_RETRIES) {
            try {
                yield startClient();
                console.log("Service restarted successfully.");
                connected = true;
            }
            catch (error) {
                console.error(`Retry attempt ${retries + 1} failed:`, error);
                retries++;
                yield wait(retryInterval);
                retryInterval *= 2; // Exponential backoff
            }
        }
        if (!connected) {
            console.error("Max retries reached. Unable to restart service. Exiting...");
            process.exit(1); // Exit process to trigger Docker restart
        }
        else {
            retryInterval = INITIAL_RETRY_INTERVAL; // Reset the retry interval
        }
    });
}
function startService() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const axiosInstance = yield (0, axios_config_1.ApiCall)();
            console.log(`======= Serving on http://0.0.0.0:${port} ======`);
            const app = (0, express_1.default)();
            app.use(express_1.default.json());
            app.get("/", (req, res) => {
                res.send(`
        <html>
          <body>
            <h1>Bonus Code H25 Response</h1>
            <pre>${JSON.stringify(services_1.responseResult, null, 2)}</pre>
          </body>
        </html>
      `);
            });
            app.listen(port, () => {
                console.log(`Server is running at http://0.0.0.0:${port}/`);
            });
            yield listChats();
            yield forwardNewMessages();
        }
        catch (error) {
            console.error("Error in main service:", error);
            retryConnection();
        }
    });
}
// Entry point of the application
startService().catch((error) => {
    console.error("Unexpected error in startService:", error);
    retryConnection();
});
function wait(ms) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => setTimeout(resolve, ms));
    });
}
