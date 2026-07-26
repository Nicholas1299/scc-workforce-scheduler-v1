(function () {
  "use strict";

  var STORAGE_KEYS = {
    employees: "scc-employees",
    schedules: "scc-weekly-schedules",
    leaves: "scc-leave-requests",
    templates: "scc-shift-templates",
    session: "scc-session",
    version: "scc-app-version"
  };
  var APP_VERSION = "1.0.1";
  var EMPLOYEES = [
    { id: "nicholas", name: "Nicholas", email: "nicholas@workforce.local", role: "Admin", password: "Admin123!" },
    { id: "jordan", name: "Jordan", email: "jordan@workforce.local", role: "Employee", password: "Employee123!" },
    { id: "amiru", name: "Amiru", email: "amiru@workforce.local", role: "Employee", password: "Employee123!" }
  ];
  var DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var SHIFT_TEMPLATES = {
    opening: { label: "Opening", start: "08:00", end: "17:00" },
    mid: { label: "Mid Shift", start: "10:00", end: "19:00" },
    afternoon: { label: "Afternoon", start: "12:00", end: "21:00" },
    closing: { label: "Closing", start: "14:00", end: "23:00" },
    fsClosing: { label: "Friday/Saturday Closing", start: "16:00", end: "01:00" },
    sundayLong: { label: "Sunday Long Shift", start: "08:00", end: "22:00" },
    off: { label: "OFF" },
    leave: { label: "Leave" },
    custom: { label: "Custom Shift" }
  };
  var state = {
    session: null,
    schedules: {},
    leaves: [],
    selectedWeekStart: weekStart(new Date()),
    selectedMobileDay: 0,
    message: ""
  };

  function pad(n) { return String(n).padStart(2, "0"); }
  function toDate(value) {
    var d = value instanceof Date ? new Date(value.getTime()) : new Date(value + "T00:00:00");
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function dateKey(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }
  function addDays(date, count) {
    var d = toDate(dateKey(date));
    d.setDate(d.getDate() + count);
    return d;
  }
  function weekStart(date) {
    var d = toDate(dateKey(date));
    var day = d.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    return dateKey(addDays(d, diff));
  }
  function formatRange(weekStartKey) {
    var start = toDate(weekStartKey);
    var end = addDays(start, 6);
    return start.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) +
      " - " + end.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }
  function createId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return prefix + "-" + window.crypto.randomUUID();
    }
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return prefix + "-" + Array.prototype.map.call(bytes, function (b) { return pad(b.toString(16)); }).join("");
    }
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  function safeRead(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function initStorage() {
    migrateAuthRecords();
    if (!safeRead(STORAGE_KEYS.templates, null)) write(STORAGE_KEYS.templates, SHIFT_TEMPLATES);
    localStorage.setItem(STORAGE_KEYS.version, APP_VERSION);
    state.schedules = safeRead(STORAGE_KEYS.schedules, {});
    state.leaves = safeRead(STORAGE_KEYS.leaves, []);
    state.session = safeRead(STORAGE_KEYS.session, null);
  }
  function stripPassword(emp) {
    return { id: emp.id, name: emp.name, email: emp.email, role: emp.role };
  }
  function accountRecord(emp) {
    var record = stripPassword(emp);
    record.password = emp.password;
    return record;
  }
  function migrateAuthRecords() {
    var migrated = EMPLOYEES.map(accountRecord);
    write(STORAGE_KEYS.employees, migrated);
    var session = safeRead(STORAGE_KEYS.session, null);
    if (session && !EMPLOYEES.some(function (emp) { return emp.id === session.employeeId; })) {
      localStorage.removeItem(STORAGE_KEYS.session);
    }
  }
  function accounts() {
    var saved = safeRead(STORAGE_KEYS.employees, null);
    if (!Array.isArray(saved)) {
      migrateAuthRecords();
      saved = safeRead(STORAGE_KEYS.employees, []);
    }
    return EMPLOYEES.map(function (seed) {
      var stored = saved.find(function (emp) { return emp && emp.id === seed.id; }) || {};
      return {
        id: seed.id,
        name: seed.name,
        email: String(stored.email || seed.email).trim().toLowerCase(),
        role: seed.role,
        password: seed.password
      };
    });
  }
  function authenticate(email, password) {
    var normalizedEmail = String(email || "").trim().toLowerCase();
    var normalizedPassword = String(password || "").trim();
    return accounts().find(function (account) {
      return account.email.toLowerCase() === normalizedEmail && account.password === normalizedPassword;
    }) || null;
  }
  function currentUser() {
    if (!state.session) return null;
    return EMPLOYEES.find(function (e) { return e.id === state.session.employeeId; }) || null;
  }
  function blankShift() {
    return { type: "", start: "", end: "" };
  }
  function newWeek(weekStartKey) {
    var schedule = {
      id: weekStartKey,
      weekStart: weekStartKey,
      weekType: "WEEK_A",
      weekAOffEmployee: "nicholas",
      status: "Draft",
      updatedAt: new Date().toISOString(),
      shifts: {}
    };
    EMPLOYEES.forEach(function (emp) {
      schedule.shifts[emp.id] = DAYS.map(function () { return blankShift(); });
    });
    return schedule;
  }
  function getSchedule() {
    var key = state.selectedWeekStart;
    if (!state.schedules[key]) state.schedules[key] = newWeek(key);
    state.schedules[key] = normalizeSchedule(state.schedules[key], key);
    return state.schedules[key];
  }
  function normalizeSchedule(schedule, weekStartKey) {
    var clean = schedule && typeof schedule === "object" ? schedule : {};
    clean.id = clean.id || weekStartKey;
    clean.weekStart = weekStartKey;
    clean.weekType = clean.weekType === "WEEK_B" ? "WEEK_B" : "WEEK_A";
    clean.weekAOffEmployee = EMPLOYEES.some(function (emp) { return emp.id === clean.weekAOffEmployee; }) ? clean.weekAOffEmployee : "nicholas";
    clean.status = clean.status === "Published" ? "Published" : "Draft";
    clean.updatedAt = clean.updatedAt || new Date().toISOString();
    clean.shifts = clean.shifts && typeof clean.shifts === "object" ? clean.shifts : {};
    EMPLOYEES.forEach(function (emp) {
      if (!Array.isArray(clean.shifts[emp.id])) clean.shifts[emp.id] = [];
      for (var i = 0; i < DAYS.length; i += 1) {
        var shift = clean.shifts[emp.id][i];
        clean.shifts[emp.id][i] = shift && typeof shift === "object" ? {
          type: shift.type || "",
          start: shift.start || "",
          end: shift.end || ""
        } : blankShift();
      }
    });
    return clean;
  }
  function saveSchedule(schedule, status) {
    schedule.status = status || schedule.status || "Draft";
    schedule.updatedAt = new Date().toISOString();
    state.schedules[schedule.weekStart] = schedule;
    write(STORAGE_KEYS.schedules, state.schedules);
  }
  function minutes(time) {
    if (!/^\d{2}:\d{2}$/.test(time || "")) return NaN;
    var parts = time.split(":").map(Number);
    if (parts[0] > 23 || parts[1] > 59) return NaN;
    return parts[0] * 60 + parts[1];
  }
  function businessClose(dayIndex) {
    if (dayIndex === 6) return 22 * 60;
    if (dayIndex === 4 || dayIndex === 5) return 25 * 60;
    return 23 * 60;
  }
  function shiftTimes(shift, dayIndex) {
    if (!shift || ["off", "leave", ""].indexOf(shift.type) >= 0) return null;
    var source = shift.type === "custom" ? shift : SHIFT_TEMPLATES[shift.type];
    if (!source) return null;
    var start = minutes(source.start);
    var end = minutes(source.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { invalid: true };
    if (end <= start) end += 1440;
    return { start: start, end: end, hours: (end - start) / 60, label: source.label };
  }
  function overlaps(a, b) {
    return a && b && a.start < b.end && b.start < a.end;
  }
  function approvedLeaveFor(empId, dateKeyValue) {
    var d = toDate(dateKeyValue).getTime();
    return state.leaves.filter(function (leave) {
      return leave.employeeId === empId && leave.status === "Approved" &&
        toDate(leave.startDate).getTime() <= d && toDate(leave.endDate).getTime() >= d;
    });
  }
  function isWorking(shift) {
    return shift && ["opening", "mid", "afternoon", "closing", "fsClosing", "sundayLong", "custom"].indexOf(shift.type) >= 0;
  }
  function validateSchedule(schedule) {
    var messages = [];
    var blocking = [];
    var summary = {};
    EMPLOYEES.forEach(function (emp) {
      summary[emp.id] = { hours: 0, workingDays: 0, offDays: 0, leaveDays: 0, ot: 0 };
    });
    DAYS.forEach(function (day, dayIndex) {
      var date = dateKey(addDays(toDate(schedule.weekStart), dayIndex));
      var daytime = 0;
      var night = 0;
      var sundayWorkers = 0;
      EMPLOYEES.forEach(function (emp) {
        var shift = schedule.shifts[emp.id][dayIndex] || blankShift();
        var approvedLeaves = approvedLeaveFor(emp.id, date);
        if (!shift.type) {
          messages.push(emp.name + " is missing required information on " + date + ".");
          blocking.push("Missing required information");
          return;
        }
        if (shift.type === "off") summary[emp.id].offDays += 1;
        if (shift.type === "leave") summary[emp.id].leaveDays += 1;
        if (shift.type === "leave" && approvedLeaves.length === 0) {
          messages.push(emp.name + " is marked Leave on " + date + " but has no approved leave.");
        }
        if (isWorking(shift)) {
          var t = shiftTimes(shift, dayIndex);
          if (!t || t.invalid) {
            messages.push(emp.name + " has invalid start and end time on " + date + ".");
            blocking.push("Invalid times");
            return;
          }
          if (t.start < 8 * 60 || t.end > businessClose(dayIndex)) {
            messages.push(emp.name + " has a shift outside business hours on " + date + ".");
            blocking.push("Shift outside business hours");
          }
          if ((shift.type === "custom") && t.end - t.start > 16 * 60) {
            messages.push(emp.name + " has an invalid overnight shift on " + date + ".");
            blocking.push("Invalid overnight shift");
          }
          if (approvedLeaves.length > 0) {
            messages.push(emp.name + " has a working shift overlapping approved Leave on " + date + ".");
            blocking.push("Leave conflict");
          }
          summary[emp.id].hours += t.hours;
          summary[emp.id].workingDays += 1;
          if (overlaps(t, { start: 8 * 60, end: 17 * 60 })) daytime += 1;
          if (overlaps(t, { start: 17 * 60, end: businessClose(dayIndex) })) night += 1;
          if (dayIndex === 6) sundayWorkers += 1;
          if (dayIndex === 6 && (t.start !== 8 * 60 || t.end !== 22 * 60)) {
            messages.push("Sunday shift must be 08:00-22:00.");
            blocking.push("Invalid Sunday shift");
          }
        }
      });
      if (dayIndex < 6) {
        if (daytime < 2) {
          messages.push(date + " daytime coverage has only " + daytime + " employee" + (daytime === 1 ? "" : "s") + ".");
          blocking.push("Missing daytime coverage");
        }
        if (night < 1) {
          messages.push(date + " night coverage has only " + night + " employees.");
          blocking.push("Missing night coverage");
        }
      } else {
        if (sundayWorkers === 0) {
          messages.push("Sunday has no employee working. Exactly 1 employee is required.");
          blocking.push("No employee working Sunday");
        }
        if (sundayWorkers > 1) {
          messages.push("Sunday has " + sundayWorkers + " employees. Only 1 employee is allowed.");
          blocking.push("More than one employee working Sunday");
        }
      }
    });
    EMPLOYEES.forEach(function (emp) {
      var s = summary[emp.id];
      s.ot = Math.max(0, s.hours - 44);
      if (s.hours < 44) {
        messages.push(emp.name + " has " + trimHours(s.hours) + " hours. " + trimHours(44 - s.hours) + " hours remaining.");
        blocking.push("Employee below 44 hours");
      }
      if (s.hours > 44) {
        messages.push(emp.name + " has " + trimHours(s.hours) + " hours. " + trimHours(s.hours - 44) + " OT hours.");
        blocking.push("Employee above 44 hours");
      }
    });
    var offProblems = offRuleProblems(schedule, summary);
    offProblems.forEach(function (msg) {
      messages.push(msg);
      blocking.push("Incorrect OFF-day allocation");
    });
    return {
      summary: summary,
      messages: unique(messages),
      blocking: unique(blocking),
      validForPublish: unique(blocking).length === 0
    };
  }
  function trimHours(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }
  function unique(list) {
    return list.filter(function (item, index) { return item && list.indexOf(item) === index; });
  }
  function expectedOffCounts(schedule) {
    var result = {};
    EMPLOYEES.forEach(function (e) { result[e.id] = schedule.weekType === "WEEK_A" ? 1 : 2; });
    if (schedule.weekType === "WEEK_A") result[schedule.weekAOffEmployee] = 2;
    if (schedule.weekType === "WEEK_B") result[schedule.weekAOffEmployee] = 1;
    return result;
  }
  function offRuleProblems(schedule, summary) {
    var expected = expectedOffCounts(schedule);
    var out = [];
    EMPLOYEES.forEach(function (emp) {
      if (summary[emp.id].offDays !== expected[emp.id]) {
        out.push(emp.name + " has the wrong number of OFF days for " + schedule.weekType.replace("_", " ") + ". Expected " + expected[emp.id] + ", found " + summary[emp.id].offDays + ".");
      }
    });
    return out;
  }
  function render() {
    initStorage();
    var user = currentUser();
    document.getElementById("app").innerHTML = user ? appHtml(user) : loginHtml();
    bindEvents();
  }
  function loginHtml() {
    return '<main class="login-wrap"><section class="login-panel"><h1>SCC Workforce Scheduler V1</h1><p>Sign in to view or manage the weekly roster.</p><form id="login-form"><div class="form-row"><label for="email">Email</label><input id="email" type="email" autocomplete="username" required></div><div class="form-row"><label for="password">Password</label><div class="password-line"><input id="password" type="password" autocomplete="current-password" required><button type="button" id="toggle-password">Show</button></div><p class="field-note">Leading and trailing password spaces are ignored.</p></div><div id="login-error"></div><button class="primary" type="submit">Login</button></form></section></main>';
  }
  function appHtml(user) {
    var schedule = getSchedule();
    var validation = validateSchedule(schedule);
    var admin = user.role === "Admin";
    return '<main class="app-shell"><div class="topbar"><div class="brand"><h1>Weekly Schedule Builder</h1><p>' + escapeHtml(formatRange(state.selectedWeekStart)) + '</p></div><div class="user-box"><span class="role-pill">' + escapeHtml(user.name) + ' - ' + escapeHtml(user.role) + '</span><button id="logout">Logout</button></div></div><div class="main-grid"><section class="panel"><div class="panel-head"><div><h2>' + escapeHtml(schedule.weekType.replace("_", " ")) + ' <span class="status-pill ' + schedule.status.toLowerCase() + '">' + escapeHtml(schedule.status) + '</span></h2><p class="muted">' + escapeHtml(formatRange(schedule.weekStart)) + '</p></div>' + weekToolbarHtml(admin, schedule) + '</div>' + scheduleTableHtml(schedule, user, admin) + '</section><aside>' + summaryHtml(validation, schedule) + leaveHtml(user, admin) + '</aside></div>' + bottomActionsHtml(admin) + '</main>';
  }
  function weekToolbarHtml(admin, schedule) {
    return '<div class="toolbar"><button id="prev-week">Previous Week</button><button id="this-week">This Week</button><button id="next-week">Next Week</button><input id="week-picker" type="date" value="' + state.selectedWeekStart + '" aria-label="Select Week">' + (admin ? '<button id="copy-prev">Copy Previous Week</button><label>Week Type<select id="week-type"><option value="WEEK_A"' + selected(schedule.weekType, "WEEK_A") + '>Week A</option><option value="WEEK_B"' + selected(schedule.weekType, "WEEK_B") + '>Week B</option></select></label><label>Week A 2 OFF<select id="week-a-off">' + EMPLOYEES.map(function (e) { return '<option value="' + e.id + '"' + selected(schedule.weekAOffEmployee, e.id) + '>' + e.name + '</option>'; }).join("") + '</select></label>' : '') + '</div>';
  }
  function scheduleTableHtml(schedule, user, admin) {
    var employees = admin ? EMPLOYEES : EMPLOYEES.filter(function (e) { return e.id === user.id; });
    var desktop = '<div class="table-wrap"><table><thead><tr><th>Employee</th>' + DAYS.map(function (d, i) { return '<th>' + d + '<br><span class="muted">' + dateKey(addDays(toDate(schedule.weekStart), i)) + '</span></th>'; }).join("") + '</tr></thead><tbody>' + employees.map(function (emp) {
      return '<tr><td class="employee-name">' + emp.name + '</td>' + DAYS.map(function (_, dayIndex) { return '<td>' + shiftControl(schedule, emp.id, dayIndex, admin) + '</td>'; }).join("") + '</tr>';
    }).join("") + '</tbody></table></div>';
    var mobile = '<div class="mobile-tabs"><div class="day-tab-list">' + DAYS.map(function (d, i) { return '<button class="day-tab ' + (i === state.selectedMobileDay ? "active" : "") + '" data-day="' + i + '">' + DAY_SHORT[i] + '</button>'; }).join("") + '</div><div class="mobile-day-card"><h3>' + DAYS[state.selectedMobileDay] + '</h3>' + employees.map(function (emp) { return '<div class="mobile-employee"><label>' + emp.name + '</label>' + shiftControl(schedule, emp.id, state.selectedMobileDay, admin) + '</div>'; }).join("") + '</div></div>';
    return desktop + mobile;
  }
  function shiftControl(schedule, empId, dayIndex, editable) {
    var shift = schedule.shifts[empId][dayIndex] || blankShift();
    var date = dateKey(addDays(toDate(schedule.weekStart), dayIndex));
    var leaves = approvedLeaveFor(empId, date);
    if (!editable) return '<div class="readonly-shift">' + shiftLabel(shift, dayIndex) + (leaves.length ? '<div class="warning">Approved Leave</div>' : '') + '</div>';
    return '<div class="cell-controls" data-emp="' + empId + '" data-day="' + dayIndex + '"><select class="shift-type">' + ['','opening','mid','afternoon','closing','fsClosing','sundayLong','off','leave','custom'].map(function (type) {
      var label = type ? SHIFT_TEMPLATES[type].label : "Select shift";
      return '<option value="' + type + '"' + selected(shift.type, type) + '>' + label + '</option>';
    }).join("") + '</select><div class="custom-times" style="' + (shift.type === "custom" ? "" : "display:none") + '"><input class="start-time" type="time" step="1800" value="' + (shift.start || "") + '" aria-label="Start time"><input class="end-time" type="time" step="1800" value="' + (shift.end || "") + '" aria-label="End time"></div><div class="cell-note">' + escapeHtml(shiftLabel(shift, dayIndex)) + (leaves.length ? ' | Approved Leave' : '') + '</div></div>';
  }
  function summaryHtml(validation, schedule) {
    return '<section class="panel"><div class="panel-head"><h3>Live Weekly Summary</h3><span class="small-pill">Conflicts: ' + validation.messages.length + '</span></div><div class="summary-list">' + EMPLOYEES.map(function (emp) {
      var s = validation.summary[emp.id];
      var color = s.hours === 44 ? "green" : s.hours < 44 ? "yellow" : "red";
      return '<div class="summary-card ' + color + '"><strong>' + emp.name + ': ' + trimHours(s.hours) + ' / 44</strong><div class="metric-grid"><span>Remaining: ' + trimHours(Math.max(0, 44 - s.hours)) + '</span><span>Working days: ' + s.workingDays + '</span><span>OFF days: ' + s.offDays + '</span><span>Leave days: ' + s.leaveDays + '</span><span>OT hours: ' + trimHours(s.ot) + '</span><span>Expected OFF: ' + expectedOffCounts(schedule)[emp.id] + '</span></div></div>';
    }).join("") + '</div><div class="validation-list"><strong>Validation</strong>' + (validation.messages.length ? '<ul>' + validation.messages.map(function (m) { return '<li>' + escapeHtml(m) + '</li>'; }).join("") + '</ul>' : '<div class="success">Schedule is valid for publishing.</div>') + '</div></section>';
  }
  function leaveHtml(user, admin) {
    var visibleLeaves = admin ? state.leaves : state.leaves.filter(function (l) { return l.employeeId === user.id; });
    return '<section class="panel" style="margin-top:16px"><div class="panel-head"><h3>Leave</h3></div><form id="leave-form" class="leave-form"><div class="leave-grid">' + (admin ? '<label>Employee<select id="leave-employee">' + EMPLOYEES.filter(function (e) { return e.role === "Employee"; }).map(function (e) { return '<option value="' + e.id + '">' + e.name + '</option>'; }).join("") + '</select></label>' : '') + '<label>Start date<input id="leave-start" type="date" required></label><label>End date<input id="leave-end" type="date" required></label><label>Leave type<select id="leave-type"><option>Annual Leave</option><option>Medical Leave</option><option>Emergency Leave</option></select></label></div><label>Reason<textarea id="leave-reason" required></textarea></label><button class="secondary" type="submit">Submit Leave</button></form><div class="leave-list">' + visibleLeaves.map(leaveItemHtml).join("") + '</div></section>';
  }
  function leaveItemHtml(leave) {
    var emp = EMPLOYEES.find(function (e) { return e.id === leave.employeeId; }) || { name: leave.employeeId };
    var buttons = currentUser().role === "Admin" && leave.status === "Pending" ? '<div class="leave-actions"><button class="primary leave-action" data-id="' + leave.id + '" data-status="Approved">Approve</button><button class="danger leave-action" data-id="' + leave.id + '" data-status="Rejected">Reject</button></div>' : "";
    return '<div class="leave-item"><strong>' + emp.name + ' - ' + escapeHtml(leave.type) + '</strong><div>' + escapeHtml(leave.startDate) + ' to ' + escapeHtml(leave.endDate) + '</div><div>Status: ' + escapeHtml(leave.status) + '</div><div>' + escapeHtml(leave.reason) + '</div>' + buttons + '</div>';
  }
  function bottomActionsHtml(admin) {
    if (!admin) return "";
    return '<div class="bottom-actions"><div class="toolbar"><button id="save-draft" class="secondary">Save Draft</button><button id="publish" class="primary">Publish Schedule</button><button id="clear-week" class="danger">Clear Week</button><button id="export-backup">Export Backup</button><button id="import-backup">Import Backup</button><input id="backup-file" class="hidden-file" type="file" accept="application/json"></div></div>';
  }
  function shiftLabel(shift, dayIndex) {
    if (!shift || !shift.type) return "Not set";
    if (shift.type === "off" || shift.type === "leave") return SHIFT_TEMPLATES[shift.type].label;
    var t = shiftTimes(shift, dayIndex);
    var source = shift.type === "custom" ? shift : SHIFT_TEMPLATES[shift.type];
    if (!t || t.invalid || !source) return "Invalid time";
    return source.label + " " + source.start + "-" + source.end + (t.end > 1440 ? " next day" : "") + " (" + trimHours(t.hours) + "h)";
  }
  function selected(a, b) { return a === b ? " selected" : ""; }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c];
    });
  }
  function bindEvents() {
    var login = document.getElementById("login-form");
    if (login) {
      login.addEventListener("submit", function (e) {
        e.preventDefault();
        var email = document.getElementById("email").value;
        var password = document.getElementById("password").value;
        var emp = authenticate(email, password);
        if (!emp) {
          document.getElementById("login-error").innerHTML = '<div class="error">Incorrect email or password.</div>';
          return;
        }
        state.session = { employeeId: emp.id, createdAt: new Date().toISOString() };
        write(STORAGE_KEYS.session, state.session);
        render();
      });
      document.getElementById("toggle-password").addEventListener("click", function () {
        var input = document.getElementById("password");
        input.type = input.type === "password" ? "text" : "password";
        this.textContent = input.type === "password" ? "Show" : "Hide";
      });
      document.getElementById("email").addEventListener("input", clearLoginError);
      document.getElementById("password").addEventListener("input", clearLoginError);
      return;
    }
    on("logout", function () { localStorage.removeItem(STORAGE_KEYS.session); state.session = null; render(); });
    on("prev-week", function () { state.selectedWeekStart = weekStart(addDays(toDate(state.selectedWeekStart), -7)); render(); });
    on("this-week", function () { state.selectedWeekStart = weekStart(new Date()); render(); });
    on("next-week", function () { state.selectedWeekStart = weekStart(addDays(toDate(state.selectedWeekStart), 7)); render(); });
    on("week-picker", function (e) { state.selectedWeekStart = weekStart(toDate(e.target.value)); render(); }, "change");
    on("week-type", function (e) { var s = getSchedule(); s.weekType = e.target.value; saveSchedule(s, "Draft"); render(); }, "change");
    on("week-a-off", function (e) { var s = getSchedule(); s.weekAOffEmployee = e.target.value; saveSchedule(s, "Draft"); render(); }, "change");
    on("save-draft", function () { saveSchedule(getSchedule(), "Draft"); alert("Draft saved with current warnings."); render(); });
    on("publish", publishSchedule);
    on("clear-week", clearWeek);
    on("copy-prev", copyPreviousWeek);
    on("export-backup", exportBackup);
    on("import-backup", function () { document.getElementById("backup-file").click(); });
    on("backup-file", importBackup, "change");
    var tabs = document.querySelectorAll(".day-tab");
    Array.prototype.forEach.call(tabs, function (btn) {
      btn.addEventListener("click", function () { state.selectedMobileDay = Number(btn.dataset.day); render(); });
    });
    var controls = document.querySelectorAll(".cell-controls");
    Array.prototype.forEach.call(controls, function (box) {
      var selectEl = box.querySelector(".shift-type");
      var start = box.querySelector(".start-time");
      var end = box.querySelector(".end-time");
      selectEl.addEventListener("change", function () {
        updateShift(box, selectEl.value, start.value, end.value);
      });
      start.addEventListener("change", function () { updateShift(box, "custom", start.value, end.value); });
      end.addEventListener("change", function () { updateShift(box, "custom", start.value, end.value); });
    });
    var leaveForm = document.getElementById("leave-form");
    if (leaveForm) leaveForm.addEventListener("submit", submitLeave);
    var leaveActions = document.querySelectorAll(".leave-action");
    Array.prototype.forEach.call(leaveActions, function (btn) {
      btn.addEventListener("click", function () {
        state.leaves = state.leaves.map(function (leave) {
          if (leave.id === btn.dataset.id) leave.status = btn.dataset.status;
          return leave;
        });
        write(STORAGE_KEYS.leaves, state.leaves);
        render();
      });
    });
  }
  function on(id, fn, eventName) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(eventName || "click", fn);
  }
  function clearLoginError() {
    var el = document.getElementById("login-error");
    if (el) el.innerHTML = "";
  }
  function updateShift(box, type, start, end) {
    var schedule = getSchedule();
    var empId = box.dataset.emp;
    var dayIndex = Number(box.dataset.day);
    schedule.shifts[empId][dayIndex] = { type: type, start: type === "custom" ? start : "", end: type === "custom" ? end : "" };
    saveSchedule(schedule, "Draft");
    render();
  }
  function publishSchedule() {
    var schedule = getSchedule();
    var validation = validateSchedule(schedule);
    if (!validation.validForPublish) {
      alert("Publishing blocked:\n\n" + validation.messages.join("\n"));
      return;
    }
    saveSchedule(schedule, "Published");
    alert("Schedule published.");
    render();
  }
  function clearWeek() {
    if (!confirm("Clear this week? This cannot be undone.")) return;
    state.schedules[state.selectedWeekStart] = newWeek(state.selectedWeekStart);
    write(STORAGE_KEYS.schedules, state.schedules);
    render();
  }
  function copyPreviousWeek() {
    var previousKey = weekStart(addDays(toDate(state.selectedWeekStart), -7));
    var previous = state.schedules[previousKey];
    if (!previous) {
      alert("No previous week schedule found.");
      return;
    }
    var copy = JSON.parse(JSON.stringify(previous));
    copy.id = state.selectedWeekStart;
    copy.weekStart = state.selectedWeekStart;
    copy.weekType = previous.weekType === "WEEK_A" ? "WEEK_B" : "WEEK_A";
    copy.status = "Draft";
    copy.updatedAt = new Date().toISOString();
    state.schedules[state.selectedWeekStart] = copy;
    write(STORAGE_KEYS.schedules, state.schedules);
    render();
  }
  function exportBackup() {
    var data = {};
    Object.keys(STORAGE_KEYS).forEach(function (key) {
      data[STORAGE_KEYS[key]] = safeRead(STORAGE_KEYS[key], key === "version" ? APP_VERSION : null);
    });
    var blob = new Blob([JSON.stringify({ version: APP_VERSION, exportedAt: new Date().toISOString(), data: data }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "scc-workforce-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importBackup(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!parsed || !parsed.data || typeof parsed.data !== "object") throw new Error("Invalid backup format.");
        if (!confirm("Import backup and replace existing SCC data?")) return;
        [STORAGE_KEYS.employees, STORAGE_KEYS.schedules, STORAGE_KEYS.leaves, STORAGE_KEYS.templates, STORAGE_KEYS.session, STORAGE_KEYS.version].forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(parsed.data, key)) write(key, parsed.data[key]);
        });
        render();
      } catch (err) {
        alert("Invalid JSON backup. Import was rejected.");
      }
    };
    reader.readAsText(file);
  }
  function submitLeave(e) {
    e.preventDefault();
    var user = currentUser();
    var employeeSelect = document.getElementById("leave-employee");
    var start = document.getElementById("leave-start").value;
    var end = document.getElementById("leave-end").value;
    if (!start || !end || toDate(end).getTime() < toDate(start).getTime()) {
      alert("Leave request has invalid start or end date.");
      return;
    }
    state.leaves.push({
      id: createId("leave"),
      employeeId: employeeSelect ? employeeSelect.value : user.id,
      startDate: start,
      endDate: end,
      type: document.getElementById("leave-type").value,
      reason: document.getElementById("leave-reason").value.trim(),
      status: "Pending",
      createdAt: new Date().toISOString()
    });
    write(STORAGE_KEYS.leaves, state.leaves);
    render();
  }

  window.SCCScheduler = {
    createId: createId,
    weekStart: weekStart,
    newWeek: newWeek,
    normalizeSchedule: normalizeSchedule,
    validateSchedule: validateSchedule,
    shiftTimes: shiftTimes,
    EMPLOYEES: EMPLOYEES,
    DAYS: DAYS,
    STORAGE_KEYS: STORAGE_KEYS
    , authenticate: authenticate
    , migrateAuthRecords: migrateAuthRecords
  };
  initStorage();
  render();
})();
