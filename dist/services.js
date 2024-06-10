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
exports.executeNetworkCommands = exports.sendRequest = exports.processBonusCode = exports.responseResult = void 0;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const axios_config_1 = require("./axios/axios.config");
// Configuring dotenv
dotenv_1.default.config();
// Constants for retrying and rate limit
const RETRY_INTERVAL_MS = 500; // Retry interval for specific response codes in milliseconds
const RATE_LIMIT_INTERVAL_MS = 100; // Interval to wait if rate limit is exceeded in milliseconds
const MAX_RETRY_COUNT = 2;
// Declare and export responseResult object
exports.responseResult = { user: "", result: [] };
// Function to send request
function sendRequest(cardNo_1, axiosInstance_1) {
    return __awaiter(this, arguments, void 0, function* (cardNo, axiosInstance, retryCount = 0) {
        var _a;
        const formData = {
            platformType: process.env.PLATFORM_TYPE || "2",
            isCancelDiscount: "F",
            siteId: process.env.SITE_ID || "1451470260579512322",
            siteCode: process.env.SITE_CODE || "ybaxcf-4",
            cardNo: cardNo,
        };
        try {
            // Capture the username from axiosInstance params
            exports.responseResult.user = ((_a = axiosInstance.defaults.params) === null || _a === void 0 ? void 0 : _a.username) || "";
            const response = yield axiosInstance.post(`/cash/v/pay/generatePayCardV2`, formData);
            const responseData = response.data;
            console.log("Response Body:", responseData);
            switch (responseData.code) {
                case 9999:
                    console.log("Response code is 9999. Retrying request...");
                    yield wait(RETRY_INTERVAL_MS);
                    break;
                case 10003:
                    console.log("Rate limit exceeded. Releasing and renewing IP...");
                    yield executeNetworkCommands();
                    console.log("IP released and renewed. Retrying request...");
                    yield wait(RETRY_INTERVAL_MS);
                    break;
                case 10140:
                    console.log("Token expired. Setting up new axiosInstance...");
                    axiosInstance = yield (0, axios_config_1.ApiCall)();
                    yield sendRequest(cardNo, axiosInstance, retryCount);
                    break;
                default:
                    exports.responseResult.result.push(responseData);
                    return; // Exit the function on success
            }
            if (retryCount < MAX_RETRY_COUNT) {
                yield sendRequest(cardNo, axiosInstance, retryCount + 1);
            }
            else {
                console.error("Maximum retry count reached. Aborting request.");
            }
        }
        catch (error) {
            yield handleError(error, cardNo, axiosInstance, retryCount);
        }
    });
}
exports.sendRequest = sendRequest;
// Function to handle errors
function handleError(error, cardNo, axiosInstance, retryCount) {
    return __awaiter(this, void 0, void 0, function* () {
        if (axios_1.default.isAxiosError(error) && error.response) {
            console.error("Unexpected response content:", error.response.data);
            console.error("Headers:", error.response.headers);
            if (error.response.status >= 500 && retryCount < MAX_RETRY_COUNT) {
                yield wait(RETRY_INTERVAL_MS);
                yield sendRequest(cardNo, axiosInstance, retryCount + 1);
            }
        }
        else {
            console.error("Error sending request to API:", error.stack || error.message);
        }
    });
}
// Function to wait for a given time
function wait(ms) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => setTimeout(resolve, ms));
    });
}
// Function to send next request
function sendNextRequest(dataArray, axiosInstance) {
    return __awaiter(this, void 0, void 0, function* () {
        for (const cardNo of dataArray) {
            yield sendRequest(cardNo, axiosInstance);
        }
    });
}
// Function to process bonus code
function processBonusCode(axiosInstance, text) {
    return __awaiter(this, void 0, void 0, function* () {
        const codes = parseMessage(text);
        const numericalRegex = /^\d+$/;
        const filteredCodes = codes.filter((code) => numericalRegex.test(code) && code.length > 10);
        console.log("Bonus Codes:", filteredCodes);
        if (filteredCodes.length > 0) {
            yield sendNextRequest(filteredCodes, axiosInstance);
        }
        else {
            console.log("No valid bonus codes found:", filteredCodes);
        }
    });
}
exports.processBonusCode = processBonusCode;
// Function to parse message
function parseMessage(message) {
    const codes = [];
    if (message !== undefined) {
        const lines = message.trim().split("\n");
        for (const line of lines) {
            const numbers = line.trim().split(/\s+/);
            codes.push(...numbers);
        }
    }
    return codes;
}
// Function to execute network commands
function executeNetworkCommands() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { execSync } = require("child_process");
            execSync("netsh int ip reset");
            execSync("ipconfig /release");
            execSync("ipconfig /renew");
        }
        catch (error) {
            console.error("Error executing network commands:", error);
            throw error;
        }
    });
}
exports.executeNetworkCommands = executeNetworkCommands;
