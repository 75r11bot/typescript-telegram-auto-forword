import axios, { AxiosInstance, AxiosResponse, AxiosError } from "axios";
import dotenv from "dotenv";
import { checkAxiosInstance } from "./axios/axios.config";
import { siteConfig } from "./sites.config";

// Configuring dotenv
dotenv.config();

// Constants for retrying and rate limit
const RETRY_INTERVAL_MS = 500; // Retry interval for specific response codes in milliseconds
const RATE_LIMIT_INTERVAL_MS = 100; // Interval to wait if rate limit is exceeded in milliseconds
const MAX_RETRY_COUNT = 2;
const h25Username = siteConfig.h25User || "";

// Declare and export responseResult object
export const responseResult: any = { username: h25Username, result: [] };

// Interface for form data
interface FormData {
  platformType: string;
  isCancelDiscount: string;
  siteId: string;
  siteCode: string;
  cardNo: string;
}
interface ApiResponse {
  code: number;
  message: string;
  details: {
    orderNo?: string;
  };
}

interface Summary {
  success: {
    count: number;
    orders: string[];
  };
  failure: {
    count: number;
    details: { [message: string]: number };
  };
}
interface ProcessResult {
  message: string;
  result: any;
  username: string;
}

// Function to send request
async function sendRequest(
  cardNo: string,
  axiosInstance: AxiosInstance,
  retryCount: number = 0
): Promise<void> {
  const formData: FormData = {
    platformType: process.env.PLATFORM_TYPE || "2",
    isCancelDiscount: "F",
    siteId: siteConfig.siteId,
    siteCode: process.env.SITE_CODE || "ysysju-4",
    cardNo: cardNo,
  };

  try {
    // Capture the username from axiosInstance params
    responseResult.username = h25Username || "";

    const response: AxiosResponse = await axiosInstance.post(
      `/cash/v/pay/generatePayCardV2`,
      formData
    );
    const responseData = response.data;

    console.log("Response Body:", responseData);

    switch (responseData.code) {
      case 9999:
        console.log("Response code is 9999. Retrying request...");
        await wait(RETRY_INTERVAL_MS);
        await sendRequest(cardNo, axiosInstance, retryCount + 1);
        break;
      case 10003:
        const waitTime =
          response.headers["openresty-x-ratelimit-keepblockttl"] * 1000 ||
          RATE_LIMIT_INTERVAL_MS;
        console.log(
          `Rate limit exceeded. Waiting for ${waitTime} ms before retrying...`
        );
        await wait(waitTime);
        await sendRequest(cardNo, axiosInstance, retryCount + 1);
        break;
      case 10140:
        console.log("Token expired. Setting up new axiosInstance...");
        axiosInstance = await checkAxiosInstance(axiosInstance);
        await sendRequest(cardNo, axiosInstance, retryCount);
        break;
      default:
        responseResult.result.push(responseData);
        return; // Exit the function on success
    }
  } catch (error) {
    await handleError(error, cardNo, axiosInstance, retryCount);
  }
}

// Function to handle errors
async function handleError(
  error: unknown,
  cardNo: string,
  axiosInstance: AxiosInstance,
  retryCount: number
): Promise<void> {
  if (axios.isAxiosError(error) && error.response) {
    console.error("Unexpected response content:", error.response.data);
    console.error("Headers:", error.response.headers);
    if (error.response.status >= 500 && retryCount < MAX_RETRY_COUNT) {
      await wait(RETRY_INTERVAL_MS);
      await sendRequest(cardNo, axiosInstance, retryCount + 1);
    } else if (error.response.data.code === 10003) {
      const waitTime =
        error.response.headers["openresty-x-ratelimit-keepblockttl"] * 1000 ||
        RATE_LIMIT_INTERVAL_MS;
      console.log(`Rate limit hit, waiting for ${waitTime} ms`);
      await wait(waitTime);
      await sendRequest(cardNo, axiosInstance, retryCount + 1);
    }
  } else if (axios.isAxiosError(error)) {
    if (error.code === "ECONNREFUSED") {
      console.error(`Connection refused, retrying... (${retryCount + 1})`);
      if (retryCount < MAX_RETRY_COUNT) {
        await wait(RETRY_INTERVAL_MS * (retryCount + 1));
        await sendRequest(cardNo, axiosInstance, retryCount + 1);
      } else {
        console.error(
          "Maximum retry count reached for connection refused. Aborting request."
        );
      }
    } else if (error.code === "ETIMEDOUT") {
      console.error(`Request timed out, retrying... (${retryCount + 1})`);
      if (retryCount < MAX_RETRY_COUNT) {
        await wait(RETRY_INTERVAL_MS * (retryCount + 1));
        await sendRequest(cardNo, axiosInstance, retryCount + 1);
      } else {
        console.error(
          "Maximum retry count reached for timeout. Aborting request."
        );
      }
    } else {
      console.error(
        "Error sending request to API:",
        error.stack || error.message
      );
    }
  } else {
    console.error("Unexpected error:", error);
  }
}

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
): Promise<ProcessResult> {
  responseResult.result = [];

  const codes = parseMessage(text);
  const numericalRegex = /^\d+$/;
  const filteredCodes = codes.filter(
    (code) => numericalRegex.test(code) && code.length > 10
  );
  console.log("Bonus Codes:", filteredCodes);
  if (filteredCodes.length > 0) {
    let bonusCodes = shuffleArray(filteredCodes);
    await sendNextRequest(bonusCodes, axiosInstance);
  } else {
    console.log("No valid bonus codes found:", filteredCodes);
  }

  return {
    message: "Bonus Codes Result",
    result: responseResult.result,
    username: responseResult.username,
  };
}

// Function to parse message
function parseMessage(message: string): string[] {
  const codes: string[] = [];

  if (message !== undefined) {
    const lines = message.trim().split("\n");
    for (const line of lines) {
      const numbers = line.trim().split(/\s+/);
      codes.push(...numbers);
    }
  }

  return codes;
}

// Function to shuffle an array
function shuffleArray(array: any[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]]; // Swap elements
  }
  return array;
}

async function getInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.once("data", (data) => resolve(data.toString().trim()));
  });
}

function processH25Response(responses: ApiResponse[]): Summary {
  const summary: Summary = {
    success: {
      count: 0,
      orders: [],
    },
    failure: {
      count: 0,
      details: {},
    },
  };

  responses.forEach((response) => {
    if (response.code === 10000) {
      summary.success.count += 1;
      if (response.details && response.details.orderNo) {
        summary.success.orders.push(response.details.orderNo);
      }
    } else {
      summary.failure.count += 1;
      if (!summary.failure.details[response.message]) {
        summary.failure.details[response.message] = 0;
      }
      summary.failure.details[response.message] += 1;
    }
  });

  return summary;
}

async function checkNetworkConnectivity(): Promise<boolean> {
  try {
    const response = await axios.get("https://www.google.com", {
      timeout: 5000, // Timeout after 5 seconds
    });
    // console.log("checkNetworkConnectivity status:", response.status);
    // If the response status is between 200 and 299, consider it a successful connection
    return response.status >= 200 && response.status < 300;
  } catch (error) {
    // An error occurred, indicating network connectivity issues
    return false;
  }
}

async function processBonusCodeT6(
  axiosInstance: AxiosInstance,
  message: string
): Promise<ProcessResult> {
  const regex = /\b[A-Z0-9]{10}\b/;
  const match = message.match(regex);
  const containsBonusText = message.includes("กดรับโค้ด");
  const containsBonusText1 = message.includes("แจกแลกรหัส");

  let resultMessage =
    "No valid bonus code found or 'กดรับโค้ด' text is missing.";

  if (
    (match && match[0].length == 10 && containsBonusText) ||
    (match && match[0].length == 10 && containsBonusText1)
  ) {
    const bonusCode = match[0];
    console.log(`Extracted bonus code T6 Thailand ®: ${bonusCode}`);

    // Process the bonus code by making an API call
    try {
      const response = await axiosInstance.get(
        `/member/redeem/apply?code=${bonusCode}`
      );
      console.log("Bonus code processed:", response.data);
      resultMessage = "Bonus code processed.";
    } catch (error) {
      console.error("Error processing bonus code:", error);
      resultMessage = "Error processing bonus code.";
    }
  }

  return {
    message: resultMessage,
    result: match ? match[0] : null,
    username: responseResult.username,
  };
}

async function getLotteryNum(axiosInstance: AxiosInstance) {
  try {
    const response = await axiosInstance.get(
      `/activity/roulette/getLotteryNum`
    );
    if (response.data.canLotteryNum > 0) {
      ///process Lottery
    }
  } catch (error) {
    console.error("Error processing bonus code:", error);
  }
}

async function calculateRealTimeRebate(axiosInstance: AxiosInstance) {
  try {
    const calculateUrl = `/v/realTimeRebate/calculateRealTimeRebate`;
    const calculateParams = {
      siteId: siteConfig.siteId,
      siteCode: siteConfig.siteCode,
      platformType: siteConfig.platformType,
    };

    const calculateResponse: AxiosResponse = await axiosInstance.get(
      calculateUrl,
      {
        params: calculateParams,
        timeout: 10000, // 10 seconds timeout
      }
    );

    if (calculateResponse.data.code === 10000) {
      const getUrl = `/v/realTimeRebate/get`;
      const getParams = {
        siteId: siteConfig.siteId,
        siteCode: siteConfig.siteCode,
        platformType: siteConfig.platformType,
      };

      const getResponse: AxiosResponse = await axiosInstance.get(getUrl, {
        params: getParams,
        timeout: 10000, // 10 seconds timeout
      });

      if (
        getResponse.data.code === 10000 &&
        Number(getResponse.data.data.remainAmount) > 200
      ) {
        const updateUrl = `/v/realTimeRebate/updateAmount`;
        const dataPayload = new FormData();
        dataPayload.append(
          "platformType",
          siteConfig.platformType.toLocaleString()
        );
        dataPayload.append("siteId", siteConfig.siteId);
        dataPayload.append("siteCode", siteConfig.siteCode);
        dataPayload.append(
          "amount",
          getResponse.data.data.remainAmount.toString()
        );

        const updateResponse: AxiosResponse = await axiosInstance.post(
          updateUrl,
          dataPayload,
          {
            timeout: 10000, // 10 seconds timeout
          }
        );

        if (updateResponse.data.code === 10000) {
          console.log("Rebate updated successfully:", updateResponse.data);
        } else if (updateResponse.data.code === 10140) {
          console.log("Token expired. Setting up new axiosInstance...");
          axiosInstance = await checkAxiosInstance(axiosInstance);
          await calculateRealTimeRebate(axiosInstance);
        } else {
          console.error("Failed to update rebate:", updateResponse.data);
        }
      } else {
        console.log("No rebate amount available to update.");
      }
    } else {
      console.log("Failed to calculate rebate:", calculateResponse.data);
      if (calculateResponse.data.code === 10140) {
        console.log("Token expired. Setting up new axiosInstance...");
        axiosInstance = await checkAxiosInstance(axiosInstance);
        await calculateRealTimeRebate(axiosInstance);
      }
    }
  } catch (error) {
    console.error("Error processing rebate calculation:", error);
  }
}
// Exporting functions without redeclaring responseResult
export {
  processBonusCode,
  sendRequest,
  getInput,
  processH25Response,
  checkNetworkConnectivity,
  processBonusCodeT6,
  getLotteryNum,
  calculateRealTimeRebate,
};
