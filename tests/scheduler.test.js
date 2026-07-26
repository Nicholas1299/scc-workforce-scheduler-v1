const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function loadScheduler(cryptoValue) {
  const store = {};
  const appNode = { innerHTML: "" };
  const context = {
    console,
    alert() {},
    confirm() { return true; },
    Blob: function () {},
    URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} },
    FileReader: function () {},
    localStorage: {
      getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
      setItem(key, value) { store[key] = String(value); },
      removeItem(key) { delete store[key]; }
    },
    document: {
      createElement() { return { click() {}, set href(v) { this._href = v; }, get href() { return this._href; } }; },
      getElementById(id) { return id === "app" ? appNode : null; },
      querySelectorAll() { return []; }
    },
    window: { crypto: cryptoValue }
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  vm.runInNewContext(appSource, context);
  return context.window.SCCScheduler;
}

function applyShift(schedule, emp, day, type, start, end) {
  schedule.shifts[emp][day] = { type, start: start || "", end: end || "" };
}

function validWeekA(scheduler) {
  const s = scheduler.newWeek("2026-07-20");
  s.weekType = "WEEK_A";
  s.weekAOffEmployee = "nicholas";
  applyShift(s, "nicholas", 0, "custom", "14:00", "21:30");
  applyShift(s, "nicholas", 1, "off");
  applyShift(s, "nicholas", 2, "off");
  applyShift(s, "nicholas", 3, "custom", "14:00", "21:30");
  applyShift(s, "nicholas", 4, "custom", "14:00", "21:30");
  applyShift(s, "nicholas", 5, "custom", "14:00", "21:30");
  applyShift(s, "nicholas", 6, "sundayLong");

  applyShift(s, "jordan", 0, "custom", "08:00", "15:00");
  applyShift(s, "jordan", 1, "custom", "08:00", "15:00");
  applyShift(s, "jordan", 2, "custom", "14:00", "23:00");
  applyShift(s, "jordan", 3, "custom", "08:00", "15:00");
  applyShift(s, "jordan", 4, "custom", "08:00", "15:00");
  applyShift(s, "jordan", 5, "custom", "08:00", "15:00");
  applyShift(s, "jordan", 6, "off");

  applyShift(s, "amiru", 0, "off");
  applyShift(s, "amiru", 1, "custom", "10:00", "23:00");
  applyShift(s, "amiru", 2, "custom", "08:00", "15:00");
  applyShift(s, "amiru", 3, "custom", "14:00", "23:00");
  applyShift(s, "amiru", 4, "custom", "14:00", "22:00");
  applyShift(s, "amiru", 5, "custom", "08:00", "15:00");
  applyShift(s, "amiru", 6, "leave");
  return s;
}

const scheduler = loadScheduler({
  randomUUID() { return "uuid-value"; },
  getRandomValues(bytes) { for (let i = 0; i < bytes.length; i += 1) bytes[i] = i; return bytes; }
});

assert.strictEqual(scheduler.weekStart(new Date("2026-07-25T12:00:00")), "2026-07-20");
assert.strictEqual(scheduler.shiftTimes({ type: "fsClosing" }, 4).hours, 9);
assert.strictEqual(scheduler.shiftTimes({ type: "custom", start: "16:00", end: "01:00" }, 5).hours, 9);

let result = scheduler.validateSchedule(validWeekA(scheduler));
assert.strictEqual(result.validForPublish, true, result.messages.join("\n"));
assert.strictEqual(result.summary.nicholas.hours, 44);
assert.strictEqual(result.summary.jordan.hours, 44);
assert.strictEqual(result.summary.amiru.hours, 44);
assert.strictEqual(result.summary.nicholas.offDays, 2);
assert.strictEqual(result.summary.jordan.offDays, 1);
assert.strictEqual(result.summary.amiru.offDays, 1);

const below = validWeekA(scheduler);
applyShift(below, "jordan", 0, "custom", "08:00", "14:00");
result = scheduler.validateSchedule(below);
assert.strictEqual(result.validForPublish, false);
assert(result.messages.some((m) => m.includes("Jordan has 43 hours. 1 hours remaining.")));

const badSunday = validWeekA(scheduler);
applyShift(badSunday, "jordan", 6, "sundayLong");
result = scheduler.validateSchedule(badSunday);
assert.strictEqual(result.validForPublish, false);
assert(result.messages.some((m) => m.includes("Sunday has 2 employees")));

const badOff = validWeekA(scheduler);
badOff.weekType = "WEEK_B";
result = scheduler.validateSchedule(badOff);
assert.strictEqual(result.validForPublish, false);
assert(result.messages.some((m) => m.includes("wrong number of OFF days for WEEK B")));

const randomUuidScheduler = loadScheduler({ randomUUID() { return "abc"; } });
assert.strictEqual(randomUuidScheduler.createId("x"), "x-abc");
const getRandomValuesScheduler = loadScheduler({
  getRandomValues(bytes) { for (let i = 0; i < bytes.length; i += 1) bytes[i] = 15; return bytes; }
});
assert(/^x-0f0f/.test(getRandomValuesScheduler.createId("x")));
const noCryptoScheduler = loadScheduler(null);
assert(/^x-/.test(noCryptoScheduler.createId("x")));

console.log("scheduler.test.js passed");
