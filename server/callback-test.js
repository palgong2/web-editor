require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 5000;

const receivedDir = path.join(__dirname, "callback-received");

if (!fs.existsSync(receivedDir)) {
  fs.mkdirSync(receivedDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, receivedDir);
  },
  filename: (req, file, cb) => {
    const jobId = req.body.jobId || "unknown-job";
    const sessionId = req.body.sessionId || "unknown-session";
    const ext = path.extname(file.originalname || ".mp4") || ".mp4";

    cb(null, `${jobId}-${sessionId}-edited${ext}`);
  }
});

const upload = multer({ storage });

app.get("/", (req, res) => {
  res.send("Callback test server is running.");
});

app.post("/callback", upload.single("video"), (req, res) => {
  console.log("callback received");
  console.log("jobId:", req.body.jobId);
  console.log("sessionId:", req.body.sessionId);
  console.log("file:", req.file?.filename);

  res.json({
    message: "edited video received",
    jobId: req.body.jobId,
    sessionId: req.body.sessionId,
    filename: req.file?.filename
  });
});

app.listen(PORT, () => {
  console.log(`callback test server running: http://localhost:${PORT}`);
});