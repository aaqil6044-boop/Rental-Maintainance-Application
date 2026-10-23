"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const config = require("./config");

fs.mkdirSync(config.uploadDir, { recursive: true });

/** The type is decided from the file's own bytes, never from the name or the header the client sent. */
function sniff(buf) {
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: ".png" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg" };
  if (buf.length >= 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return { mime: "image/webp", ext: ".webp" };
  if (buf.length >= 5 && buf.slice(0, 5).toString() === "%PDF-") return { mime: "application/pdf", ext: ".pdf" };
  return null;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

function save(buffer) {
  const type = sniff(buffer);
  if (!type) return null;
  const storedName = crypto.randomBytes(16).toString("hex") + type.ext;
  fs.writeFileSync(path.join(config.uploadDir, storedName), buffer, { flag: "wx" });
  return { storedName, mime: type.mime };
}
const pathOf = (storedName) => path.join(config.uploadDir, path.basename(storedName));
const safeName = (n) => String(n || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";

module.exports = { upload, save, pathOf, safeName, sniff };
