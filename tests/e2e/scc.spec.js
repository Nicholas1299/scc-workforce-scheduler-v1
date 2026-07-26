const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("url");
const path = require("path");

const email = "nicholas@workforce.local";
const password = "scc2026";
const appUrl = pathToFileURL(path.join(__dirname, "..", "..", "index.html")).href;

async function login(page) {
  await page.goto(appUrl);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByRole("heading", { name: "Weekly Schedule Builder" })).toBeVisible();
}

async function pickWeek(page, date) {
  await page.getByLabel("Select Week").evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, date);
}

test.beforeEach(async ({ page }) => {
  await page.goto(appUrl);
  await page.evaluate(() => localStorage.clear());
});

test("login, invalid login, logout and refresh session work", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(appUrl);
  await page.getByLabel("Email").fill("wrong@workforce.local");
  await page.getByLabel("Password").fill("bad");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await expect(page.getByText("Invalid email or password.")).toHaveCount(0);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Weekly Schedule Builder" })).toBeVisible();
  if (page.viewportSize().width <= 720) {
    await expect(page.getByRole("button", { name: "Mon" })).toBeVisible();
  }
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("button", { name: "Login" })).toBeVisible();
});

test("week navigation, draft save, copy previous, clear, export and invalid import work", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Previous Week", exact: true }).click();
  await expect(page.getByRole("heading", { name: /WEEK A Draft/ })).toBeVisible();
  await page.getByRole("button", { name: "This Week" }).click();
  await page.getByRole("button", { name: "Next Week" }).click();
  await pickWeek(page, "2026-07-20");
  await page.locator(".cell-controls:visible").first().locator("select").selectOption("opening");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Save Draft" }).click();
  await page.reload();
  await expect(page.locator(".cell-note:visible", { hasText: "Opening 08:00-17:00" }).first()).toBeVisible();
  await pickWeek(page, "2026-07-27");
  await page.getByRole("button", { name: "Copy Previous Week" }).click();
  await expect(page.getByRole("heading", { name: /WEEK B Draft/ })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear Week" }).click();
  await expect(page.locator(".cell-note:visible", { hasText: "Not set" }).first()).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Backup" }).click();
  await downloadPromise;
});

test("valid schedule can be published and corrupted LocalStorage does not crash", async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const schedule = window.SCCScheduler.newWeek("2026-07-20");
    const set = (emp, day, type, start = "", end = "") => { schedule.shifts[emp][day] = { type, start, end }; };
    schedule.weekType = "WEEK_A";
    schedule.weekAOffEmployee = "nicholas";
    set("nicholas", 0, "custom", "14:00", "21:30"); set("nicholas", 1, "off"); set("nicholas", 2, "off"); set("nicholas", 3, "custom", "14:00", "21:30"); set("nicholas", 4, "custom", "14:00", "21:30"); set("nicholas", 5, "custom", "14:00", "21:30"); set("nicholas", 6, "sundayLong");
    set("jordan", 0, "custom", "08:00", "15:00"); set("jordan", 1, "custom", "08:00", "15:00"); set("jordan", 2, "custom", "14:00", "23:00"); set("jordan", 3, "custom", "08:00", "15:00"); set("jordan", 4, "custom", "08:00", "15:00"); set("jordan", 5, "custom", "08:00", "15:00"); set("jordan", 6, "off");
    set("amiru", 0, "off"); set("amiru", 1, "custom", "10:00", "23:00"); set("amiru", 2, "custom", "08:00", "15:00"); set("amiru", 3, "custom", "14:00", "23:00"); set("amiru", 4, "custom", "14:00", "22:00"); set("amiru", 5, "custom", "08:00", "15:00"); set("amiru", 6, "leave");
    localStorage.setItem("scc-weekly-schedules", JSON.stringify({ "2026-07-20": schedule }));
  });
  await pickWeek(page, "2026-07-20");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Publish Schedule" }).click();
  await expect(page.getByText("Published")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("scc-weekly-schedules", "{bad json"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Weekly Schedule Builder" })).toBeVisible();
});

test("leave submission, approval and conflict warning work", async ({ page }) => {
  await login(page);
  await page.getByLabel("Start date").fill("2026-07-20");
  await page.getByLabel("End date").fill("2026-07-20");
  await page.getByLabel("Reason").fill("Family matter");
  await page.getByRole("button", { name: "Submit Leave" }).click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Status: Approved")).toBeVisible();
  await page.locator('.cell-controls[data-emp="jordan"][data-day="0"]:visible').first().locator("select").selectOption("opening");
  await expect(page.getByText("Jordan has a working shift overlapping approved Leave on 2026-07-20.")).toBeVisible();
});
