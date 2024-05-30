// Importing modules
import axios, { AxiosInstance, AxiosResponse, AxiosError } from "axios";
import dotenv from "dotenv";

// Configuring dotenv
dotenv.config();

// Constants for retrying and rate limit
const RETRY_INTERVAL_MS = 100; // Retry interval for specific response codes in milliseconds
const RATE_LIMIT_INTERVAL_MS = 100; // Interval to wait if rate limit is exceeded in milliseconds
const MAX_RETRY_COUNT = 2;

// Declare and export responseResult array
export const responseResult: any[] = [];

// Interface for form data
interface FormData {
  platformType: string;
  isCancelDiscount: string;
  siteId: string;
  siteCode: string;
  cardNo: string;
}

// Function to send request
async function sendRequest(
  cardNo: string,
  axiosInstance: AxiosInstance,
  retryCount: number = 0
): Promise<void> {
  const formData: FormData = {
    platformType: process.env.PLATFORM_TYPE || "1",
    isCancelDiscount: "F",
    siteId: process.env.SITE_ID || "1451470260579512322",
    siteCode: process.env.SITE_CODE || "ybaxcf-4",
    cardNo: cardNo,
  };

  try {
    const response: AxiosResponse = await axiosInstance.post(
      `/cash/v/pay/generatePayCardV2`,
      formData
    );
    const responseData = response.data;

    console.log("Response Body:", responseData);

    switch (responseData.code) {
      case 9999:
        console.log("Response code is 9999. Retrying request...");
        await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
        break;
      case 10003:
        console.log("Rate limit exceeded. Retrying after delay...");
        await new Promise((resolve) =>
          setTimeout(resolve, RATE_LIMIT_INTERVAL_MS)
        );
        break;
      case 10140:
        console.log("Token expired. Updating token and retrying request...");
        // Handle token update logic here if necessary
        break;
      default:
        responseResult.push(responseData);
        return; // Exit the function on success
    }

    // Retry the request
    if (retryCount < MAX_RETRY_COUNT) {
      await sendRequest(cardNo, axiosInstance, retryCount + 1);
    } else {
      console.error("Maximum retry count reached. Aborting request.");
    }
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response) {
      console.error("Unexpected response content:", error.response.data);
      console.error("Headers:", error.response.headers);
      // Retry logic for server errors
      if (error.response.status >= 500 && retryCount < MAX_RETRY_COUNT) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
        await sendRequest(cardNo, axiosInstance, retryCount + 1);
      }
    } else {
      console.error(
        "Error sending request to API:",
        (error as any).stack || (error as any).message
      );
    }
  }
}

// Function to send next request
async function sendNextRequest(
  dataArray: string[],
  axiosInstance: AxiosInstance
): Promise<void> {
  for (const cardNo of dataArray) {
    await sendRequest(cardNo, axiosInstance);
  }
}

// Function to process bonus code
async function processBonusCode(
  axiosInstance: AxiosInstance,
  text: string
): Promise<void> {
  const codes = parseMessage(text);
  const numericalRegex = /^\d+$/;
  const filteredCodes = codes.filter(
    (code) => numericalRegex.test(code) && code.length > 10
  );

  if (filteredCodes.length > 0) {
    await sendNextRequest(filteredCodes, axiosInstance);
  } else {
    console.log("No valid bonus codes found:", filteredCodes);
  }
}

// Function to parse message
function parseMessage(message: string): string[] {
  const lines = message.trim().split("\n");
  const codes: string[] = [];

  for (const line of lines) {
    const numbers = line.trim().split(/\s+/);
    codes.push(...numbers);
  }

  return codes;
}

// Exporting functions without redeclaring responseResult
export { processBonusCode, sendRequest };
