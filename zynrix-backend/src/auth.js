// src/auth.js
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { db, nowISO } = require("./db");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is not set. Set it in your environment before starting the server.");
  process.exit(1);
}
const TOKEN_TTL = "12h";

const ROLES = {
  super_admin:    ["view","create","edit","upload","publish","schedule","unpublish","archive","delete","manage_categories","manage_collections","manage_notifications","view_analytics","export_analytics","manage_settings","manage_admins","view_audit"],
  publisher:      ["view","create","edit","upload","publish","schedule","unpublish","archive","manage_categories","manage_collections","manage_notifications","view_analytics","export_analytics","view_audit"],
  content_editor: ["view","create","edit","upload","view_analytics"],
  analyst:        ["view","view_analytics","export_analytics","view_audit"]
};

function login(email, password){
  const user = db.prepare("SELECT * FROM admin_users WHERE email = ?").get(String(email || "").toLowerCase().trim());
  if (!user) return null;
  const ok = bcrypt.compareSync(password || "", user.password_hash);
  if (!ok) return null;
  db.prepare("UPDATE admin_users SET last_login_at = ? WHERE id = ?").run(nowISO(), user.id);
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
}

function requireAuth(req, res, next){
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
  }
}

function requirePermission(permission){
  return function(req, res, next){
    const perms = ROLES[req.admin && req.admin.role] || [];
    if (!perms.includes(permission)) {
      return res.status(403).json({ error: "Your role doesn't have the '" + permission + "' permission." });
    }
    next();
  };
}

function can(role, permission){
  return (ROLES[role] || []).includes(permission);
}

module.exports = { login, requireAuth, requirePermission, can, ROLES };
