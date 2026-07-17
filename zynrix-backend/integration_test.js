require("dotenv").config();
const { spawn } = require("child_process");
const path = require("path");

const BASE = "http://localhost:4000";
let failures = 0;
function check(name, cond, extra){
  if (cond) console.log("OK   " + name);
  else { console.log("FAIL " + name + (extra ? " -> " + extra : "")); failures++; }
}

function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

async function main(){
  const server = spawn("node", ["server.js"], { cwd: __dirname, env: process.env });
  server.stdout.on("data", d => process.stdout.write("[server] " + d));
  server.stderr.on("data", d => process.stderr.write("[server-err] " + d));
  await wait(1500);

  try {
    // health
    let r = await fetch(BASE + "/health");
    check("health endpoint", r.ok);

    // login
    r = await fetch(BASE + "/api/session/login", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email: process.env.FIRST_ADMIN_EMAIL, password: process.env.FIRST_ADMIN_PASSWORD }) });
    let loginData = await r.json();
    check("admin login", r.ok && loginData.token, JSON.stringify(loginData));
    const token = loginData.token;
    const authHeaders = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };

    // bad login
    r = await fetch(BASE + "/api/session/login", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email: "admin@zynrix.example", password: "wrong" }) });
    check("bad password rejected", r.status === 401);

    // /me
    r = await fetch(BASE + "/api/session/me", { headers: authHeaders });
    let me = await r.json();
    check("get current admin", r.ok && me.email === process.env.FIRST_ADMIN_EMAIL);

    // unauthenticated admin route rejected
    r = await fetch(BASE + "/api/admin/overview");
    check("unauthenticated admin route rejected", r.status === 401);

    // --- PUBLIC: simulate a real visitor ---
    const sessionId = "test-session-" + Date.now();
    r = await fetch(BASE + "/api/public/visit", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ sessionId }) });
    check("visit ping", r.ok);

    r = await fetch(BASE + "/api/public/assessment/start", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ sessionId, orgProfile: { preparedByName:"Test User", organizationName:"Test Org", industry:"Banking", executiveRole:"CIO", organizationSize:"1000+", assessmentPurpose:"Board readiness", email:"test@example.com" } }) });
    let startData = await r.json();
    check("assessment start", r.ok && startData.attemptId, JSON.stringify(startData));
    const attemptId = startData.attemptId;

    const dimScores = { Leadership:12, Strategy:10, Governance:9, People:8, Technology:11, Data:7, Operations:9, Risk:10, Innovation:8, Culture:9 };
    r = await fetch(BASE + "/api/public/assessment/" + attemptId + "/complete", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ sessionId, dimensionScores: dimScores }) });
    let completeData = await r.json();
    check("assessment complete", r.ok && completeData.total === 93, JSON.stringify(completeData));

    r = await fetch(BASE + "/api/public/assessment/" + attemptId + "/report-generated", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ sessionId }) });
    check("report generated ping", r.ok);

    r = await fetch(BASE + "/api/public/reaction", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ sessionId, kind:"up" }) });
    check("reaction thumbs up", r.ok);
    r = await fetch(BASE + "/api/public/reaction", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ sessionId, kind:"rating", rating:5, comment:"Great tool" }) });
    check("reaction rating", r.ok);

    // --- ADMIN: verify the client shows up ---
    r = await fetch(BASE + "/api/admin/clients", { headers: authHeaders });
    let clients = await r.json();
    check("client list has our test client", clients.length === 1 && clients[0].organization === "Test Org", JSON.stringify(clients));
    check("client status is completed", clients[0].status === "completed");
    check("client attempt has correct tier", clients[0].attempts[0].tier === "Emerging Explorer", clients[0].attempts[0].tier);

    // overview reflects it
    r = await fetch(BASE + "/api/admin/overview", { headers: authHeaders });
    let overview = await r.json();
    check("overview visitorsToday >= 1", overview.visitorsToday >= 1);
    check("overview assessmentsCompletedTotal == 1", overview.assessmentsCompletedTotal === 1);
    check("overview reactions.thumbsUp == 1", overview.reactions.thumbsUp === 1);

    // --- ADMIN: categories ---
    r = await fetch(BASE + "/api/admin/hub/categories", { headers: authHeaders });
    let categories = await r.json();
    check("13 default categories seeded", categories.length === 13, categories.length);
    const catId = categories[0].id;

    r = await fetch(BASE + "/api/admin/hub/categories", { method:"POST", headers: authHeaders, body: JSON.stringify({ name:"Test Category", description:"A test" }) });
    let newCat = await r.json();
    check("create category", r.status === 201 && newCat.id);

    // --- ADMIN: resource upload (multipart) ---
    const FormData = globalThis.FormData;
    const fd = new FormData();
    fd.append("title", "Integration Test Resource");
    fd.append("shortDescription", "A resource created by the automated test.");
    fd.append("resourceType", "Guide");
    fd.append("categoryId", catId);
    fd.append("version", "1.0");
    fd.append("status", "draft");
    fd.append("accessLevel", "registered_user");
    const testFileContent = Buffer.from("This is a fake PDF for testing purposes.");
    fd.append("file", new Blob([testFileContent], { type:"application/pdf" }), "test-resource.pdf");

    r = await fetch(BASE + "/api/admin/hub/resources", { method:"POST", headers: { Authorization: "Bearer " + token }, body: fd });
    let uploadData = await r.json();
    check("resource upload", r.status === 201 && uploadData.id, JSON.stringify(uploadData));
    const resourceId = uploadData.id;

    r = await fetch(BASE + "/api/admin/hub/resources/" + resourceId, { headers: authHeaders });
    let resourceDetail = await r.json();
    check("resource detail fetch", resourceDetail.title === "Integration Test Resource");
    check("resource has 1 version", resourceDetail.versions.length === 1);

    r = await fetch(BASE + "/api/admin/hub/resources/" + resourceId + "/publish", { method:"POST", headers: authHeaders });
    check("publish resource", r.ok);

    r = await fetch(BASE + "/api/admin/hub/resources/" + resourceId, { headers: authHeaders });
    resourceDetail = await r.json();
    check("resource now published", resourceDetail.status === "published");

    // replace file -> new version
    const fd2 = new FormData();
    fd2.append("releaseNotes", "Fixed a typo.");
    fd2.append("file", new Blob([Buffer.from("Updated content v2")], { type:"application/pdf" }), "test-resource-v2.pdf");
    r = await fetch(BASE + "/api/admin/hub/resources/" + resourceId + "/replace-file", { method:"POST", headers: { Authorization: "Bearer " + token }, body: fd2 });
    let replaceData = await r.json();
    check("replace file creates v1.1", replaceData.version === "1.1", JSON.stringify(replaceData));

    // download
    r = await fetch(BASE + "/api/admin/hub/resources/" + resourceId + "/download", { headers: authHeaders });
    check("download resource file", r.ok && r.headers.get("content-disposition"));

    // --- ADMIN: collection ---
    r = await fetch(BASE + "/api/admin/hub/collections", { method:"POST", headers: authHeaders, body: JSON.stringify({ name:"Test Collection", description:"desc", resourceIds:[resourceId], status:"published" }) });
    let colData = await r.json();
    check("create collection", r.status === 201 && colData.id);
    const collectionId = colData.id;

    r = await fetch(BASE + "/api/admin/hub/collections/" + collectionId + "/zip", { headers: authHeaders });
    check("collection zip download", r.ok && r.headers.get("content-type").includes("zip"));

    // --- ADMIN: notifications ---
    r = await fetch(BASE + "/api/admin/hub/notifications", { method:"POST", headers: authHeaders, body: JSON.stringify({ title:"Test Notif", message:"msg", targetAudience:"all_registered", channels:["in_app"] }) });
    let notifData = await r.json();
    check("create notification", r.status === 201 && notifData.id);

    // --- ADMIN: analytics ---
    r = await fetch(BASE + "/api/admin/hub/analytics?days=30", { headers: authHeaders });
    let analytics = await r.json();
    check("analytics endpoint responds", r.ok && Array.isArray(analytics.viewsSeries));

    r = await fetch(BASE + "/api/admin/hub/analytics/export.csv", { headers: authHeaders });
    check("analytics csv export", r.ok && (await r.text()).includes("Resource"));

    // --- ADMIN: settings ---
    r = await fetch(BASE + "/api/admin/hub/settings", { headers: authHeaders });
    let settings = await r.json();
    check("settings fetch", r.ok && settings.maxFileSizeMB === 25);

    r = await fetch(BASE + "/api/admin/hub/settings", { method:"PATCH", headers: authHeaders, body: JSON.stringify({ maxFileSizeMB: 40 }) });
    check("settings update", r.ok);
    r = await fetch(BASE + "/api/admin/hub/settings", { headers: authHeaders });
    settings = await r.json();
    check("settings persisted", settings.maxFileSizeMB === 40);

    // --- ADMIN: audit log ---
    r = await fetch(BASE + "/api/admin/audit-log", { headers: authHeaders });
    let auditLog = await r.json();
    check("audit log has entries", auditLog.length > 5, auditLog.length);

    // --- ADMIN: team management ---
    r = await fetch(BASE + "/api/admin/team", { method:"POST", headers: authHeaders, body: JSON.stringify({ name:"Analyst Test", email:"analyst@zynrix.example", role:"analyst", password:"analystpass123" }) });
    let teamData = await r.json();
    check("add admin team member", r.status === 201 && teamData.id);

    // login as the new analyst and confirm permission restriction
    r = await fetch(BASE + "/api/session/login", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email:"analyst@zynrix.example", password:"analystpass123" }) });
    let analystLogin = await r.json();
    const analystHeaders = { Authorization: "Bearer " + analystLogin.token, "Content-Type":"application/json" };
    r = await fetch(BASE + "/api/admin/hub/resources/" + resourceId + "/publish", { method:"POST", headers: analystHeaders });
    check("analyst cannot publish (403)", r.status === 403);

    // --- reject bad file type ---
    const fdBad = new FormData();
    fdBad.append("title", "Bad file test");
    fdBad.append("categoryId", catId);
    fdBad.append("file", new Blob([Buffer.from("x")], { type:"application/x-msdownload" }), "virus.exe");
    r = await fetch(BASE + "/api/admin/hub/resources", { method:"POST", headers: { Authorization: "Bearer " + token }, body: fdBad });
    check("exe upload rejected", r.status === 400, r.status);

    // --- SSE smoke check: just verify it accepts the connection and headers are right ---
    r = await fetch(BASE + "/api/admin/live?token=" + token, { headers: { Accept: "text/event-stream" } });
    check("SSE endpoint responds with event-stream", r.headers.get("content-type") && r.headers.get("content-type").includes("text/event-stream"));

  } catch (e) {
    console.log("EXCEPTION: " + e.stack);
    failures++;
  } finally {
    server.kill();
    await wait(300);
  }

  console.log("\n=== " + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED") + " ===");
  process.exit(failures === 0 ? 0 : 1);
}

main();
