// src/eventBus.js
// A tiny in-process pub/sub used to push real-time updates to any admin
// console connected via Server-Sent Events. Single-process only — if you
// ever scale this API horizontally, swap this for Redis pub/sub or similar.
const { EventEmitter } = require("events");
const bus = new EventEmitter();
bus.setMaxListeners(100);
module.exports = bus;
