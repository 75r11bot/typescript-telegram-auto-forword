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
// services.ts
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const moment_1 = __importDefault(require("moment")); // Use default import for moment
dotenv_1.default.config();
const RETRY_INTERVAL_MS = 50; // Retry interval for specific response codes in milliseconds
const RATE_LIMIT_INTERVAL_MS = 50; // Interval to wait if rate limit is exceeded in milliseconds
const MAX_RETRY_COUNT = 2;
exports.responseResult = []; // Export responseResult array
function sendRequest(cardNo_1, apiEndpoint_1, headers_1) {
    return __awaiter(this, arguments, void 0, function* (cardNo, apiEndpoint, headers, retryCount = 0) {
        const formData = {
            platformType: process.env.PLATFORM_TYPE || "1",
            isCancelDiscount: "F",
            siteId: "1451470260579512322",
            siteCode: "ybaxcf-4",
            cardNo: cardNo,
        };
        try {
            const response = yield axios_1.default.post(`${apiEndpoint}/cash/v/pay/generatePayCardV2`, formData, { headers });
            const responseData = response.data;
            console.log("Response Body:", responseData);
            switch (responseData.code) {
                case 9999:
                    console.log("Response code is 9999. Retrying request...");
                    break;
                case 10003:
                    console.log("Rate limit exceeded. Retrying after delay...");
                    yield new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_INTERVAL_MS));
                    break;
                case 10140:
                    console.log("Token expired. Updating token and retrying request...");
                    headers["Token"] = process.env.H25_TOKEN2 || "";
                    yield new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_INTERVAL_MS));
                    break;
                default:
                    exports.responseResult.push(responseData);
                    return; // Exit the function on success
            }
            // Retry the request
            if (retryCount < MAX_RETRY_COUNT) {
                yield sendRequest(cardNo, apiEndpoint, headers, retryCount + 1);
            }
            else {
                console.error("Maximum retry count reached. Aborting request.");
            }
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error) && error.response) {
                console.error("Unexpected response content:", error.response.data);
                console.error("Headers:", error.response.headers);
            }
            else {
                console.error("Error sending request to API:", error.stack || error.message);
            }
        }
    });
}
exports.sendRequest = sendRequest;
function sendNextRequest(dataArray, apiEndpoint, headers) {
    return __awaiter(this, void 0, void 0, function* () {
        for (const cardNo of dataArray) {
            yield sendRequest(cardNo, apiEndpoint, headers);
        }
    });
}
function mockSendRequests(endpoint, dataArray) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const deviceCode = process.env.DEVICE_CODE || "";
            const sourceDomain = endpoint.replace("/api", "");
            const h25Token = process.env.H25_TOKEN1 || "";
            const sign = process.env.SIGN || "";
            const headers = {
                Accept: "application/json, text/plain, */*",
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Accept-Language": "th, en-US;q=0.9, en;q=0.8",
                "Cache-Control": "no-cache",
                "Content-Type": "application/x-www-form-urlencoded",
                Cookie: deviceCode,
                Endpoint: sourceDomain,
                Lang: "th-TH",
                Language: "th-TH",
                Origin: sourceDomain,
                Pragma: "no-cache",
                Referer: `${sourceDomain}/`,
                "Sec-Ch-Ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": '"Windows"',
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                Token: h25Token,
                Sign: sign,
                Timestamp: (0, moment_1.default)().toISOString(),
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            };
            yield sendNextRequest(dataArray, endpoint, headers);
        }
        catch (error) {
            console.error(`Error: ${error}`);
        }
    });
}
function processBonusCode(apiEndpoints, text) {
    return __awaiter(this, void 0, void 0, function* () {
        const codes = parseMessage(text);
        const numericalRegex = /^\d+$/;
        const filteredCodes = codes.filter((code) => numericalRegex.test(code) && code.length > 10);
        if (filteredCodes.length > 0 && apiEndpoints.length > 0) {
            console.log("bonusCodeArray", filteredCodes);
            try {
                yield mockSendRequests(apiEndpoints[0], filteredCodes);
            }
            catch (error) {
                console.error(`An error occurred: ${error}`);
            }
        }
        else {
            console.log("No valid bonus codes found:", filteredCodes);
        }
    });
}
exports.processBonusCode = processBonusCode;
function parseMessage(message) {
    const lines = message.trim().split("\n");
    const codes = [];
    for (const line of lines) {
        const numbers = line.trim().split(/\s+/);
        codes.push(...numbers);
    }
    return codes;
}
