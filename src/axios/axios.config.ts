import axios, { AxiosInstance, AxiosError, AxiosResponse } from "axios";
import axiosRetry from "axios-retry";
import moment from "moment";
import { getH25Token } from "../utility";
import { siteConfig } from "../sites.config";

async function ApiCall(): Promise<AxiosInstance> {
  const siteId = "1451470260579512322";
  const siteCode = "ybaxcf-4";
  const platformType = "2";
  const h25Username = siteConfig.h25User || "";
  const h25Password = siteConfig.h25Password || "";

  const endpoints = [
    process.env.API_ENDPOINT_1,
    process.env.API_ENDPOINT_2,
    process.env.API_ENDPOINT_3,
    process.env.API_ENDPOINT_4,
  ].filter(Boolean) as string[];

  axiosRetry(axios, {
    retries: 3,
    retryDelay: (retryCount) => retryCount * 1000,
    retryCondition: (error: AxiosError): boolean => {
      return (
        error.code === "ECONNABORTED" ||
        (error.response && error.response.status >= 500) ||
        false
      ); // Ensure the return value is always a boolean
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

    try {
      const deviceCode = process.env.DEVICE_CODE || "";
      const sourceDomain = endpoint.replace("/api", "");
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
        "Sec-Ch-Ua":
          '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        Token: token,
        Sign: sign,
        Timestamp: moment().toISOString(),
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
      };

      const axiosInstance = axios.create({
        baseURL: endpoint,
        headers: headers,
      });

      const url = `/v/user/refreshUserFund?siteId=${siteId}&siteCode=${siteCode}&platformType=${platformType}`;
      const response: AxiosResponse<any> = await axiosInstance.get(url);

      if (response.status === 200) {
        const responseData = response.data;
        if (responseData.code === 10000) {
          console.log(`Token ${token} is ready at endpoint ${endpoint}.`);
          return axiosInstance; // Return the axios instance immediately
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
    } catch (error: any) {
      console.error(`Error connecting to ${endpoint}: ${error.message}`);
      if (error.response && error.response.status === 401) {
        console.log("Token might be invalid. Generating a new token.");
        token = await getH25Token(h25Username, h25Password);
        if (!token) {
          console.log("Failed to retrieve a new token.");
        }
        continue;
      }
      if (!error.response || error.response.status !== 401) {
        break;
      }
    }
  }

  throw new Error("No valid endpoint and token combination found.");
}

export { ApiCall };
