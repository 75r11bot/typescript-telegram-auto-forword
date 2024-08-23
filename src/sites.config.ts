import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { SiteConfig } from "./types/site.config.types"; // Import the SiteConfig type

// Load environment variables from .env file
dotenv.config();

// Constants for environment names
const ENV_DEVELOPMENT = "development";
const ENV_PRODUCTION = "production";
const ENV_DEVELOP_DOCKER = "develop_docker";
const ENV_DEFAULT = "default";

// Get the current environment from process.env or fallback to default
const NODE_ENV = process.env.NODE_ENV || ENV_DEFAULT;
const BASE_URL = process.env.BASE_URL || "";
const h25User = process.env.H25_USER || "";
const h25Password = process.env.H25_PASSWORD || "";
const t6User = process.env.T6_USER || "";
const t6Password = process.env.T6_PASSWORD || "";

const bonusT6ChannelId = process.env.BONUS_T6_CHANNEL_ID || "-4238605872";
const bonusH25ChannelId = process.env.BONUS_H25_CHANNEL_ID || "-4266183930";
const T6ChannelId = process.env.T6_CHANNEL_ID || "-1001951928932";
const H25ChannelId = process.env.H25_CHANNEL_ID || "-1001836737719";
const platformType = 2;

// Function to generate a unique siteId
function genSiteid(): string {
  const digits = Array.from({ length: 17 }, () =>
    Math.floor(Math.random() * 10)
  );
  return "14" + digits.join("");
}

// Function to generate a random siteCode
function genSiteCode(): string {
  // Helper function to generate a random string of specified length
  function generateRandomString(length: number): string {
    const characters = "abcdefghijklmnopqrstuvwxyz";
    let result = "";
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      result += characters[randomIndex];
    }
    return result;
  }

  const randomString = generateRandomString(6); // Generate a random string of exactly 6 characters
  const randomDigit = 4; //Math.floor(Math.random() * 10); // Generate a random digit (0-9)
  return `${randomString}-${randomDigit}`; // Combine them into the desired format
}

// Function to generate a random siteSign as a combination of letters and numbers
function genSiteSign(): string {
  const length = 32; // Desired length of the siteSign
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let sign = "";

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    sign += characters[randomIndex];
  }

  return sign.toUpperCase(); // Convert to uppercase if needed
}

// Function to generate a random deviceCode
function genDeviceCode(): string {
  const code = Array.from({ length: 9 }, () =>
    Math.floor(Math.random() * 9)
  ).join("");
  return `deviceCode=${code}`;
}

// Function to load or generate sitePO data
interface SitePO {
  siteCode: string;
  siteId: string;
  siteSign: string;
  deviceCode: string;
}

function loadOrGenerateSitePO(): SitePO {
  const filePath = path.join(__dirname, "sitePO.json");

  if (fs.existsSync(filePath)) {
    // If the file exists, read and return the values
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  } else {
    // Generate the values if the file doesn't exist
    const sitePO = {
      siteCode: genSiteCode(),
      siteId: genSiteid(),
      siteSign: genSiteSign(),
      deviceCode: genDeviceCode(),
    };

    // Save the generated values to the file
    fs.writeFileSync(filePath, JSON.stringify(sitePO), "utf8");

    return sitePO;
  }
}

// Retrieve or generate sitePO data
const sitePO = loadOrGenerateSitePO();
console.log(sitePO);

// Define the site configuration based on the current environment
let siteConfig: SiteConfig; // Explicitly type siteConfig

switch (NODE_ENV) {
  case ENV_DEVELOPMENT:
    siteConfig = {
      siteName: "local-host",
      baseURL: BASE_URL,
      botToken: "6417397590:AAE7IoO4QeiPLWOZXGR8_Z8TdVfZU2bKb3E",
      h25User,
      h25Password,
      t6User,
      t6Password,
      sessionsDirectory: "./sessions/local-host",
      sessionFileName: "./sessions/local-host/local_session.txt",
      bonusT6: bonusT6ChannelId,
      bonusH25: bonusH25ChannelId,
      chatT6: T6ChannelId,
      chatH25: H25ChannelId,
      siteCode: sitePO.siteCode,
      siteId: sitePO.siteId,
      siteSign: sitePO.siteSign,
      deviceCode: sitePO.deviceCode,
      platformType,
    };
    break;
  case ENV_PRODUCTION:
    siteConfig = {
      siteName: "render-host",
      baseURL: BASE_URL,
      botToken: "7393640522:AAHOsuZebF33nso9AX71nB02wUyAeMnOBkM",
      h25User,
      h25Password,
      t6User,
      t6Password,
      sessionsDirectory: "./sessions/render-host",
      sessionFileName: "./sessions/render-host/render_session.txt",
      bonusT6: bonusT6ChannelId,
      bonusH25: bonusH25ChannelId,
      chatT6: T6ChannelId,
      chatH25: H25ChannelId,
      siteCode: sitePO.siteCode,
      siteId: sitePO.siteId,
      siteSign: sitePO.siteSign,
      deviceCode: sitePO.deviceCode,
      platformType,
    };
    break;
  case ENV_DEVELOP_DOCKER:
    siteConfig = {
      siteName: "docker-host",
      baseURL: BASE_URL,
      botToken: "7064883047:AAHQqcByGbSpdY19LQCc99i4ITU_1nK12wM",
      h25User,
      h25Password,
      t6User,
      t6Password,
      sessionsDirectory: "./sessions/docker-host",
      sessionFileName: "./sessions/docker-host/docker_session.txt",
      bonusT6: bonusT6ChannelId,
      bonusH25: bonusH25ChannelId,
      chatT6: T6ChannelId,
      chatH25: H25ChannelId,
      siteCode: sitePO.siteCode,
      siteId: sitePO.siteId,
      siteSign: sitePO.siteSign,
      deviceCode: sitePO.deviceCode,
      platformType,
    };
    break;
  default:
    siteConfig = {
      siteName: "default-host",
      baseURL: BASE_URL,
      botToken: "",
      h25User,
      h25Password,
      t6User,
      t6Password,
      sessionsDirectory: "./sessions/default-host",
      sessionFileName: "./sessions/default-host/default_session.txt",
      bonusT6: bonusT6ChannelId,
      bonusH25: bonusH25ChannelId,
      chatT6: T6ChannelId,
      chatH25: H25ChannelId,
      siteCode: sitePO.siteCode,
      siteId: sitePO.siteId,
      siteSign: sitePO.siteSign,
      deviceCode: sitePO.deviceCode,
      platformType,
    };
    break;
}

// Ensure sessions directory exists
if (!fs.existsSync(siteConfig.sessionsDirectory)) {
  fs.mkdirSync(siteConfig.sessionsDirectory, { recursive: true });
}

export { siteConfig };
