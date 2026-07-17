// src/routes/public.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const { db, uuid, nowISO } = require("../db");
const { scoreTier, DIMENSIONS } = require("../utils");
const bus = require("../eventBus");

const router = express.Router();

const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
router.use(publicLimiter);

function clampStr(v, max){
  if (typeof v !== "string") return "";
  return v.slice(0, max || 200);
}

// --- visit tracking (anonymous, day-bucketed) ---
router.post("/visit", (req, res) => {
  const sessionId = clampStr(req.body && req.body.sessionId, 100);
  if (!sessionId) return res.status(400).json({ error: "sessionId is required." });
  const ts = nowISO();
  db.prepare("INSERT INTO visit_events (id, ts, session_id, day) VALUES (?,?,?,?)")
    .run(uuid(), ts, sessionId, ts.slice(0, 10));
  bus.emit("event", { type: "visit", ts });
  res.json({ ok: true });
});

// --- find-or-create the client row for this browser session ---
function upsertClient(sessionId, org){
  const existing = db.prepare("SELECT * FROM clients WHERE session_id = ?").get(sessionId);
  const now = nowISO();
  if (existing) {
    db.prepare(`UPDATE clients SET name=?, email=?, organization=?, industry=?, job_title=?, company_size=?, assessment_purpose=?, last_activity_at=? WHERE id=?`)
      .run(
        clampStr(org.preparedByName, 150) || existing.name,
        clampStr(org.email, 200) || existing.email,
        clampStr(org.organizationName, 150) || existing.organization,
        clampStr(org.industry, 100) || existing.industry,
        clampStr(org.executiveRole, 100) || existing.job_title,
        clampStr(org.organizationSize, 50) || existing.company_size,
        clampStr(org.assessmentPurpose, 300) || existing.assessment_purpose,
        now, existing.id
      );
    return existing.id;
  }
  const id = uuid();
  db.prepare(`INSERT INTO clients (id, session_id, name, email, organization, industry, country, job_title, company_size, assessment_purpose, registered_at, last_activity_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, sessionId, clampStr(org.preparedByName,150), clampStr(org.email,200), clampStr(org.organizationName,150),
         clampStr(org.industry,100), null, clampStr(org.executiveRole,100), clampStr(org.organizationSize,50),
         clampStr(org.assessmentPurpose,300), now, now);
  return id;
}

// --- assessment started ---
router.post("/assessment/start", (req, res) => {
  const sessionId = clampStr(req.body && req.body.sessionId, 100);
  const org = (req.body && req.body.orgProfile) || {};
  if (!sessionId) return res.status(400).json({ error: "sessionId is required." });

  const clientId = upsertClient(sessionId, org);
  const attemptId = uuid();
  const now = nowISO();
  db.prepare("INSERT INTO assessment_attempts (id, client_id, started_at) VALUES (?,?,?)").run(attemptId, clientId, now);
  bus.emit("event", { type: "assessment_started", ts: now, clientId });
  res.json({ ok: true, clientId, attemptId });
});

// --- assessment completed ---
router.patch("/assessment/:attemptId/complete", (req, res) => {
  const sessionId = clampStr(req.body && req.body.sessionId, 100);
  const dimensionScores = (req.body && req.body.dimensionScores) || {};
  const client = db.prepare("SELECT * FROM clients WHERE session_id = ?").get(sessionId);
  if (!client) return res.status(404).json({ error: "Unknown session." });
  const attempt = db.prepare("SELECT * FROM assessment_attempts WHERE id = ? AND client_id = ?").get(req.params.attemptId, client.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found for this session." });

  let total = 0;
  const cleanScores = {};
  for (const dim of DIMENSIONS) {
    let v = Number(dimensionScores[dim]);
    if (!Number.isFinite(v)) v = 0;
    v = Math.max(0, Math.min(15, Math.round(v)));
    cleanScores[dim] = v;
    total += v;
  }
  const tier = scoreTier(total);
  const now = nowISO();
  db.prepare("UPDATE assessment_attempts SET completed_at=?, dimension_scores=?, total_score=?, tier=? WHERE id=?")
    .run(now, JSON.stringify(cleanScores), total, tier, attempt.id);
  db.prepare("UPDATE clients SET last_activity_at=? WHERE id=?").run(now, client.id);
  bus.emit("event", { type: "assessment_completed", ts: now, clientId: client.id, total, tier });

  res.json({ ok: true, total, tier });
});

// --- report generated/downloaded ---
router.post("/assessment/:attemptId/report-generated", (req, res) => {
  const sessionId = clampStr(req.body && req.body.sessionId, 100);
  const client = db.prepare("SELECT * FROM clients WHERE session_id = ?").get(sessionId);
  if (!client) return res.status(404).json({ error: "Unknown session." });
  const attempt = db.prepare("SELECT * FROM assessment_attempts WHERE id = ? AND client_id = ?").get(req.params.attemptId, client.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found for this session." });
  if (!attempt.report_generated_at) {
    db.prepare("UPDATE assessment_attempts SET report_generated_at=? WHERE id=?").run(nowISO(), attempt.id);
  }
  res.json({ ok: true });
});

// --- reactions (thumbs / rating / comment) ---
router.post("/reaction", (req, res) => {
  const { kind, rating, comment, sessionId } = req.body || {};
  if (!["up","down","rating"].includes(kind)) return res.status(400).json({ error: "kind must be up, down, or rating." });
  let cleanRating = null;
  if (kind === "rating") {
    cleanRating = Math.max(1, Math.min(5, Math.round(Number(rating) || 0)));
  }
  db.prepare("INSERT INTO reactions (id, ts, kind, rating, comment, session_id) VALUES (?,?,?,?,?,?)")
    .run(uuid(), nowISO(), kind, cleanRating, clampStr(comment, 600), clampStr(sessionId, 100));
  bus.emit("event", { type: "reaction", ts: nowISO(), kind });
  res.json({ ok: true });
});

// --- published resources a visitor is entitled to see (read-only, public-facing subset) ---
router.get("/resources", (req, res) => {
  const rows = db.prepare(`SELECT id, title, subtitle, short_description, resource_type, category_id, access_level,
                                   is_featured, is_new, new_badge_expires_at, cover_image_path, published_at
                            FROM hub_resources
                            WHERE status = 'published' AND access_level = 'public_visitor'
                            ORDER BY sort_order ASC, published_at DESC`).all();
  res.json(rows.map(r => ({
    id: r.id, title: r.title, subtitle: r.subtitle, shortDescription: r.short_description,
    resourceType: r.resource_type, isFeatured: !!r.is_featured,
    isNew: !!r.is_new && (!r.new_badge_expires_at || new Date(r.new_badge_expires_at) > new Date()),
    coverImageUrl: r.cover_image_path ? ("/files/covers/" + r.cover_image_path) : null,
    publishedAt: r.published_at
  })));
});

module.exports = router;
