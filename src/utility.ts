import { Page, chromium } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
import axios from "axios";
import querystring from "querystring";
import { createWorker as tesseractCreateWorker, Worker } from "tesseract.js";

dotenv.config();

const endpoints = [
  process.env.API_ENDPOINT_1,
  process.env.API_ENDPOINT_2,
  process.env.API_ENDPOINT_3,
  process.env.API_ENDPOINT_4,
].filter(Boolean) as string[];

async function createTesseractWorker(): Promise<Worker> {
  try {
    const worker = await tesseractCreateWorker();
    await worker.load();
    await worker.reinitialize("eng");
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789",
    });
    return worker;
  } catch (error) {
    console.error("Error occurred while creating Tesseract worker:", error);
    throw error;
  }
}

async function extractTextFromImage(imagePath: string): Promise<string> {
  const worker = await createTesseractWorker();

  try {
    const { data } = await worker.recognize(imagePath);
    const text = data.text || "";

    await worker.terminate();

    return text.trim();
  } catch (error) {
    console.error("Error occurred during OCR processing:", error);
    return "";
  }
}

async function loginWebCaptureResponse(
  page: Page,
  user: string,
  password: string,
  url: string
): Promise<{
  verifyCode: string | null;
  token: string | null;
  payload: any | null;
}> {
  let token: string | null = null;
  let verifyCode: string | null = null;
  let loginPayload: any | null = null;

  try {
    await page.goto(url, {
      waitUntil: "load",
      timeout: 90000,
    });

    page.on("response", async (response) => {
      if (response.url().includes("/api/v/user/getVerifyCode?")) {
        const buffer = await response.body();
        console.log("Response from verify code API: received binary data");

        const imagePath = "./captcha.png";
        fs.writeFileSync(imagePath, buffer);

        verifyCode = await extractTextFromImage(imagePath);
        verifyCode = verifyCode.replace(/'/g, "");

        console.log(`Extracted verify code: ${verifyCode}`);
      }

      if (response.url().includes("/api/v/user/newLoginv2")) {
        const responseBody = await response.text();
        const jsonResponse = JSON.parse(responseBody);
        if (
          jsonResponse.code === 10000 &&
          jsonResponse.data &&
          jsonResponse.data.token
        ) {
          token = jsonResponse.data.token;
        }
      }
    });

    page.on("request", async (request) => {
      if (request.url().includes("/api/v/user/newLoginv2")) {
        const postData = request.postData();
        if (postData) {
          loginPayload = querystring.parse(postData);
        }
      }
    });

    await page.getByPlaceholder("ชื่อผู้ใช้").click();
    await page.getByPlaceholder("ชื่อผู้ใช้").fill(user);
    await page.getByPlaceholder("รหัสผ่าน").click();
    await page.getByPlaceholder("รหัสผ่าน").fill(password);

    if (verifyCode) {
      await page.locator('input[type="text"]').nth(2).click();
      await page.locator('input[type="text"]').nth(2).fill(verifyCode);
    }

    await page
      .getByRole("button", { name: "ลงชื่อเข้าใช้", exact: true })
      .click();
    await page.waitForTimeout(5000);

    const frame = page.frame({ name: "iframe" });
    if (frame) {
      await frame.waitForLoadState("domcontentloaded");
      await frame.waitForTimeout(3000);
    } else {
      console.error("Frame not found");
    }
  } catch (error) {
    console.error("Error occurred during login:", error);
  }

  return { token, payload: loginPayload, verifyCode };
}

async function isUrlReady(url: string): Promise<boolean> {
  try {
    const response = await axios.get(url, { timeout: 10000 });
    return response.status === 200;
  } catch (error) {
    console.error(`Error checking URL status: ${error}`);
    if (axios.isAxiosError(error) && error.code === "ECONNABORTED") {
      console.log("Timeout occurred. Retrying...");
      return isUrlReady(url); // Retry on timeout
    }
    return false;
  }
}

async function getH25Token(
  user: string,
  password: string
): Promise<string | null> {
  let token: string | null = null;
  let payload: any | null = null;
  let verify: string | null = null;
  let context = null;
  let browser = null;

  try {
    browser = await chromium.launch({
      headless: true,
    });
    context = await browser.newContext();
    let page = await context.newPage();
    let loginPage: string | undefined;

    for (const endpoint of endpoints) {
      const loginUrl = endpoint.replace("/api", "/#/index");
      const isReady = await isUrlReady(loginUrl);
      if (isReady) {
        loginPage = loginUrl;
        break;
      }
    }

    if (!loginPage) {
      console.error("No ready login URL found.");
      return null;
    }

    let result = await loginWebCaptureResponse(page, user, password, loginPage);

    token = result.token;
    payload = result.payload;
    verify = result.verifyCode;
    if (!token) {
      console.log("Token not found. Retrying login after 5 seconds...");
      await page.close();
      page = await context.newPage();
      await page.waitForTimeout(5000);

      for (const endpoint of endpoints) {
        const loginUrl = endpoint.replace("/api", "/#/index");
        const isReady = await isUrlReady(loginUrl);
        if (isReady) {
          loginPage = loginUrl;
          break;
        }
      }

      if (!loginPage) {
        console.error("No ready login URL found after retry.");
        return null;
      }

      result = await loginWebCaptureResponse(page, user, password, loginPage);
      token = result.token;
      payload = result.payload;
    }
  } catch (error) {
    console.error("Error occurred during browser operation:", error);
  } finally {
    if (context) {
      await context.close();
    }
    if (browser) {
      await browser.close();
    }
  }

  if (token) {
    console.log("Extracted token:", token);
  } else {
    console.log("Token not found after retry.");
    console.log("Payload:", payload);
  }

  return token;
}

export { getH25Token };
