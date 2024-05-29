import axios, { AxiosInstance, AxiosResponse } from "axios";
import dotenv from "dotenv";

dotenv.config();

const RETRY_INTERVAL_MS = 50; // Retry interval for specific response codes in milliseconds
const RATE_LIMIT_INTERVAL_MS = 50; // Interval to wait if rate limit is exceeded in milliseconds
const MAX_RETRY_COUNT = 2;
export const responseResult: any[] = []; // Declare and export responseResult array

interface FormData {
  platformType: string;
  isCancelDiscount: string;
  siteId: string;
  siteCode: string;
  cardNo: string;
}

async function sendRequest(
  cardNo: string,
  axiosInstance: AxiosInstance,
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
    const response: AxiosResponse = await axiosInstance.post(
      `/cash/v/pay/generatePayCardV2`,
      formData
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
  axiosInstance: AxiosInstance
): Promise<void> {
  for (const cardNo of dataArray) {
    await sendRequest(cardNo, axiosInstance);
  }
}

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

function parseMessage(message: string): string[] {
  const lines = message.trim().split("\n");
  const codes: string[] = [];

  for (const line of lines) {
    const numbers = line.trim().split(/\s+/);
    codes.push(...numbers);
  }

  return codes;
}

export { processBonusCode, sendRequest }; // Export other functions without redeclaring responseResult
