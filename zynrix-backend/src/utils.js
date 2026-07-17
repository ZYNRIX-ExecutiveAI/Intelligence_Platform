// src/utils.js
const { db, uuid, nowISO } = require("./db");

function logAudit({ adminId, adminName, action, module, targetType, targetLabel, targetId, details }){
  db.prepare(`INSERT INTO audit_log (id, ts, admin_id, admin_name, action, module, target_type, target_label, target_id, details)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(uuid(), nowISO(), adminId || null, adminName || "System", action, module, targetType || null, targetLabel || null, targetId || null, details || "");
}

const DIMENSIONS = ["Leadership","Strategy","Governance","People","Technology","Data","Operations","Risk","Innovation","Culture"];
const SCORING_BANDS = [
  { min: 126, max: 150, tier: "Vanguard Enterprise" },
  { min: 96,  max: 125, tier: "Advancing Adopter" },
  { min: 66,  max: 95,  tier: "Emerging Explorer" },
  { min: 0,   max: 65,  tier: "Foundational Stage" }
];
function scoreTier(total){
  for (const b of SCORING_BANDS) if (total >= b.min) return b.tier;
  return SCORING_BANDS[SCORING_BANDS.length - 1].tier;
}

function bool(v){ return !!v; }

function resourceRowToJSON(r){
  if (!r) return null;
  return {
    id: r.id, title: r.title, subtitle: r.subtitle, shortDescription: r.short_description, fullDescription: r.full_description,
    resourceType: r.resource_type, categoryId: r.category_id, version: r.version, language: r.language, author: r.author,
    releaseNotes: r.release_notes, intendedAudience: r.intended_audience, estimatedUsageTime: r.estimated_usage_time,
    externalUrl: r.external_url, supportContact: r.support_contact, copyrightNotice: r.copyright_notice,
    tags: r.tags ? JSON.parse(r.tags) : [], journeyStage: r.journey_stage,
    accessLevel: r.access_level, requiresLogin: bool(r.requires_login), requiresEmailCapture: bool(r.requires_email_capture),
    requiresOrgDetails: bool(r.requires_org_details), isFree: bool(r.is_free), isGated: bool(r.is_gated),
    isFeatured: bool(r.is_featured), isRecommended: bool(r.is_recommended), isPinned: bool(r.is_pinned),
    isNew: bool(r.is_new), newBadgeExpiresAt: r.new_badge_expires_at, isUpdated: bool(r.is_updated),
    status: r.status, publishedAt: r.published_at, scheduledPublishAt: r.scheduled_publish_at, expiresAt: r.expires_at,
    reviewDate: r.review_date, owner: r.owner, approvalStatus: r.approval_status, approvedBy: r.approved_by,
    publicationNotes: r.publication_notes, createdBy: r.created_by, updatedBy: r.updated_by,
    createdAt: r.created_at, updatedAt: r.updated_at, archivedAt: r.archived_at,
    downloadCount: r.download_count, viewCount: r.view_count, sortOrder: r.sort_order,
    coverImageUrl: r.cover_image_path ? ("/files/covers/" + r.cover_image_path) : null,
    file: r.current_file_name ? { name: r.current_file_name, ext: r.current_file_ext, mime: r.current_file_mime, size: r.current_file_size } : null
  };
}

module.exports = { logAudit, DIMENSIONS, SCORING_BANDS, scoreTier, resourceRowToJSON };
