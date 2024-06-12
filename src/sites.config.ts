import fs from "fs";
import dotenv from "dotenv";

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
// Define the site configuration based on the current environment
let siteConfig: any;

switch (NODE_ENV) {
  case ENV_DEVELOPMENT:
    siteConfig = {
      siteCode: "tlf-001",
      siteName: "local-host",
      baseURL: BASE_URL,
      botToken: "6417397590:AAH8oGjlyhTEdxJCafrtSsPKRMJEBWbq3vI",
      h25User: h25User,
      h25Password: h25Password,
      sessionsDirectory: "./sessions/local-host",
      sessionFileName: "./sessions/local-host/local_session.txt",
    };
    break;
  case ENV_PRODUCTION:
    siteConfig = {
      siteCode: "tlf-002",
      siteName: "render-host",
      baseURL: BASE_URL,
      botToken: "7393640522:AAFZGg9Oj0v_BcfApffdYsdqAHU5PtkOHRw",
      h25User: h25User,
      h25Password: h25Password,
      sessionsDirectory: "./sessions/render-host",
      sessionFileName: "./sessions/render-host/render_session.txt",
    };
    break;
  case ENV_DEVELOP_DOCKER:
    siteConfig = {
      siteCode: "tlf-003",
      siteName: "docker-host",
      baseURL: BASE_URL,
      botToken: "7064883047:AAEzslnI5Qg66367WFpx0gBtt8ipA7Ev-AU",
      h25User: h25User,
      h25Password: h25Password,
      sessionsDirectory: "./sessions/docker-host",
      sessionFileName: "./sessions/docker-host/docker_session.txt",
    };
    break;
  default:
    siteConfig = {
      siteCode: "tlf-004",
      siteName: "default-host",
      baseURL: BASE_URL,
      botToken: "7393640522:AAFZGg9Oj0v_BcfApffdYsdqAHU5PtkOHRw",
      h25User: h25User,
      h25Password: h25Password,
      sessionsDirectory: "./sessions/default-host",
      sessionFileName: "./sessions/default-host/default_session.txt",
    };
    break;
}

// Ensure sessions directory exists
if (!fs.existsSync(siteConfig.sessionsDirectory)) {
  fs.mkdirSync(siteConfig.sessionsDirectory, { recursive: true });
}

export { siteConfig };
