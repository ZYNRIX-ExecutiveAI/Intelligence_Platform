// src/routes/admin/live.js
const express = require("express");
const bus = require("../../eventBus");

const router = express.Router();

// EventSource requests can't set an Authorization header, so the token is
// passed as a query param here and verified manually (read-only channel;
// it only ever pushes "something changed, go refetch" signals).
router.get("/", (req, res) => {
  const jwt = require("jsonwebtoken");
  try {
    jwt.verify(req.query.token || "", process.env.JWT_SECRET);
  } catch (e) {
    return res.status(401).end();
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.write("retry: 3000\n\n");

  const onEvent = (payload) => {
    res.write("data: " + JSON.stringify(payload) + "\n\n");
  };
  bus.on("event", onEvent);

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    bus.removeListener("event", onEvent);
  });
});

module.exports = router;
