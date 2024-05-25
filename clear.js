const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "dist");

fs.rm(dir, { recursive: true, force: true }, (err) => {
  if (err) {
    console.error(`Error while clearing the dist directory: ${err}`);
  } else {
    console.log("dist directory cleared.");
  }
});
