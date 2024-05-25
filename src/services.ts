// services.ts
import axios, { AxiosResponse } from "axios";
import dotenv from "dotenv";
import moment from "moment"; // Use default import for moment

dotenv.config();

const RETRY_INTERVAL_MS = 50; // Retry interval for specific response codes in milliseconds
const RATE_LIMIT_INTERVAL_MS = 50; // Interval to wait if rate limit is exceeded in milliseconds
const MAX_RETRY_COUNT = 2;
export const responseResult: any[] = []; // Export responseResult array

interface FormData {
  platformType: string;
  isCancelDiscount: string;
  siteId: string;
  siteCode: string;
  cardNo: string;
}

interface Headers {
  [key: string]: string;
}

async function sendRequest(
  cardNo: string,
  apiEndpoint: string,
  headers: Headers,
  retryCount: number = 0
): Promise<void> {
  const formData: FormData = {
    platformType: process.env.PLATFORM_TYPE || "1",
    isCancelDiscount: "F",
    siteId: "1451470260579512322",
    siteCode: "ybaxcf-4",
    cardNo: cardNo,
  };

  try {
    const response: AxiosResponse = await axios.post(
      `${apiEndpoint}/cash/v/pay/generatePayCardV2`,
      formData,
      { headers }
    );
    const responseData = response.data;

    console.log("Response Body:", responseData);

    switch (responseData.code) {
      case 9999:
        console.log("Response code is 9999. Retrying request...");
        break;
      case 10003:
        console.log("Rate limit exceeded. Retrying after delay...");
        await new Promise((resolve) =>
          setTimeout(resolve, RATE_LIMIT_INTERVAL_MS)
        );
        break;
      case 10140:
        console.log("Token expired. Updating token and retrying request...");
        headers["token"] = process.env.H25_TOKEN2 || "";
        await new Promise((resolve) =>
          setTimeout(resolve, RATE_LIMIT_INTERVAL_MS)
        );
        break;
      default:
        responseResult.push(responseData);
        return; // Exit the function on success
    }

    // Retry the request
    if (retryCount < MAX_RETRY_COUNT) {
      await sendRequest(cardNo, apiEndpoint, headers, retryCount + 1);
    } else {
      console.error("Maximum retry count reached. Aborting request.");
    }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error("Unexpected response content:", error.response.data);
      console.error("Headers:", error.response.headers);
    } else {
      console.error(
        "Error sending request to API:",
        (error as any).stack || (error as any).message
      );
    }
  }
}

async function sendNextRequest(
  dataArray: string[],
  apiEndpoint: string,
  headers: Headers
): Promise<void> {
  for (const cardNo of dataArray) {
    await sendRequest(cardNo, apiEndpoint, headers);
  }
}

async function mockSendRequests(
  endpoint: string,
  dataArray: string[]
): Promise<void> {
  try {
    const deviceCode = process.env.DEVICE_CODE || "";
    const sourceDomain = endpoint.replace("/api", "");
    const h25Token = process.env.H25_TOKEN1 || "";
    const sign = process.env.SIGN || "";

    const headers: Headers = {
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
      "Sec-Ch-Ua":
        '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      Token: h25Token,
      Sign: sign,
      Timestamp: moment().toISOString(),
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    };

    await sendNextRequest(dataArray, endpoint, headers);
  } catch (error) {
    console.error(`Error: ${error}`);
  }
}

async function processBonusCode(
  apiEndpoints: string[],
  text: string
): Promise<void> {
  const codes = parseMessage(text);
  const numericalRegex = /^\d+$/;
  const filteredCodes = codes.filter(
    (code) => numericalRegex.test(code) && code.length > 10
  );

  if (filteredCodes.length > 0 && apiEndpoints.length > 0) {
    console.log("bonusCodeArray", filteredCodes);

    try {
      await mockSendRequests(apiEndpoints[0], filteredCodes);
    } catch (error) {
      console.error(`An error occurred: ${error}`);
    }
  } else {
    console.log("No valid bonus codes found:", filteredCodes);
  }
}

function parseMessage(message: string): string[] {
  const lines = message.trim().split("\n");
  const codes: string[] = [];

  for (const line of lines) {
    const numbers = line.trim().split(/\s+/);
    codes.push(...numbers);
  }

  return codes;
}

export { processBonusCode, sendRequest }; // Export sendRequest if needed elsewhere
