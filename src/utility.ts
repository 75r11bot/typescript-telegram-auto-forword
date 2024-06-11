import { Page, chromium } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import querystring from "querystring";
import { createWorker as tesseractCreateWorker, Worker } from "tesseract.js";
dotenv.config();

async function createTesseractWorker(): Promise<Worker> {
  try {
    const worker = await tesseractCreateWorker();
    await worker.load();
    await worker.reinitialize("eng"); // Use reinitialize instead of initialize
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

async function loginAndCaptureResponse(
  page: Page,
  user: string,
  password: string
): Promise<{
  verifyCode: any;
  token: string | null;
  payload: any | null;
}> {
  let token: string | null = null;
  let verifyCode: string | null = null;
  let loginPayload: any | null = null;

  try {
    // Navigate to the login page with a longer timeout
    await page.goto("https://75rapp.com/client.html", { timeout: 60000 }); // 60 seconds

    // Interception for API responses
    page.on("response", async (response) => {
      // Check if the response is from the verify code API
      if (response.url().includes("/api/v/user/getVerifyCode?")) {
        const buffer = await response.body();
        console.log("Response from verify code API: received binary data");

        // Save the binary data to an image file
        const imagePath = "./captcha.png";
        fs.writeFileSync(imagePath, buffer);

        // Perform OCR on the saved image
        verifyCode = await extractTextFromImage(imagePath);
        verifyCode = verifyCode.replace(/'/g, "");

        console.log(`Extracted verify code: ${verifyCode}`);
      }

      // Check if the response is from the login API
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

    // Interception for requests to capture payload
    page.on("request", async (request) => {
      if (request.url().includes("/api/v/user/newLoginv2")) {
        const postData = request.postData();
        if (postData) {
          loginPayload = querystring.parse(postData); // Parse the URL-encoded string
          console.log("Login payload:", loginPayload);
        }
      }
    });

    // Perform login actions
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
    await page.waitForTimeout(3000); // Wait for 3 seconds

    // Wait for the verify code to be extracted before filling it in
    if (verifyCode) {
      await iframe.getByRole("textbox").nth(4).fill(verifyCode);
    }

    // Toggle the "Remember me" checkbox if not already checked
    const rememberMeCheckbox = iframe.getByRole("checkbox", {
      name: " จำชื่อผู้ใช้และรหัสผ่าน",
    });
    const isChecked = await rememberMeCheckbox.isChecked();
    if (!isChecked) {
      await rememberMeCheckbox.click(); // Click to check
    }

    await iframe
      .getByRole("button", { name: "ลงชื่อเข้าใช้", exact: true })
      .click();
    await page.waitForTimeout(5000); // Wait for 5 seconds

    // Wait for the iframe to load
    const frame = page.frame({ name: "iframe" });
    if (frame) {
      await frame.waitForLoadState("domcontentloaded");
      await frame.waitForTimeout(3000); // Wait for 3 seconds
    } else {
      console.error("Frame not found");
    }
  } catch (error) {
    console.error("Error occurred during login:", error);
  }

  return { token, payload: loginPayload, verifyCode };
}

async function getH25Token(user: string, password: string) {
  let token: string | null = null;
  let payload: any | null = null;
  let verify: any | null = null;

  try {
    const browser = await chromium.launch({
      headless: true, // Run in headless mode
    });
    const context = await browser.newContext();
    let page = await context.newPage();

    const result = await loginAndCaptureResponse(page, user, password);
    token = result.token;
    payload = result.payload;
    verify = result.verifyCode;
    if (!token) {
      console.log("Token not found. Retrying login after 5 seconds...");
      await page.close();
      page = await context.newPage();
      await page.waitForTimeout(5000); // Wait for 5 seconds before retrying
      const retryResult = await loginAndCaptureResponse(page, user, password);
      token = retryResult.token;
      payload = retryResult.payload;
    }

    await context.close();
    await browser.close();
  } catch (error) {
    console.error("Error occurred during browser operation:", error);
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
      "https://75rapp.com/api/v/user/newLoginv2",
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
