import { Page, chromium } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
import axios, { AxiosError } from "axios";
import querystring from "querystring";
import { createWorker as tesseractCreateWorker, Worker } from "tesseract.js";

dotenv.config();

const endpoints = [
  process.env.API_ENDPOINT_1,
  process.env.API_ENDPOINT_2,
  process.env.API_ENDPOINT_3,
  process.env.API_ENDPOINT_4,
].filter(Boolean) as string[];

const t6Endpoint = process.env.API_ENDPOINT_T6 || "";

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
      waitUntil: "domcontentloaded",
      timeout: 60000,
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

    let verifyCode = ""; // Initialize verifyCode variable

    if (verifyCode) {
      await page.locator('input[type="text"]').nth(2).click();
      await page.locator('input[type="text"]').nth(2).fill(verifyCode);
    }

    await page
      .getByRole("button", { name: "ลงชื่อเข้าใช้", exact: true })
      .click();

    let loginTimeout = 10000;
    const frame = await page.frame({ name: "iframe" });
    if (frame) {
      await frame.waitForLoadState("domcontentloaded", {
        timeout: loginTimeout,
      });
    } else {
      console.error("H25 Frame not found");
      loginTimeout = loginTimeout * 2;
    }

    // Wait for successful login indicator
    const loginSuccessText = `ยินดีต้อนรับ ${user}`;
    await page.waitForSelector(`text=${loginSuccessText}`, {
      timeout: loginTimeout,
    }); // Increase selector timeout

    if (loginSuccessText) {
      console.log("Successfully Login H25.");
    } else {
      console.error("Failed Login H25");
    }
  } catch (error) {
    console.error("Error occurred during login:", error);
  }

  return { token, payload: loginPayload, verifyCode };
}

async function loginT6WebCaptureResponse(
  page: Page,
  user: string,
  password: string,
  url: string
) {
  let session = null;
  let loginTimeout = 10000;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 100000 });

    page.on("response", async (response) => {
      if (response.url().includes("/api/login/member")) {
        try {
          const responseBody = await response.text();
          const jsonResponse = JSON.parse(responseBody);
          if (
            jsonResponse.code === 0 &&
            jsonResponse.data &&
            jsonResponse.data.session
          ) {
            session = jsonResponse.data.session;
          }
        } catch (error) {
          console.error("Error parsing response:", error);
        }
      }
    });

    // Use a more specific selector for the close button
    const closeButton = await page.waitForSelector(
      'button.ant-modal-close[aria-label="Close"]',
      {
        timeout: loginTimeout, // Increase timeout
      }
    );

    if (closeButton) {
      console.log("Close button found, clicking it.");
      await closeButton.click();
    } else {
      loginTimeout = loginTimeout * 1.5;
      console.error("Close button not found");
    }

    // Use updated selector for the login button
    const loginButton = await page.waitForSelector(
      'button.ant-btn.btn.gold:has-text("เข้าสู่ระบบ")',
      { timeout: 5000 } // Increase timeout
    );

    if (loginButton) {
      console.log("Login button found, clicking it.");
      await loginButton.click();
    } else {
      console.error("Login button not found");
    }

    await page.getByPlaceholder("ชื่อผู้ใช้").fill(user);
    await page.getByPlaceholder("รหัสผ่าน").fill(password);

    // Use updated selector for the submit button
    const submitButton = await page.waitForSelector(
      'button.ant-btn.ant-btn-block.btn.red:has-text("เข้าสู่ระบบ")',
      { timeout: 5000 } // Increase timeout
    );

    if (submitButton) {
      console.log("Submit button found, clicking it.");
      await submitButton.click();
    } else {
      console.error("Submit button not found");
    }

    const frame = await page.frame({ name: "iframe" });
    if (frame) {
      const frameState = await frame.waitForLoadState("domcontentloaded", {
        timeout: loginTimeout,
      });
      console.log(frameState);
    } else {
      console.error("T6 Frame not found");
      loginTimeout = loginTimeout * 1.5;
    }

    // Wait for successful login indicator (adjust text selector as needed)
    const loginSuccessText = await page.waitForSelector(".accountCls > .pic", {
      timeout: loginTimeout,
    });
    if (loginSuccessText) {
      console.log("Successfully Login T6.");
    } else {
      console.error("Failed to find login success indicator.");
    }
  } catch (error) {
    console.error("Error occurred during login:", error);
  }

  return { session };
}

async function isUrlReady(url: string, retries = 3): Promise<boolean> {
  let retryCount = 0;
  while (retryCount < retries) {
    try {
      const response = await axios.get(url, { timeout: 10000 });
      if (response.status === 200) {
        return true;
      }
    } catch (error) {
      console.error(`Error checking URL status: ${error}`);
      if (axios.isAxiosError(error) && error.code === "ECONNABORTED") {
        console.log(
          `Timeout occurred on attempt ${retryCount + 1}. Retrying...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retryCount) * 1000)
        );
        retryCount++;
        continue;
      }
    }
    retryCount++;
  }

  return false;
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

async function getT6Session(
  user: string,
  password: string
): Promise<string | null> {
  let session: string | null = null;
  let context = null;
  let browser = null;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    let page = await context.newPage();
    const loginUrl = t6Endpoint.replace("/api", "/th-th/home");

    if (!loginUrl) {
      console.error("No ready login URL found.");
      return null;
    }

    let result = await loginT6WebCaptureResponse(
      page,
      user,
      password,
      loginUrl
    );

    session = result.session;

    if (!session) {
      console.log("Session not found. Retrying login after 5 seconds...");
      await page.close();
      page = await context.newPage();
      await page.waitForTimeout(5000);

      const loginUrl = t6Endpoint.replace("/api", "/th-th/home");

      if (!loginUrl) {
        console.error("No ready login URL found.");
        return null;
      }

      result = await loginT6WebCaptureResponse(page, user, password, loginUrl);

      session = result.session;
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

  if (session) {
    console.log("Extracted session:", session);
  } else {
    console.log("Session not found after retry.");
  }

  return session;
}

export { getH25Token, getT6Session };
