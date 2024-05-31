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
exports.sendRequest = exports.processBonusCode = exports.responseResult = void 0;
// Importing modules
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
// Configuring dotenv
dotenv_1.default.config();
// Constants for retrying and rate limit
const RETRY_INTERVAL_MS = 100; // Retry interval for specific response codes in milliseconds
const RATE_LIMIT_INTERVAL_MS = 100; // Interval to wait if rate limit is exceeded in milliseconds
const MAX_RETRY_COUNT = 2;
// Declare and export responseResult array
exports.responseResult = [];
// Function to send request
function sendRequest(cardNo_1, axiosInstance_1) {
    return __awaiter(this, arguments, void 0, function* (cardNo, axiosInstance, retryCount = 0) {
        const formData = {
            platformType: process.env.PLATFORM_TYPE || "2",
            isCancelDiscount: "F",
            siteId: process.env.SITE_ID || "1451470260579512322",
            siteCode: process.env.SITE_CODE || "ybaxcf-4",
            cardNo: cardNo,
        };
        try {
            const response = yield axiosInstance.post(`/cash/v/pay/generatePayCardV2`, formData);
            const responseData = response.data;
            console.log("Response Body:", responseData);
            switch (responseData.code) {
                case 9999:
                    console.log("Response code is 9999. Retrying request...");
                    yield new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
                    break;
                case 10003:
                    console.log("Rate limit exceeded. Retrying after delay...");
                    yield new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_INTERVAL_MS));
                    break;
                case 10140:
                    console.log("Token expired. Updating token and retrying request...");
                    // Handle token update logic here if necessary
                    break;
                default:
                    exports.responseResult.push(responseData);
                    return; // Exit the function on success
            }
            // Retry the request
            if (retryCount < MAX_RETRY_COUNT) {
                yield sendRequest(cardNo, axiosInstance, retryCount + 1);
            }
            else {
                console.error("Maximum retry count reached. Aborting request.");
            }
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error) && error.response) {
                console.error("Unexpected response content:", error.response.data);
                console.error("Headers:", error.response.headers);
                // Retry logic for server errors
                if (error.response.status >= 500 && retryCount < MAX_RETRY_COUNT) {
                    yield new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
                    yield sendRequest(cardNo, axiosInstance, retryCount + 1);
                }
            }
            else {
                console.error("Error sending request to API:", error.stack || error.message);
            }
        }
    });
}
exports.sendRequest = sendRequest;
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
    const lines = message.trim().split("\n");
    const codes = [];
    for (const line of lines) {
        const numbers = line.trim().split(/\s+/);
        codes.push(...numbers);
    }
    return codes;
}
