let activeTab = null;
let startTime = Date.now();
const notifiedToday = {};

// ── On Startup: Check Streak ─
chrome.runtime.onStartup.addListener(async () => {
  await checkStreak();
});

// Also check when service worker first installs/updates
chrome.runtime.onInstalled.addListener(async () => {
  await checkStreak();
});

// ── Tab Listeners ──
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  handleTabChange(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.status === "complete") {
    handleTabChange(tab);
  }
});

// ── Handle Tab Switch ──
async function handleTabChange(tab) {
  const now = Date.now();

  if (activeTab) {
    const timeSpent = Math.floor((now - startTime) / 1000);
    if (timeSpent > 0) {
      await saveTime(activeTab, timeSpent);
      await checkLimit(activeTab);
    }
  }

  try {
    const url = new URL(tab.url);
    activeTab = url.hostname.replace(/^www\./, "");
  } catch {
    activeTab = null;
  }

  startTime = now;
}

// ── Save Time ──
async function saveTime(domain, seconds) {
  domain = domain.replace(/^www\./, "");
  const today = new Date().toISOString().split("T")[0];
  const key = `activity_${today}`;

  const result = await chrome.storage.local.get(key);
  const todayData = result[key] || {};

  todayData[domain] = (todayData[domain] || 0) + seconds;

  await chrome.storage.local.set({ [key]: todayData });
  console.log(`[MindfulBrowse] Saved: ${domain} → ${todayData[domain]}s on ${today}`);
}

// ── Check Limit & Notify ──
async function checkLimit(domain) {
  const today = new Date().toISOString().split("T")[0];
  const key = `activity_${today}`;

  const [activityResult, limitsResult] = await Promise.all([
    chrome.storage.local.get(key),
    chrome.storage.local.get("limits")
  ]);

  const todayData = activityResult[key] || {};
  const limits = limitsResult.limits || {};

  if (!limits[domain]) return;

  const limitSeconds = limits[domain] * 60;
  const spentSeconds = todayData[domain] || 0;

  const notifyKey = `${domain}_${today}`;
  if (notifiedToday[notifyKey]) return;

  if (spentSeconds >= limitSeconds) {
    notifiedToday[notifyKey] = true;

    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "MindfulBrowse ⏰",
      message: `You've reached your ${limits[domain]}-minute limit on ${domain}`
    });
  }
}

// ── Block Navigation (Focus Mode + Permanent) ──
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;

  let domain;
  try {
    domain = new URL(details.url).hostname.replace(/^www\./, "");
  } catch {
    return;
  }

  if (details.url.startsWith(chrome.runtime.getURL(""))) return;

  const result = await chrome.storage.local.get(["focusMode", "focusList", "permanentList"]);
  const focusMode = result.focusMode || false;
  const focusList = result.focusList || [];
  const permanentList = result.permanentList || [];

  if (permanentList.includes(domain)) {
    const blockedUrl = chrome.runtime.getURL(
      `blocked.html?domain=${encodeURIComponent(domain)}&reason=permanent`
    );
    chrome.tabs.update(details.tabId, { url: blockedUrl });
    return;
  }

  if (focusMode && focusList.includes(domain)) {
    const blockedUrl = chrome.runtime.getURL(
      `blocked.html?domain=${encodeURIComponent(domain)}&reason=focus&target=${encodeURIComponent(details.url)}`
    );
    chrome.tabs.update(details.tabId, { url: blockedUrl });
  }
});

// ────────────────────────────────────────────
// STREAK SYSTEM
// ────────────────────────────────────────────

async function checkStreak() {
  const today = new Date().toISOString().split("T")[0];

  const result = await chrome.storage.local.get([
    "streak",
    "lastCheckedDate",
    "lastSuccessDate",
    "limits"
  ]);

  const streak = result.streak || 0;
  const lastCheckedDate = result.lastCheckedDate || null;
  const limits = result.limits || {};

  // Already checked today — do nothing
  if (lastCheckedDate === today) return;

  // No limits set — don't count the day, just update checked date
  if (Object.keys(limits).length === 0) {
    await chrome.storage.local.set({ lastCheckedDate: today });
    return;
  }

  // Evaluate yesterday's activity
  const yesterday = getPreviousDate(today);
  const yesterdayKey = `activity_${yesterday}`;
  const activityResult = await chrome.storage.local.get(yesterdayKey);
  const yesterdayData = activityResult[yesterdayKey] || {};

  const success = didStayWithinLimits(yesterdayData, limits);

  let newStreak = streak;

  if (success) {
    const lastSuccessDate = result.lastSuccessDate || null;
    const dayBeforeYesterday = getPreviousDate(yesterday);

    // Consecutive if last success was the day before yesterday, or streak is fresh
    if (lastSuccessDate === dayBeforeYesterday || streak === 0) {
      newStreak = streak + 1;
    } else {
      newStreak = 1; // Gap detected — restart streak
    }

    await chrome.storage.local.set({
      streak: newStreak,
      lastCheckedDate: today,
      lastSuccessDate: yesterday
    });

    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "MindfulBrowse 🔥",
      message: newStreak === 1
        ? "Great start! You stayed within your limits yesterday."
        : `${newStreak}-day streak! Keep it up! 🔥`
    });

  } else {
    // Streak broken
    newStreak = 0;
    await chrome.storage.local.set({
      streak: newStreak,
      lastCheckedDate: today
    });

    if (streak > 0) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "MindfulBrowse 😔",
        message: `Your ${streak}-day streak ended. Start fresh today!`
      });
    }
  }

  console.log(`[MindfulBrowse] Streak check → success=${success}, streak=${newStreak}`);
}

// Returns true if user stayed within ALL limits
function didStayWithinLimits(activityData, limits) {
  for (const [domain, minutes] of Object.entries(limits)) {
    const limitSeconds = minutes * 60;
    const spentSeconds = activityData[domain] || 0;
    if (spentSeconds > limitSeconds) return false;
  }
  return true;
}

// Returns the previous day's date string
function getPreviousDate(dateStr) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() - 1);
  return date.toISOString().split("T")[0];
}