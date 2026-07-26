// @ts-check
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  use: {
    trace: "retain-on-failure"
  },
  projects: [
    { name: "Windows Chrome", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "iPhone Safari", use: { ...devices["iPhone 14"] } },
    { name: "iPad portrait", use: { ...devices["iPad (gen 7)"], viewport: { width: 810, height: 1080 } } },
    { name: "iPad landscape", use: { ...devices["iPad (gen 7)"], viewport: { width: 1080, height: 810 } } },
    { name: "WebKit", use: { ...devices["Desktop Safari"] } }
  ]
});
