// ─────────────────────────────────────────
// Close button
// window.close() is blocked on extension tabs opened via chrome.tabs.create()
// Must use chrome.tabs API to close the current tab
// ─────────────────────────────────────────
document.getElementById("closeBtn").addEventListener("click", () => {
    chrome.tabs.getCurrent(tab => {
        if (tab) chrome.tabs.remove(tab.id);
    });
});

// ─────────────────────────────────────────
// Date label — set synchronously, never shows "Loading..."
// ─────────────────────────────────────────
const TODAY = new Date().toISOString().split("T")[0];
document.getElementById("dateLabel").textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
});

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
function formatTime(seconds) {
    if (!seconds || seconds < 1) return "0s";
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

// getDateStr(0) = today, getDateStr(1) = yesterday, etc.
// The old getPreviousDate(today, 0) was returning YESTERDAY — that's why data was always empty!
function getDateStr(daysBack) {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    return d.toISOString().split("T")[0];
}

function getDayLabel(dateStr) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[new Date(dateStr + "T12:00:00").getDay()];
}

const moodEmojis = { 1: "😞", 2: "😕", 3: "😐", 4: "🙂", 5: "😄" };

// ─────────────────────────────────────────
// Main init
// ─────────────────────────────────────────
async function init() {
    const activityKeys = Array.from({ length: 7 },  (_, i) => `activity_${getDateStr(i)}`);
    const moodKeys     = Array.from({ length: 15 }, (_, i) => `mood_${getDateStr(i)}`);
    const allKeys      = [...new Set([...activityKeys, ...moodKeys, "limits", "streak"])];

    const result    = await chrome.storage.local.get(allKeys);
    const todayData = result[`activity_${TODAY}`] || {};
    const limits    = result["limits"] || {};
    const streak    = result["streak"] || 0;

    renderStats(todayData, limits, streak);
    renderBarChart(todayData, limits);
    renderWeeklyChart(result);
    renderMoodCheckin(result);
    renderMoodHistory(result);
    renderInsight(result, limits);
}

// ─────────────────────────────────────────
// Stats
// ─────────────────────────────────────────
function renderStats(todayData, limits, streak) {
    const totalSeconds = Object.values(todayData).reduce((a, b) => a + b, 0);
    document.getElementById("totalToday").textContent   = formatTime(totalSeconds);
    document.getElementById("streakStat").textContent   = streak;
    document.getElementById("sitesVisited").textContent = Object.keys(todayData).length;

    const overCount = Object.entries(limits).filter(([domain, mins]) =>
        (todayData[domain] || 0) > mins * 60
    ).length;

    const subEl = document.getElementById("limitsStatus");
    if (overCount > 0) {
        subEl.textContent = `⚠️ ${overCount} limit${overCount > 1 ? "s" : ""} exceeded`;
        subEl.style.color = "#ff6b6b";
    } else if (Object.keys(limits).length > 0) {
        subEl.textContent = "✓ All limits respected";
        subEl.style.color = "#a8f0c6";
    }
}

// ─────────────────────────────────────────
// Bar Chart
// ─────────────────────────────────────────
function renderBarChart(todayData, limits) {
    const container = document.getElementById("barChart");
    const entries   = Object.entries(todayData).sort((a, b) => b[1] - a[1]).slice(0, 8);

    if (entries.length === 0) {
        container.innerHTML = `<div class="empty-state">No browsing data yet today</div>`;
        return;
    }

    const maxVal = entries[0][1];
    container.innerHTML = "";

    entries.forEach(([domain, seconds]) => {
        const pct       = Math.round((seconds / maxVal) * 100);
        const overLimit = limits[domain] && seconds > limits[domain] * 60;
        const row       = document.createElement("div");
        row.className   = "bar-row";
        row.innerHTML   = `
            <span class="bar-domain" title="${domain}">${domain}</span>
            <div class="bar-track">
                <div class="bar-fill ${overLimit ? "over-limit" : ""}" data-pct="${pct}"></div>
            </div>
            <span class="bar-value">${formatTime(seconds)}</span>
        `;
        container.appendChild(row);
    });

    requestAnimationFrame(() => {
        document.querySelectorAll(".bar-fill").forEach(el => {
            el.style.width = el.dataset.pct + "%";
        });
    });
}

// ─────────────────────────────────────────
// Weekly Chart
// ─────────────────────────────────────────
function renderWeeklyChart(result) {
    const container = document.getElementById("weeklyChart");
    container.innerHTML = "";

    const days   = Array.from({ length: 7 }, (_, i) => getDateStr(6 - i));
    const totals = days.map(date => {
        const data = result[`activity_${date}`] || {};
        return Object.values(data).reduce((a, b) => a + b, 0);
    });

    const maxTotal = Math.max(...totals, 1);

    days.forEach((date, i) => {
        const total     = totals[i];
        const heightPct = Math.round((total / maxTotal) * 100);
        const isToday   = date === TODAY;

        const col = document.createElement("div");
        col.className = "week-col";
        col.innerHTML = `
            <div class="week-bar-wrap">
                <div class="week-bar ${isToday ? "today" : ""}" style="height:0%" data-h="${heightPct}%">
                    <div class="week-tooltip">${formatTime(total)}</div>
                </div>
            </div>
            <div class="week-label ${isToday ? "today" : ""}">${isToday ? "Now" : getDayLabel(date)}</div>
        `;
        container.appendChild(col);
    });

    requestAnimationFrame(() => {
        document.querySelectorAll(".week-bar").forEach(el => {
            el.style.height = el.dataset.h;
        });
    });
}

// ─────────────────────────────────────────
// Mood Check-In
// TODAY is a module-level const so no stale closure issues
// ─────────────────────────────────────────
function renderMoodCheckin(result) {
    const todayMood = result[`mood_${TODAY}`] || {};

    ["morning", "evening"].forEach(type => {
        if (todayMood[type]) {
            const btn = document.querySelector(`.mood-btn[data-type="${type}"][data-score="${todayMood[type]}"]`);
            if (btn) btn.classList.add("selected");
        }
    });

    document.querySelectorAll(".mood-btn").forEach(function(btn) {
        btn.addEventListener("click", async function() {
            const type  = this.dataset.type;
            const score = parseInt(this.dataset.score);

            document.querySelectorAll(`.mood-btn[data-type="${type}"]`).forEach(b => b.classList.remove("selected"));
            this.classList.add("selected");

            const key      = `mood_${TODAY}`;
            const existing = await chrome.storage.local.get(key);
            const moodData = existing[key] || {};
            moodData[type] = score;
            await chrome.storage.local.set({ [key]: moodData });

            const saved = document.getElementById("moodSaved");
            saved.textContent = `✓ ${type === "morning" ? "Morning" : "Evening"} mood saved ${moodEmojis[score]}`;
            setTimeout(() => { saved.textContent = ""; }, 2500);

            const freshKeys   = Array.from({ length: 15 }, (_, i) => `mood_${getDateStr(i)}`);
            const freshResult = await chrome.storage.local.get(freshKeys);
            renderMoodHistory(freshResult);
        });
    });
}

// ─────────────────────────────────────────
// Mood History
// ─────────────────────────────────────────
function renderMoodHistory(result) {
    const container = document.getElementById("moodHistory");
    const entries   = [];

    for (let i = 0; i < 14; i++) {
        const date = getDateStr(i);
        const mood = result[`mood_${date}`];
        if (mood && (mood.morning || mood.evening)) {
            entries.push({ date, mood });
        }
    }

    if (entries.length === 0) {
        container.innerHTML = `<div class="empty-state">No mood data yet</div>`;
        return;
    }

    container.innerHTML = "";

    entries.sort((a, b) => b.date.localeCompare(a.date)).forEach(({ date, mood }) => {
        const isToday     = date === TODAY;
        const displayDate = isToday
            ? "Today"
            : new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

        const morningStr = mood.morning ? `${moodEmojis[mood.morning]} ${mood.morning}` : "—";
        const eveningStr = mood.evening ? `${moodEmojis[mood.evening]} ${mood.evening}` : "—";

        let deltaHtml = `<span class="mood-delta neutral">—</span>`;
        if (mood.morning && mood.evening) {
            const delta = mood.evening - mood.morning;
            const cls   = delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral";
            const sign  = delta > 0 ? "+" : "";
            deltaHtml   = `<span class="mood-delta ${cls}">${sign}${delta}</span>`;
        }

        const el = document.createElement("div");
        el.className = "mood-entry";
        el.innerHTML = `
            <span class="mood-entry-date">${displayDate}</span>
            <span class="mood-entry-val">🌅 ${morningStr} → 🌙 ${eveningStr}</span>
            ${deltaHtml}
        `;
        container.appendChild(el);
    });
}

// ─────────────────────────────────────────
// Insight
// ─────────────────────────────────────────
function renderInsight(result, limits) {
    const container  = document.getElementById("insightText");
    const dataPoints = [];

    for (let i = 1; i <= 14; i++) {
        const date     = getDateStr(i);
        const mood     = result[`mood_${date}`];
        const activity = result[`activity_${date}`];

        if (mood && mood.morning && mood.evening && activity) {
            const totalSeconds = Object.values(activity).reduce((a, b) => a + b, 0);
            const moodDelta    = mood.evening - mood.morning;
            dataPoints.push({ totalSeconds, moodDelta });
        }
    }

    if (dataPoints.length < 3) {
        container.className   = "empty-state";
        container.textContent = "Not enough data yet — check back after a few days of mood tracking.";
        return;
    }

    const avgBrowse   = dataPoints.reduce((a, b) => a + b.totalSeconds, 0) / dataPoints.length;
    const highDays    = dataPoints.filter(d => d.totalSeconds > avgBrowse);
    const lowDays     = dataPoints.filter(d => d.totalSeconds <= avgBrowse);
    const avgMoodHigh = highDays.length ? highDays.reduce((a, b) => a + b.moodDelta, 0) / highDays.length : 0;
    const avgMoodLow  = lowDays.length  ? lowDays.reduce((a,  b) => a + b.moodDelta, 0) / lowDays.length  : 0;
    const diff        = avgMoodHigh - avgMoodLow;

    container.className = "insight";

    if (Math.abs(diff) < 0.3) {
        container.innerHTML = `Based on <strong>${dataPoints.length} days</strong> of data, your mood stays consistent regardless of how long you browse. You seem to have a stable baseline.`;
    } else if (diff < 0) {
        container.innerHTML = `On days you browse <strong>more than average</strong>, your mood drops by about <strong>${Math.abs(diff).toFixed(1)} points</strong> by evening. Less screen time seems to help you feel better.`;
    } else {
        container.innerHTML = `Interestingly, on heavier browsing days your mood actually <strong>improves slightly</strong>. Keep an eye on which sites you visit on those days — they seem to be working for you.`;
    }
}

// ─────────────────────────────────────────
// Kick off
// ─────────────────────────────────────────
init();