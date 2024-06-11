import { Page, chromium } from "playwright";
import dotenv from "dotenv";
dotenv.config();
async function loginAndCaptureResponse(
  page: Page,
  user: string,
  password: string
): Promise<string | null> {
  let token: string | null = null;

  try {
    // Navigate to the login page
    await page.goto("https://75rapp.com/client.html");

    // Interception for API response
    page.on("response", async (response) => {
      // Check if the response is from the login API
      if (response.url().includes("/api/v/user/newLoginv2")) {
        const responseBody = await response.text();
        console.log("Response from login API:", responseBody);

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

    // Your existing login actions
    await page
      .frameLocator("#iframe")
      .getByRole("button", { name: "" })
      .click();
    await page.frameLocator("#iframe").getByText("×").click();
    await page
      .frameLocator("#iframe")
      .locator("span")
      .filter({ hasText: "ลงชื่อเข้าใช้" })
      .click();
    await page
      .frameLocator("#iframe")
      .getByPlaceholder("ชื่อผู้ใช้ (ตัวอักษรคำนึงถึงตัวพิมพ์เล็กและใหญ่)")
      .fill(user);
    await page
      .frameLocator("#iframe")
      .getByRole("textbox", {
        name: "รหัสผ่าน (ตัวอักษรคำนึงถึงตัวพิมพ์เล็กและใหญ่)",
      })
      .fill(password);
    await page
      .frameLocator("#iframe")
      .getByRole("button", { name: "ลงชื่อเข้าใช้", exact: true })
      .click();
    await page.waitForTimeout(5000); // Wait for 5 seconds

    // Wait for the iframe to load
    const frame = page.frame({ name: "iframe" });
    if (frame) {
      await frame.waitForLoadState("domcontentloaded");

      // Close any popups within the iframe
      await frame.waitForTimeout(5000); // Wait for 5 seconds
    } else {
      console.error("Frame not found");
    }
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
    // token = process.env.H25_TOKEN || "";
  }

  if (token) {
    console.log("Extracted token:", token);
  } else {
    console.log("Token not found after retry.");
  }

  return token;
}

export { getH25Token };
