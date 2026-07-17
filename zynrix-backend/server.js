require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");

const { db, nowISO } = require("./src/db");
const { requireAuth } = require("./src/auth");
const { logAudit } = require("./src/utils");
const bus = require("./src/eventBus");
const { COVERS_DIR } = require("./src/middleware/upload");

const app = express();
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

const allowedOrigins = (process.env.CORS_ORIGIN || "*").split(",").map(s => s.trim());
app.use(cors({
  origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  methods: ["GET","POST","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

app.use(express.json({ limit: "2mb" }));

// Public, unauthenticated cover images (small, non-sensitive)
app.use("/files/covers", express.static(COVERS_DIR, { maxAge: "1d" }));

app.get("/health", (req, res) => res.json({ ok: true, time: nowISO() }));

// --- public API (called by the platform itself) ---
app.use("/api/public", require("./src/routes/public"));

// --- session / auth ---
app.use("/api/session", require("./src/routes/session"));

// --- live SSE stream authenticates itself (EventSource can't set headers) ---
// must be mounted BEFORE the blanket requireAuth below
app.use("/api/admin/live", require("./src/routes/admin/live"));

// --- everything else under /api/admin requires a valid Bearer token ---
app.use("/api/admin", requireAuth);
app.use("/api/admin/overview", require("./src/routes/admin/overview"));
app.use("/api/admin/clients", require("./src/routes/admin/clients"));
app.use("/api/admin/team", require("./src/routes/admin/adminTeam"));
app.use("/api/admin/hub/categories", require("./src/routes/admin/hub/categories"));
app.use("/api/admin/hub/resources", require("./src/routes/admin/hub/resources"));
app.use("/api/admin/hub/collections", require("./src/routes/admin/hub/collections"));
app.use("/api/admin/hub/notifications", require("./src/routes/admin/hub/notifications"));
app.use("/api/admin/hub/analytics", require("./src/routes/admin/hub/analytics"));
app.use("/api/admin/hub/settings", require("./src/routes/admin/hub/settings"));
app.use("/api/admin/audit-log", require("./src/routes/admin/auditLog"));

// --- multer / general error handler (keeps error responses as clean JSON) ---
app.use((err, req, res, next) => {
  if (err) {
    console.error(err.message);
    return res.status(400).json({ error: err.message || "Something went wrong." });
  }
  next();
});

app.use((req, res) => res.status(404).json({ error: "Not found." }));

// --- background job: process scheduled publications server-side, for real ---
setInterval(() => {
  const due = db.prepare("SELECT id, title FROM hub_resources WHERE status='scheduled' AND scheduled_publish_at <= ?").all(nowISO());
  if (!due.length) return;
  const now = nowISO();
  due.forEach(r => {
    db.prepare("UPDATE hub_resources SET status='published', published_at=?, updated_at=? WHERE id=?").run(now, now, r.id);
    logAudit({ action: "published", module: "executive_hub", targetType: "resource", targetLabel: r.title, targetId: r.id, details: "Scheduled publication processed automatically" });
  });
  bus.emit("event", { type: "hub_change", ts: now });
}, 60 * 1000);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("ZYNRIX admin backend listening on port " + PORT);
});
