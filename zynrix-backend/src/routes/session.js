// src/routes/session.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const { login, requireAuth } = require("../auth");
const { db } = require("../db");

const router = express.Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in a few minutes." } });

router.post("/login", loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  const result = login(email, password);
  if (!result) return res.status(401).json({ error: "Incorrect email or password." });
  res.json(result);
});

router.get("/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, name, email, role FROM admin_users WHERE id = ?").get(req.admin.id);
  if (!user) return res.status(404).json({ error: "Admin account no longer exists." });
  res.json(user);
});

module.exports = router;
