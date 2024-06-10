const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "dist");
// const sessionsDir = path.join(__dirname, "sessions");

// Delete the contents of the dist directory
fs.rm(distDir, { recursive: true, force: true }, (err) => {
  if (err) {
    console.error(`Error while clearing the dist directory: ${err}`);
  } else {
    console.log("dist directory cleared.");
  }
});

// // Delete the contents of the sessions directory
// fs.readdir(sessionsDir, (err, files) => {
//   if (err) {
//     console.error(`Error reading sessions directory: ${err}`);
//     return;
//   }

//   files.forEach((file) => {
//     const filePath = path.join(sessionsDir, file);
//     fs.rm(filePath, { recursive: true, force: true }, (err) => {
//       if (err) {
//         console.error(`Error while deleting ${file}: ${err}`);
//       } else {
//         console.log(`Deleted ${file}.`);
//       }
//     });
//   });
// });
