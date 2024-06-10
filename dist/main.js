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
const axios_1 = __importDefault(require("axios"));
const tl_1 = require("telegram/tl");
const axios_config_1 = require("./axios/axios.config");
const bot_1 = require("./bot");
const services_1 = require("./services");
dotenv_1.default.config();
const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH || "";
const sourceChannelIds = process.env.SOURCE_CHANNEL_IDS
    ? process.env.SOURCE_CHANNEL_IDS.split(",").map((id) => id.trim())
    : [];
const destinationChannelId = process.env.DESTINATION_CHANNEL_ID || "";
const responesChannelId = process.env.RESPONSE_CHANNEL_ID || "";
const phoneNumber = process.env.APP_YOUR_PHONE || "";
const userPassword = process.env.APP_YOUR_PWD || "";
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
let axiosInstance;
let expressServer; // Define a variable to store the Express server instance
function initializeClient() {
    return __awaiter(this, void 0, void 0, function* () {
        client = new telegram_1.TelegramClient(new sessions_1.StringSession(sessionString), apiId, apiHash, {
            connectionRetries: 5,
            timeout: 86400000, // 24 hours
            useWSS: true,
        });
        console.log("Telegram client initialized successfully.");
    });
}
function handleTelegramError(error) {
    return __awaiter(this, void 0, void 0, function* () {
        console.error("Telegram error:", error);
        if (error.message.includes("ECONNREFUSED") ||
            error.message.includes("TIMEOUT")) {
            console.log("Connection issue, retrying...");
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
function listChats() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log("Calling listChats...");
            yield startClient();
            const dialogs = yield client.getDialogs();
            for (const dialog of dialogs) {
                console.log(`Chat ID: ${dialog.id}, Title: ${dialog.title}`);
            }
        }
        catch (error) {
            console.error("Error listing chats:", error);
        }
    });
}
function forwardNewMessages(axiosInstance) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log("Initializing message forwarding...");
            yield client.connect(); // Ensure the client is connected before handling messages
            client.addEventHandler((event) => __awaiter(this, void 0, void 0, function* () {
                try {
                    const message = event.message;
                    const peer = message.peerId; // Assert the peerId type
                    console.log("client received new message: ", message.message);
                    console.log("instanceof peer: ", peer instanceof tl_1.Api.PeerChannel);
                    if (peer instanceof tl_1.Api.PeerChannel) {
                        const channelId = peer.channelId;
                        const channelIdAsString = `-100${channelId.toString()}`;
                        console.log("Received message from channel ID:", channelIdAsString);
                        // Forward the message to the destination channel
                        console.log("Forwarding the message to the destination channel");
                        yield forwardMessage(message, channelIdAsString);
                        //Check if the message is from one of the source channels
                        console.log("Check if the message is from one of the source channels:", sourceChannelIds.includes(channelIdAsString));
                        if (sourceChannelIds.includes(channelIdAsString)) {
                            // Processing Bonus Codes Call Requests to H25
                            console.log("Processing Bonus Codes Call Requests to H25");
                            yield (0, services_1.processBonusCode)(axiosInstance, message.message);
                            // Send responseResult to the destination channel
                            yield sendMessageToDestinationChannel();
                        }
                    }
                    else {
                        console.log("Peer is not a channel, skipping this message.");
                    }
                }
                catch (error) {
                    console.error("Error handling new message event:", error);
                    handleTelegramError(error); // Use type assertion
                }
            }), new events_1.NewMessage({}));
            console.log("Message forwarding initialized successfully.");
        }
        catch (error) {
            console.error("Error setting up message forwarding:", error);
            handleTelegramError(error); // Use type assertion
        }
    });
}
function forwardMessage(message, channelId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const sourceEntity = yield client.getEntity(channelId);
            const destinationEntity = yield client.getEntity(destinationChannelId);
            yield client.forwardMessages(destinationEntity, {
                fromPeer: sourceEntity,
                messages: [message.id],
            });
            console.log(`Message forwarded from ${channelId} to ${destinationChannelId}`);
        }
        catch (error) {
            console.error(`Error forwarding message from ${channelId} to ${destinationChannelId}:`, error);
        }
    });
}
function sendMessageToDestinationChannel() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const destinationEntity = yield client.getEntity(responesChannelId);
            if (services_1.responseResult.length > 0) {
                const formattedResponse = services_1.responseResult
                    .map((result, index) => {
                    return (`**Result ${index + 1}**\n` +
                        `Code: \`${result.code}\`\n` +
                        `Message: \`${result.message}\`\n` +
                        `Details: \`${JSON.stringify(result.data, null, 2)}\`\n`);
                })
                    .join("\n");
                const responseMessage = `Bonus Code H25 Response:\n${formattedResponse}`;
                yield client.sendMessage(destinationEntity, {
                    message: responseMessage,
                    parseMode: "markdown",
                });
                console.log(`Response message sent to ${destinationChannelId}`);
            }
        }
        catch (error) {
            console.error(`Error sending response message to ${destinationChannelId}:`, error);
        }
    });
}
function startClient() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!client) {
                yield initializeClient();
            }
            yield client.start({
                phoneNumber: () => __awaiter(this, void 0, void 0, function* () { return phoneNumber; }),
                password: () => __awaiter(this, void 0, void 0, function* () { return userPassword; }),
                phoneCode: () => __awaiter(this, void 0, void 0, function* () { return yield getInput("Enter the code: "); }),
                onError: (err) => {
                    if (err.message.includes("AUTH_KEY_DUPLICATED")) {
                        console.log("AUTH_KEY_DUPLICATED error detected. Regenerating session...");
                        regenerateSession();
                    }
                    else {
                        console.log("Client start error:", err);
                        handleTelegramError(err);
                    }
                },
            });
            const me = (yield client.getEntity("me"));
            const displayName = [me.firstName, me.lastName].filter(Boolean).join(" ");
            console.log(`Signed in successfully as ${displayName}`);
        }
        catch (error) {
            console.error("Failed to start client:", error);
            yield retryConnection();
        }
    });
}
function regenerateSession() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log("Regenerating session...");
            fs_1.default.unlinkSync(sessionFilePath);
            yield initializeClient();
            yield startClient();
        }
        catch (error) {
            console.error("Failed to regenerate session:", error);
            setTimeout(regenerateSession, retryInterval);
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
            try {
                yield (0, services_1.executeNetworkCommands)();
                // restartDockerContainer();
            }
            catch (error) {
                console.error("Error restarting Docker container:", error);
            }
        }
        else {
            retryInterval = INITIAL_RETRY_INTERVAL;
        }
    });
}
function startService() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!axiosInstance) {
                axiosInstance = yield (0, axios_config_1.ApiCall)();
            }
            console.log(`======= Serving on http://0.0.0.0:${port} ======`);
            const app = (0, express_1.default)();
            app.use(express_1.default.json());
            app.get("/", (req, res) => {
                res.send(`
        <html>
          <head><title>Telegram Forwarder Service</title></head>
          <body>
            <h1>Telegram Forwarder Service</h1>
            <p>Service is running and ready to forward messages.</p>
            <ul>
              ${services_1.responseResult
                    .map((result) => `<li>Code: ${result.code}, Message: ${result.message}</li>`)
                    .join("")}
            </ul>
          </body>
        </html>
      `);
            });
            const server = app.listen(port, () => {
                console.log(`Server listening on port ${port}`);
            });
            yield listChats();
            yield forwardNewMessages(axiosInstance);
            bot_1.bot.on("message", (ctx) => __awaiter(this, void 0, void 0, function* () {
                const message = ctx.message;
                if (message && message.caption !== undefined) {
                    // เพิ่มการตรวจสอบว่า message ไม่ได้เป็น undefined ก่อนที่จะเข้าถึง message.caption
                    console.log("bot received new message caption: ", message.caption);
                    // Bot Processing Bonus Codes Call Requests to H25
                    console.log("Bot Processing Bonus Codes Call Requests to H25");
                    yield (0, services_1.processBonusCode)(axiosInstance, message.caption);
                    yield sendMessageToDestinationChannel();
                }
                else if (message && message.text !== undefined) {
                    // เพิ่มการตรวจสอบว่า message.text ไม่ได้เป็น undefined ก่อนที่จะเข้าถึง message.text
                    console.log("bot received new message text: ", message.text);
                    // Bot Processing Bonus Codes Call Requests to H25
                    console.log("Bot Processing Bonus Codes Call Requests to H25");
                    yield (0, services_1.processBonusCode)(axiosInstance, message.text);
                    yield sendMessageToDestinationChannel();
                }
                else {
                    console.log("Invalid message received:", message);
                }
            }));
            return server; // Return the Express server instance
        }
        catch (error) {
            console.error("Service initialization error:", error);
            handleTelegramError(error); // Use type assertion
        }
    });
}
function wait(ms) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => setTimeout(resolve, ms));
    });
}
function checkServiceHealth() {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => {
            const net = require("net");
            const server = net.createServer();
            server.once("error", () => {
                // If an error occurs, the service is likely not healthy
                resolve(false);
            });
            server.once("listening", () => {
                // If the server is listening, it indicates that the service is healthy
                server.close();
                resolve(true);
            });
            server.listen(port, "0.0.0.0");
        });
    });
}
function restartService() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log("Restarting service...");
            // Stop the current Express server instance
            expressServer.close();
            // Start a new instance of the Express server
            expressServer = yield startService();
            console.log("Service restarted successfully.");
        }
        catch (error) {
            console.error("Error restarting service:", error);
        }
    });
}
function checkNetworkConnectivity() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield axios_1.default.get("https://www.google.com", {
                timeout: 5000, // Timeout after 5 seconds
            });
            console.log("checkNetworkConnectivity status:", response.status);
            // If the response status is between 200 and 299, consider it a successful connection
            return response.status >= 200 && response.status < 300;
        }
        catch (error) {
            // An error occurred, indicating network connectivity issues
            return false;
        }
    });
}
function handleClientDisconnect() {
    return __awaiter(this, void 0, void 0, function* () {
        // Implement logic to handle client disconnection
        console.log("Attempting to reconnect...");
        yield startClient();
    });
}
function monitorServiceHealth() {
    return __awaiter(this, void 0, void 0, function* () {
        // Monitor service health and restart if necessary
        if (yield checkServiceHealth()) {
            console.log("Service is healthy.");
        }
        else {
            console.log("Service is not responding. Restarting...");
            yield restartService();
        }
    });
}
setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
    if (!(yield checkNetworkConnectivity())) {
        console.log("Network connectivity lost. Attempting to reconnect...");
        yield handleClientDisconnect();
    }
}), 60000); // Check network connectivity every minute
function initializeService() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield monitorServiceHealth(); // Check service health before starting
            expressServer = yield startService(); // Store the Express server instance
        }
        catch (error) {
            console.error("Failed to initialize service:", error);
        }
    });
}
initializeService(); // Kickstart the service
