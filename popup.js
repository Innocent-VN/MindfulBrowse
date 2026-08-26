// ── Load everything when popup opens ──
document.addEventListener("DOMContentLoaded", async () => {
  await loadUsage();
  await loadLimits();
  await loadStreak();
  await loadFocusMode();
  await loadFocusList();
  await loadPermanentList();
  await loadMoodCheckin();
});

// ────────────────────────────────────────────
// DASHBOARD BUTTON
// ────────────────────────────────────────────

document.getElementById("openDashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

// ────────────────────────────────────────────
// MOOD CHECK-IN
// ────────────────────────────────────────────

async function loadMoodCheckin() {
  const today = new Date().toISOString().split("T")[0];
  const hour  = new Date().getHours();

  // Determine if morning (before 12) or evening (12 and after)
  const type = hour < 12 ? "morning" : "evening";
  const typeLabel = type === "morning" ? "Morning" : "Evening";

  document.getElementById("moodTitle").textContent = `${typeLabel} Mood Check-In`;
  document.getElementById("moodDesc").textContent  =
    type === "morning"
      ? "How are you feeling starting today?"
      : "How do you feel after today's browsing?";

  // Restore today's saved mood for this type
  const result = await chrome.storage.local.get(`mood_${today}`);
  const todayMood = result[`mood_${today}`] || {};

  if (todayMood[type]) {
    const btn = document.querySelector(`.mood-quick-btn[data-score="${todayMood[type]}"]`);
    if (btn) btn.classList.add("selected");
  }

  // Button click handlers
  document.querySelectorAll(".mood-quick-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const score = parseInt(btn.dataset.score);

      // Deselect all, select clicked
      document.querySelectorAll(".mood-quick-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");

      // Save
      const key = `mood_${today}`;
      const existing = await chrome.storage.local.get(key);
      const moodData = existing[key] || {};
      moodData[type] = score;
      await chrome.storage.local.set({ [key]: moodData });

      const msg = document.getElementById("moodMessage");
      msg.textContent = `✓ ${typeLabel} mood saved`;
      setTimeout(() => { msg.textContent = ""; }, 2000);
    });
  });
}

// ────────────────────────────────────────────
// STREAK
// ────────────────────────────────────────────

async function loadStreak() {
  const result = await chrome.storage.local.get(["streak", "lastSuccessDate", "limits"]);
  const streak = result.streak || 0;
  const lastSuccessDate = result.lastSuccessDate || null;
  const limits = result.limits || {};
  const today = new Date().toISOString().split("T")[0];
  const yesterday = getPreviousDate(today);

  const streakEl     = document.getElementById("streakCount");
  const streakLabel  = document.getElementById("streakLabel");
  const streakStatus = document.getElementById("streakStatus");

  streakEl.textContent = streak;

  if (streak === 0) {
    streakLabel.textContent = "Start your streak!";
    streakStatus.textContent = Object.keys(limits).length === 0
      ? "Set limits to start tracking your streak."
      : "Stay within your limits today to begin.";
    streakStatus.style.color = "#5a6070";
  } else {
    streakLabel.textContent = "day streak 🔥";
    if (lastSuccessDate === yesterday || lastSuccessDate === today) {
      streakStatus.textContent = "🟢 Active — keep it up today!";
      streakStatus.style.color = "#a8f0c6";
    } else {
      streakStatus.textContent = "⚠️ Stay within limits today to continue.";
      streakStatus.style.color = "#f0c86a";
    }
  }
}

function getPreviousDate(dateStr) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() - 1);
  return date.toISOString().split("T")[0];
}

// ────────────────────────────────────────────
// LIMITS
// ────────────────────────────────────────────

document.getElementById("saveLimit").addEventListener("click", async () => {
  const domain  = document.getElementById("domainInput").value.trim().toLowerCase().replace(/^www\./, "");
  const minutes = parseInt(document.getElementById("limitInput").value);
  const message = document.getElementById("saveMessage");

  if (!domain || isNaN(minutes) || minutes < 1) {
    message.textContent = "Please enter a valid domain and minutes.";
    message.classList.add("error");
    return;
  }

  const result = await chrome.storage.local.get("limits");
  const limits = result.limits || {};
  limits[domain] = minutes;
  await chrome.storage.local.set({ limits });

  message.textContent = `✓ Limit saved: ${domain} = ${minutes} min`;
  message.classList.remove("error");
  document.getElementById("domainInput").value = "";
  document.getElementById("limitInput").value  = "";

  await loadLimits();
  setTimeout(() => { message.textContent = ""; }, 2000);
});

async function loadLimits() {
  const result = await chrome.storage.local.get("limits");
  const limits = result.limits || {};
  const list   = document.getElementById("limitsList");
  list.innerHTML = "";
  const entries = Object.entries(limits);

  if (entries.length === 0) {
    list.innerHTML = `<li class="empty-state">No limits set yet.</li>`;
    return;
  }

  entries.forEach(([domain, minutes]) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="domain">${domain}</span>
      <span class="value">${minutes} min</span>
      <button class="delete-btn" data-domain="${domain}">✕</button>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const domain = btn.getAttribute("data-domain");
      const result = await chrome.storage.local.get("limits");
      const limits = result.limits || {};
      delete limits[domain];
      await chrome.storage.local.set({ limits });
      await loadLimits();
    });
  });
}

// ────────────────────────────────────────────
// FOCUS MODE
// ────────────────────────────────────────────

async function loadFocusMode() {
  const result    = await chrome.storage.local.get("focusMode");
  const focusMode = result.focusMode || false;
  document.getElementById("focusToggle").checked = focusMode;
  updateFocusUI(focusMode);
}

document.getElementById("focusToggle").addEventListener("change", async (e) => {
  const focusMode = e.target.checked;
  await chrome.storage.local.set({ focusMode });
  updateFocusUI(focusMode);
});

function updateFocusUI(active) {
  const card = document.getElementById("focusToggle").closest(".card");
  active ? card.classList.add("focus-active") : card.classList.remove("focus-active");
}

document.getElementById("addFocusSite").addEventListener("click", async () => {
  const domain = document.getElementById("focusDomainInput").value.trim().toLowerCase().replace(/^www\./, "");
  if (!domain) return;

  const result    = await chrome.storage.local.get("focusList");
  const focusList = result.focusList || [];
  if (!focusList.includes(domain)) {
    focusList.push(domain);
    await chrome.storage.local.set({ focusList });
  }

  document.getElementById("focusDomainInput").value = "";
  await loadFocusList();
});

async function loadFocusList() {
  const result    = await chrome.storage.local.get("focusList");
  const focusList = result.focusList || [];
  const list      = document.getElementById("focusList");
  list.innerHTML  = "";

  if (focusList.length === 0) {
    list.innerHTML = `<li class="empty-state">No sites added yet.</li>`;
    return;
  }

  focusList.forEach((domain) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="domain">${domain}</span>
      <button class="delete-btn" data-domain="${domain}">✕</button>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const domain    = btn.getAttribute("data-domain");
      const result    = await chrome.storage.local.get("focusList");
      const focusList = (result.focusList || []).filter(d => d !== domain);
      await chrome.storage.local.set({ focusList });
      await loadFocusList();
    });
  });
}

// ────────────────────────────────────────────
// PERMANENT BLOCK
// ────────────────────────────────────────────

document.getElementById("addPermanentSite").addEventListener("click", async () => {
  const domain = document.getElementById("permanentDomainInput").value.trim().toLowerCase().replace(/^www\./, "");
  if (!domain) return;

  const result        = await chrome.storage.local.get("permanentList");
  const permanentList = result.permanentList || [];
  if (!permanentList.includes(domain)) {
    permanentList.push(domain);
    await chrome.storage.local.set({ permanentList });
  }

  document.getElementById("permanentDomainInput").value = "";
  await loadPermanentList();
});

async function loadPermanentList() {
  const result        = await chrome.storage.local.get("permanentList");
  const permanentList = result.permanentList || [];
  const list          = document.getElementById("permanentList");
  list.innerHTML      = "";

  if (permanentList.length === 0) {
    list.innerHTML = `<li class="empty-state">No permanently blocked sites.</li>`;
    return;
  }

  permanentList.forEach((domain) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="domain">${domain}</span>
      <span class="value" style="color:#ff6b6b;font-size:10px;">BLOCKED</span>
      <button class="delete-btn" data-domain="${domain}">✕</button>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const domain        = btn.getAttribute("data-domain");
      const result        = await chrome.storage.local.get("permanentList");
      const permanentList = (result.permanentList || []).filter(d => d !== domain);
      await chrome.storage.local.set({ permanentList });
      await loadPermanentList();
    });
  });
}

// ────────────────────────────────────────────
// USAGE
// ────────────────────────────────────────────

async function loadUsage() {
  const today  = new Date().toISOString().split("T")[0];
  const key    = `activity_${today}`;
  const result = await chrome.storage.local.get(key);
  const data   = result[key] || {};
  const list   = document.getElementById("usageList");
  list.innerHTML = "";

  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    list.innerHTML = `<li class="empty-state">No data yet — start browsing!</li>`;
    return;
  }

  const limitsResult = await chrome.storage.local.get("limits");
  const limits       = limitsResult.limits || {};

  entries.forEach(([domain, seconds]) => {
    const li        = document.createElement("li");
    const limitSecs = limits[domain] ? limits[domain] * 60 : null;
    const overLimit = limitSecs && seconds > limitSecs;

    li.innerHTML = `
      <span class="domain">${domain}</span>
      <span class="value" style="${overLimit ? "color:#ff6b6b" : ""}">${formatTime(seconds)}${overLimit ? " ⚠️" : ""}</span>
    `;
    list.appendChild(li);
  });
}

// ────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────

function formatTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs  = Math.floor(mins / 60);
  const rem  = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}