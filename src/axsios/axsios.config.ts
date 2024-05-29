import axios, { AxiosInstance, AxiosError, AxiosResponse } from "axios";
import axiosRetry from "axios-retry";
import moment from "moment";

async function ApiCall(): Promise<AxiosInstance> {
  const siteId = "1451470260579512322";
  const siteCode = "ybaxcf-4";
  const platformType = "2";

  const endpoints = [
    // process.env.API_ENDPOINT_1,
    process.env.API_ENDPOINT_2,
    process.env.API_ENDPOINT_3,
    process.env.API_ENDPOINT_4,
  ].filter(Boolean) as string[];

  const tokens = [process.env.H25_TOKEN1, process.env.H25_TOKEN2].filter(
    Boolean
  ) as string[];

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

  for (const endpoint of endpoints) {
    for (const token of tokens) {
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
            return axiosInstance;
          } else if (responseData.code === 10140) {
            console.log(`Token ${token} is expired at endpoint ${endpoint}.`);
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
        console.error(
          `Error connecting to ${endpoint} with token ${token}: ${error}`
        );
        // If the error is related to this token, continue with the next token
        if (error.response && error.response.status === 401) {
          continue;
        }
        // If the error is not related to authentication, continue with the next endpoint
        if (!error.response || error.response.status !== 401) {
          break;
        }
      }
    }
  }

  throw new Error("No valid endpoint and token combination found.");
}

export { ApiCall };
