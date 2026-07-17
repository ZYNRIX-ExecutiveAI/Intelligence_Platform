// src/middleware/upload.js
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuid } = require("uuid");
const { db } = require("../db");

const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, "..", "..", "uploads");
const RESOURCES_DIR = path.join(UPLOAD_ROOT, "resources");
const COVERS_DIR = path.join(UPLOAD_ROOT, "covers");
[UPLOAD_ROOT, RESOURCES_DIR, COVERS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const EXECUTABLE_BLOCKLIST = ["exe","msi","bat","cmd","sh","com","scr","js","vbs","ps1","jar","apk","app","dll","dmg","pkg"];

function getSettings(){
  return db.prepare("SELECT * FROM hub_settings WHERE id = 1").get();
}

function extOf(filename){
  const m = /\.([a-zA-Z0-9]+)$/.exec(filename || "");
  return m ? m[1].toLowerCase() : "";
}

const resourceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, RESOURCES_DIR),
  filename: (req, file, cb) => {
    const ext = extOf(file.originalname);
    cb(null, uuid() + (ext ? "." + ext : ""));
  }
});

function resourceFileFilter(req, file, cb){
  const ext = extOf(file.originalname);
  if (EXECUTABLE_BLOCKLIST.includes(ext)) {
    return cb(new Error("Executable and script files (." + ext + ") are not permitted."));
  }
  const settings = getSettings();
  const allowed = settings && settings.allowed_extensions ? JSON.parse(settings.allowed_extensions) : [];
  if (allowed.length && !allowed.includes(ext)) {
    return cb(new Error("." + (ext || "unknown") + " is not an allowed file type."));
  }
  cb(null, true);
}

const uploadResource = multer({
  storage: resourceStorage,
  fileFilter: resourceFileFilter,
  limits: { fileSize: () => 500 * 1024 * 1024 } // hard ceiling; per-request MB limit enforced in the route using hub_settings
});

const coverStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, COVERS_DIR),
  filename: (req, file, cb) => {
    const ext = extOf(file.originalname) || "jpg";
    cb(null, uuid() + "." + ext);
  }
});
const uploadCover = multer({
  storage: coverStorage,
  fileFilter: (req, file, cb) => {
    const ext = extOf(file.originalname);
    if (!["png","jpg","jpeg","webp"].includes(ext)) return cb(new Error("Cover images must be PNG, JPG, or WEBP."));
    cb(null, true);
  },
  limits: { fileSize: 8 * 1024 * 1024 }
});

module.exports = { uploadResource, uploadCover, RESOURCES_DIR, COVERS_DIR, extOf, EXECUTABLE_BLOCKLIST };
