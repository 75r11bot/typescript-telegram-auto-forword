import { Page, chromium } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

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
  let loginTimeout: number = 15000; // Increased timeout

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

    // Wait for successful login indicator
    const loginSuccessText = `ยินดีต้อนรับ ${user}`;
    const loginSuccessH25 = await page.waitForSelector(
      `text=${loginSuccessText}`,
      {
        timeout: loginTimeout,
        state: "visible",
      }
    ); // Increased selector timeout

    if (loginSuccessH25) {
      console.log("Successfully Login H25.");
    } else {
      console.error("Failed Login H25");
    }
  } catch (error) {
    console.error("Error occurred during login:", error);
    // Capture screenshot for debugging
    let screenshotPath = path.resolve(`./screenshots/h25/login_error.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot captured: ${screenshotPath}`);
  }

  return { token, payload: loginPayload, verifyCode };
}

async function loginT6WebCaptureResponse(
  page: Page,
  user: string,
  password: string,
  url: string
) {
  let session: string | null = null;
  let loginTimeout: number = 15000;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 100000 });

    page.on("response", async (response) => {
      if (response.url().includes("/api/login/member")) {
        try {
          const responseBody = await response.text();
          const jsonResponse = JSON.parse(responseBody);
          if (jsonResponse.data && jsonResponse.data.session) {
            session = jsonResponse.data.session;
          }
        } catch (error) {
          console.error("Error parsing response:", error);
        }
      }
    });

    // Check if modal is present and handle the close button
    let modalClosed = false;
    try {
      const modal = await page.waitForSelector(".ant-modal.imageModalCls", {
        timeout: 25000,
        state: "visible",
      });

      if (modal) {
        console.log("Modal found, waiting for Close button");
        const closeButton = await page.getByLabel("Close");

        if (closeButton) {
          console.log("Element Close modal button is ready, clicking it.");
          await closeButton.click();
          modalClosed = true;
        } else {
          console.error("Element Close modal button not found");
        }
      }
    } catch (error) {
      console.error(
        "Modal not found or error waiting for Close button:",
        error
      );
    }

    // Retry if the modal wasn't closed successfully
    if (!modalClosed) {
      try {
        await page.waitForTimeout(5000); // Wait a bit before retrying
        const closeButton = await page.getByLabel("Close");

        if (closeButton) {
          console.log(
            "Retrying: Element Close modal button is ready, clicking it."
          );
          await closeButton.click();
        } else {
          console.error("Retrying: Element Close modal button not found");
        }
      } catch (retryError) {
        console.error(
          "Retry failed: Modal not found or error waiting for Close button:",
          retryError
        );

        // Capture screenshot for debugging
        const screenshotPath = path.resolve(
          `./screenshots/t6/close_button_retry_error.png`
        );
        await page.screenshot({ path: screenshotPath });
        console.log(`Screenshot captured: ${screenshotPath}`);
      }
    }

    console.log("Waiting for Login button");
    const loginButton = await page.getByRole("button", { name: "เข้าสู่ระบบ" });

    if (loginButton) {
      console.log("Element Login modal button is ready, clicking it.");
      await loginButton.click();
    } else {
      console.error("Element Login modal button not found");
    }

    // Check if login dialog is displayed
    try {
      const loginDialog =
        (await page
          .getByRole("dialog")
          .locator("div")
          .filter({
            hasText:
              "ชื่อผู้ใช้ *รหัสผ่าน *เข้าสู่ระบบลืมรหัสผ่าน?ไม่มีบัญชี? ลงทะเบียนบัญชี",
          })
          .nth(1)) ||
        (await page.waitForSelector(".ant-modal.YellowGreenLoginModalCls", {
          state: "visible",
          timeout: 10000,
        }));

      if (loginDialog) {
        await page.getByPlaceholder("ชื่อผู้ใช้").fill(user);
        await page.getByPlaceholder("รหัสผ่าน").fill(password);

        console.log("Waiting for Submit button");
        const submitButton = await page
          .getByRole("dialog")
          .getByRole("button", { name: "เข้าสู่ระบบ" });

        if (submitButton) {
          console.log("Element Submit Login button is ready, clicking it.");
          await submitButton.click();
        } else {
          console.error("Element Submit Login button not found");
        }

        console.log("Waiting for login success indicator");
        const loginSuccessT6 =
          (await page.waitForSelector(".accountCls > .pic", {
            timeout: loginTimeout,
            state: "visible",
          })) || (await page.locator(".accountCls"));

        if (loginSuccessT6) {
          console.log("Successfully logged in to T6.");
        } else {
          console.error("Failed to find login success indicator.");
        }
      } else {
        console.error("Login dialog not found");
      }
    } catch (error) {
      console.error("Error waiting for login dialog:", error);

      // Capture screenshot for debugging
      const screenshotPath = path.resolve(
        `./screenshots/t6/login_dialog_error.png`
      );
      await page.screenshot({ path: screenshotPath });
      console.log(`Screenshot captured: ${screenshotPath}`);
    }
  } catch (error) {
    console.error("Error occurred during login:", error);

    // Capture screenshot for debugging
    const screenshotPath = path.resolve(`./screenshots/t6/login_error.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot captured: ${screenshotPath}`);
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
