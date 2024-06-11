import { Page, chromium } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config();

import { createWorker as tesseractCreateWorker, Worker } from "tesseract.js";

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
): Promise<string | null> {
  let token: string | null = null;
  let verifyCode: string | null = null;

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
        //console.log("Response from login API:", responseBody);

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

    // Toggle the "Remember me" checkbox
    const rememberMeCheckbox = iframe.getByRole("checkbox", {
      name: " จำชื่อผู้ใช้และรหัสผ่าน",
    });
    if (!rememberMeCheckbox.isChecked) {
      await rememberMeCheckbox.click(); // Click to check
    }

    await iframe
      .getByRole("button", { name: "ลงชื่อเข้าใช้", exact: true })
      .click();
    await page.waitForTimeout(5000); // Wait for 5 seconds
  } catch (error) {
    console.error("Error occurred during login:", error);
  }

  return token;
}

async function getH25Token(user: string, password: string) {
  let token: string | null = null;

  try {
    const browser = await chromium.launch({
      headless: true, // Run in headless mode
    });
    const context = await browser.newContext();
    let page = await context.newPage();

    token = await loginAndCaptureResponse(page, user, password);

    if (!token) {
      console.log("Token not found. Retrying login after 5 seconds...");
      await page.close();
      page = await context.newPage();
      await page.waitForTimeout(5000); // Wait for 5 seconds before retrying
      token = await loginAndCaptureResponse(page, user, password);
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
  }

  return token;
}

export { getH25Token };
function createWorker(arg0: WorkerOptions): Worker | PromiseLike<Worker> {
  throw new Error("Function not implemented.");
}
