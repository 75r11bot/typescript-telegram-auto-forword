import { Page, chromium } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import querystring from "querystring";
import { createWorker as tesseractCreateWorker, Worker } from "tesseract.js";

dotenv.config();

const webLoginUrl = process.env.URL_LOGIN_WEB || "https://h25gg.com/#/index";
const appLoginUrl =
  process.env.URL_LOGIN_APP || "https://75rapp.com/client.html";

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

async function loginAppCaptureResponse(
  page: Page,
  user: string,
  password: string
): Promise<{
  verifyCode: string | null;
  token: string | null;
  payload: any | null;
}> {
  let token: string | null = null;
  let verifyCode: string | null = null;
  let loginPayload: any | null = null;

  try {
    await page.goto(appLoginUrl, { timeout: 60000 });

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

    const iframe = page.frameLocator("#iframe");

    await iframe.getByRole("button", { name: "" }).click();
    await iframe.getByText("×").click();
    await iframe.locator("span").filter({ hasText: "ลงชื่อเข้าใช้" }).click();
    await iframe
      .getByPlaceholder("ชื่อผู้ใช้ (ตัวอักษรคำนึงถึงตัวพิมพ์เล็กและใหญ่)")
      .fill(user);
    await iframe
      .getByRole("textbox", {
        name: "รหัสผ่าน (ตัวอักษรคำนึงถึงตัวพิมพ์เล็กและใหญ่)",
      })
      .fill(password);
    await page.waitForTimeout(3000);

    if (verifyCode) {
      await iframe.getByRole("textbox").nth(4).fill(verifyCode);
    }

    const rememberMeCheckbox = iframe.getByRole("checkbox", {
      name: " จำชื่อผู้ใช้และรหัสผ่าน",
    });
    const isChecked = await rememberMeCheckbox.isChecked();
    if (!isChecked) {
      await rememberMeCheckbox.click();
    }

    await iframe
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

async function loginWebCaptureResponse(
  page: Page,
  user: string,
  password: string
): Promise<{
  verifyCode: string | null;
  token: string | null;
  payload: any | null;
}> {
  let token: string | null = null;
  let verifyCode: string | null = null;
  let loginPayload: any | null = null;

  try {
    await page.goto(webLoginUrl, {
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
    const response = await axios.get(url);
    return response.status === 200;
  } catch (error) {
    console.error(`Error checking URL status: ${error}`);
    return false;
  }
}

async function getH25Token(user: string, password: string) {
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

    const url = webLoginUrl;
    const isReady = await isUrlReady(url);

    let result;
    if (isReady) {
      result = await loginWebCaptureResponse(page, user, password);
    } else {
      result = await loginAppCaptureResponse(page, user, password);
    }

    token = result.token;
    payload = result.payload;
    verify = result.verifyCode;
    if (!token) {
      console.log("Token not found. Retrying login after 5 seconds...");
      await page.close();
      page = await context.newPage();
      await page.waitForTimeout(5000);
      if (isReady) {
        result = await loginWebCaptureResponse(page, user, password);
      } else {
        result = await loginAppCaptureResponse(page, user, password);
      }

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
    token = await getH25TokenRequest(payload, verify);
  }

  return token;
}

async function getH25TokenRequest(loginPayload: any, verify: any) {
  const formData = new FormData();
  Object.keys(loginPayload).forEach((key) => {
    if (key === "verifyCode") {
      formData.append(key, verify);
    } else {
      formData.append(key, loginPayload[key]);
    }
  });

  try {
    const response = await axios.post(
      "https://h25gg.com/api/v/user/newLoginv2",
      formData,
      {
        headers: formData.getHeaders(),
      }
    );

    if (
      response.data.code === 10000 &&
      response.data.data &&
      response.data.data.token
    ) {
      console.log(
        "Extracted token from axios request:",
        response.data.data.token
      );
      return response.data.data.token;
    } else {
      console.log(
        "Failed to extract token with axios request. Response:",
        response.data
      );
      return null;
    }
  } catch (error) {
    console.error("Error occurred during axios request:", error);
    return null;
  }
}

export { getH25Token };
function createWorker(arg0: WorkerOptions): Worker | PromiseLike<Worker> {
  throw new Error("Function not implemented.");
}
