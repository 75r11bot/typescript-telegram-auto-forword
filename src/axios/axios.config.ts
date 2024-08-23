import axios, { AxiosInstance, AxiosError, AxiosResponse } from "axios";
import axiosRetry from "axios-retry";
import moment from "moment";
import { getH25Token, getT6Session } from "../utility";
import { siteConfig } from "../sites.config";

// Define API endpoints
const endpoints = [
  process.env.API_ENDPOINT_1,
  process.env.API_ENDPOINT_2,
  process.env.API_ENDPOINT_3,
  process.env.API_ENDPOINT_4,
].filter(Boolean) as string[];

const t6Endpoint = process.env.API_ENDPOINT_T6 || "";
const timestamp = moment(new Date()).format("YYYY-MM-DD HH:mm:ss").toString();

// Initialize Axios instance for H25
async function initializeAxiosInstance(): Promise<AxiosInstance> {
  const siteId = siteConfig.siteId;
  const siteCode = "ysysju-4";
  const platformType = "2";
  const h25Username = siteConfig.h25User || "";
  const h25Password = siteConfig.h25Password || "";

  try {
    // Configure Axios retry logic
    axiosRetry(axios, {
      retries: 3,
      retryDelay: (retryCount) => retryCount * 1000,
      retryCondition: (error: AxiosError): boolean => {
        return (
          error.code === "ECONNABORTED" ||
          error.code === "ECONNRESET" ||
          (error.response ? error.response.status >= 500 : false)
        );
      },
    });

    let token: string | null = null;

    for (const endpoint of endpoints) {
      if (!token) {
        token = await getH25Token(h25Username, h25Password);
        if (!token) {
          console.log("Failed to retrieve token.");
          continue;
        }
      }

      const deviceCode = siteConfig.deviceCode;
      const sourceDomain = endpoint.replace("/api", "");
      const sign = siteConfig.siteSign;

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
        "Sec-Ch-Ua":
          '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        dnt: 1,
        Token: token,
        Sign: sign,
        Timestamp: timestamp,
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 7.0; SM-G950U Build/NRD90M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.84 Mobile Safari/537.36",
      };

      const axiosInstance = axios.create({
        baseURL: endpoint,
        headers: headers,
        timeout: 90000,
      });

      const url = `/v/user/refreshUserFund?siteId=${siteId}&siteCode=${siteCode}&platformType=${platformType}`;
      const response: AxiosResponse<any> = await axiosInstance.get(url);

      if (response.status === 200) {
        const responseData = response.data;
        if (responseData.code === 10000) {
          console.log(`Token ${token} is ready at endpoint ${endpoint}.`);
          return axiosInstance; // Return immediately if axiosInstance is ready
        } else if (responseData.code === 10140) {
          console.log(`Token ${token} is expired at endpoint ${endpoint}.`);
          token = await getH25Token(h25Username, h25Password);
          if (!token) {
            console.log("Failed to retrieve a new token.");
            continue;
          }
        } else {
          throw new Error(
            `Unexpected response code ${responseData.code} at endpoint ${endpoint}.`
          );
        }
      } else {
        throw new Error(
          `Endpoint ${endpoint} responded with status code ${response.status}.`
        );
      }
    }

    throw new Error("No valid endpoint and token combination found.");
  } catch (error: any) {
    console.error(`Error initializing axiosInstance: ${error.message}`);
    throw error; // Rethrow the error for further handling
  }
}

// Check Axios instance for H25
async function checkAxiosInstance(
  axiosInstance: AxiosInstance
): Promise<AxiosInstance> {
  try {
    const siteId = siteConfig.siteId;
    const siteCode = "ybaxcf-4";
    const platformType = "2";

    for (const endpoint of endpoints) {
      let isReady = false;
      const url = `${endpoint}/v/user/refreshUserFund?siteId=${siteId}&siteCode=${siteCode}&platformType=${platformType}`;
      const response: AxiosResponse<any> = await axiosInstance.get(url);

      if (response.status >= 200 && response.status < 300) {
        if (response.data.code === 10000) {
          isReady = true;
          console.log(`axiosInstance is ready at endpoint ${endpoint}.`);
          return axiosInstance; // Return immediately once axiosInstance is ready
        }
      }
    }

    console.log("None of the endpoints are ready. Reinitializing...");
    return initializeAxiosInstance(); // Reinitialize if no endpoint is ready
  } catch (error: any) {
    console.error("Error checking axiosInstance:", error);
    if (error.code === "ECONNRESET" || error.code === "ECONNABORTED") {
      console.log("Network error occurred. Retrying...");
      return checkAxiosInstance(axiosInstance); // Retry on network errors
    }
    console.log("Reinitializing axiosInstance...");
    return initializeAxiosInstance(); // Reinitialize for other errors
  }
}

// Function to initialize Axios instance for T6
async function initializeAxiosInstanceT6(): Promise<AxiosInstance> {
  const t6Username = siteConfig.t6User || "";
  const t6Password = siteConfig.t6Password || "";

  try {
    // Configure Axios retry logic
    axiosRetry(axios, {
      retries: 3,
      retryDelay: (retryCount) => retryCount * 1000,
      retryCondition: (error: AxiosError): boolean => {
        return (
          error.code === "ECONNABORTED" ||
          error.code === "ECONNRESET" ||
          (error.response ? error.response.status >= 500 : false)
        );
      },
    });

    // Retrieve session
    let session: string | null = await getT6Session(t6Username, t6Password);
    if (!session) {
      console.log("Failed to retrieve session.");
      //throw new Error("Failed to retrieve session.");
      session = await getT6Session(t6Username, t6Password);
      if (!session) {
        console.log("Failed to retrieve session.");
        throw new Error("Failed to retrieve session.");
      }
    }

    // Create Axios instance with appropriate headers
    const axiosInstanceT6 = axios.create({
      baseURL: t6Endpoint,
      headers: {
        Accept: "application/json, text/plain, */*",
        Session: session,
        Dnt: 1,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      timeout: 90000,
    });

    // Verify if the instance is ready
    const isReady = await verifyAxiosInstanceT6(axiosInstanceT6);
    if (isReady) {
      return axiosInstanceT6;
    } else {
      throw new Error(`Endpoint ${t6Endpoint} is not ready.`);
    }
  } catch (error: any) {
    console.error(`Error initializing axiosInstanceT6: ${error.message}`);
    throw error; // Rethrow the error for further handling
  }
}

// Function to verify Axios instance for T6
async function verifyAxiosInstanceT6(
  axiosInstance: AxiosInstance
): Promise<boolean> {
  try {
    const response: AxiosResponse<any> = await axiosInstance.get(`member/live`);
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

// Function to check Axios instance for T6 and reinitialize if necessary
async function checkAxiosInstanceT6(
  axiosInstance: AxiosInstance
): Promise<AxiosInstance> {
  const isReady = await verifyAxiosInstanceT6(axiosInstance);
  if (isReady) {
    return axiosInstance;
  } else {
    return initializeAxiosInstanceT6();
  }
}

export {
  initializeAxiosInstance,
  checkAxiosInstance,
  initializeAxiosInstanceT6,
  checkAxiosInstanceT6,
};
