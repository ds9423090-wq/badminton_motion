const STORAGE_KEYS = {
  config: "fortune.config.v1",
  logs: "fortune.logs.v1",
};

const SESSION_UNLOCKED = "fortune.unlocked.v1";
const page = document.body.dataset.page;

const defaultConfig = {
  name: "",
  birthday: "",
  style: "balance",
  passHash: "",
};

const MESSAGES = {
  overall: [
    "Small progress wins today.",
    "Keep your pace steady and things will align.",
    "Focus on your top 3 tasks for best results.",
    "Starting with an easy task helps build momentum.",
  ],
  love: [
    "Kind words make conversations smoother.",
    "A short check-in message can mean a lot.",
    "Ask one thoughtful question and listen closely.",
    "Low pressure brings better connection today.",
  ],
  work: [
    "Clean structure in notes will save time later.",
    "Finish one hard item early to feel lighter.",
    "Use deadlines to set clear priorities.",
    "Ask for feedback a little earlier than usual.",
  ],
  money: [
    "Pause before buying and check real need first.",
    "Small subscription reviews can improve cash flow.",
    "Value matters more than discount today.",
    "Organizing your wallet can sharpen spending choices.",
  ],
  health: [
    "A short stretch break helps your focus.",
    "Warm drinks can steady your mood.",
    "Sleeping a bit earlier helps tomorrow.",
    "A short walk is enough to reset your energy.",
  ],
};

const LUCKY_COLORS = ["Amber", "Navy", "Green", "Coral", "Silver", "Ivory", "Moss"];
const LUCKY_ITEMS = ["Notebook", "Earbuds", "Bottle", "Hand towel", "Bookmark", "Pen case"];
const LUCKY_TIMES = ["07:30", "09:20", "11:40", "14:10", "16:30", "19:00", "21:15"];
const LUCKY_ACTIONS = [
  "Tidy your desk for 3 minutes",
  "Send one gratitude message",
  "Write down 3 tasks",
  "Take 5 deep breaths",
  "Walk for 5 minutes in the evening",
];

function loadConfig() {
  try {
    return { ...defaultConfig, ...JSON.parse(localStorage.getItem(STORAGE_KEYS.config) || "{}") };
  } catch {
    return { ...defaultConfig };
  }
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
}

function loadLogs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.logs) || "[]");
  } catch {
    return [];
  }
}

function saveLogs(logs) {
  localStorage.setItem(STORAGE_KEYS.logs, JSON.stringify(logs));
}

async function hashText(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function showMain() {
  document.getElementById("app").hidden = false;
}

function writeGate(html) {
  document.getElementById("auth-gate").innerHTML = html;
}

async function setupFirstPassword(config) {
  writeGate(`
    <section class="auth-wrap">
      <div class="auth-card">
        <h2>First setup</h2>
        <p>Create a password for this private site.</p>
        <form id="setup-form">
          <label for="setup-password">New password</label>
          <input id="setup-password" type="password" autocomplete="new-password" required minlength="4">
          <label for="setup-password-confirm">Confirm password</label>
          <input id="setup-password-confirm" type="password" autocomplete="new-password" required minlength="4">
          <button type="submit">Save and start</button>
          <p class="auth-error" id="setup-error"></p>
        </form>
      </div>
    </section>
  `);

  return new Promise((resolve) => {
    const form = document.getElementById("setup-form");
    const error = document.getElementById("setup-error");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const p1 = document.getElementById("setup-password").value;
      const p2 = document.getElementById("setup-password-confirm").value;
      if (p1.length < 4) {
        error.textContent = "Use at least 4 characters.";
        return;
      }
      if (p1 !== p2) {
        error.textContent = "Passwords do not match.";
        return;
      }
      config.passHash = await hashText(p1);
      saveConfig(config);
      sessionStorage.setItem(SESSION_UNLOCKED, "1");
      writeGate("");
      showMain();
      resolve();
    });
  });
}

async function unlockWithPassword(config) {
  if (sessionStorage.getItem(SESSION_UNLOCKED) === "1") {
    writeGate("");
    showMain();
    return;
  }

  writeGate(`
    <section class="auth-wrap">
      <div class="auth-card">
        <h2>Locked</h2>
        <p>Enter your password.</p>
        <form id="unlock-form">
          <label for="unlock-password">Password</label>
          <input id="unlock-password" type="password" autocomplete="current-password" required>
          <button type="submit">Unlock</button>
          <p class="auth-error" id="unlock-error"></p>
        </form>
      </div>
    </section>
  `);

  return new Promise((resolve) => {
    const form = document.getElementById("unlock-form");
    const error = document.getElementById("unlock-error");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.getElementById("unlock-password").value;
      const hash = await hashText(input);
      if (hash !== config.passHash) {
        error.textContent = "Wrong password.";
        return;
      }
      sessionStorage.setItem(SESSION_UNLOCKED, "1");
      writeGate("");
      showMain();
      resolve();
    });
  });
}

function zodiacFromBirthday(birthday) {
  if (!birthday) return "Unknown";
  const d = new Date(`${birthday}T00:00:00`);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if ((m === 3 && day >= 21) || (m === 4 && day <= 19)) return "Aries";
  if ((m === 4 && day >= 20) || (m === 5 && day <= 20)) return "Taurus";
  if ((m === 5 && day >= 21) || (m === 6 && day <= 21)) return "Gemini";
  if ((m === 6 && day >= 22) || (m === 7 && day <= 22)) return "Cancer";
  if ((m === 7 && day >= 23) || (m === 8 && day <= 22)) return "Leo";
  if ((m === 8 && day >= 23) || (m === 9 && day <= 22)) return "Virgo";
  if ((m === 9 && day >= 23) || (m === 10 && day <= 23)) return "Libra";
  if ((m === 10 && day >= 24) || (m === 11 && day <= 22)) return "Scorpio";
  if ((m === 11 && day >= 23) || (m === 12 && day <= 21)) return "Sagittarius";
  if ((m === 12 && day >= 22) || (m === 1 && day <= 19)) return "Capricorn";
  if ((m === 1 && day >= 20) || (m === 2 && day <= 18)) return "Aquarius";
  return "Pisces";
}

function seededRandom(seed) {
  let t = seed + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function hashNumber(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function styleBias(style) {
  if (style === "love") return { love: 1, work: -0.3, money: 0, health: 0 };
  if (style === "work") return { love: -0.3, work: 1, money: 0.5, health: 0 };
  if (style === "calm") return { love: 0, work: -0.2, money: -0.2, health: 1 };
  return { love: 0, work: 0, money: 0, health: 0 };
}

function pick(seed, list) {
  const idx = Math.floor(seededRandom(seed) * list.length);
  return list[idx];
}

function score(seed, bonus = 0) {
  const raw = 2.3 + seededRandom(seed) * 2.8 + bonus;
  return Math.max(1, Math.min(5, Math.round(raw)));
}

function buildFortune(config) {
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const zodiac = zodiacFromBirthday(config.birthday);
  const seedBase = hashNumber(`${ymd}|${config.name}|${zodiac}|${config.style}`);
  const bias = styleBias(config.style);
  const sLove = score(seedBase + 11, bias.love);
  const sWork = score(seedBase + 22, bias.work);
  const sMoney = score(seedBase + 33, bias.money);
  const sHealth = score(seedBase + 44, bias.health);
  const sOverall = Math.round((sLove + sWork + sMoney + sHealth) / 4);
  return {
    ymd,
    zodiac,
    scores: { overall: sOverall, love: sLove, work: sWork, money: sMoney, health: sHealth },
    messages: {
      overall: pick(seedBase + 1, MESSAGES.overall),
      love: pick(seedBase + 2, MESSAGES.love),
      work: pick(seedBase + 3, MESSAGES.work),
      money: pick(seedBase + 4, MESSAGES.money),
      health: pick(seedBase + 5, MESSAGES.health),
    },
    lucky: {
      color: pick(seedBase + 6, LUCKY_COLORS),
      item: pick(seedBase + 7, LUCKY_ITEMS),
      time: pick(seedBase + 8, LUCKY_TIMES),
      action: pick(seedBase + 9, LUCKY_ACTIONS),
    },
  };
}

function renderHome(config) {
  const data = buildFortune(config);
  const logs = loadLogs();
  const latest = logs.slice(-3).reverse();

  document.getElementById("today-label").textContent = `${data.ymd} fortune`;
  document.getElementById("zodiac-title").textContent = `${data.zodiac} sign`;
  document.getElementById("overall-score").textContent = `Overall: ${data.scores.overall}/5`;
  document.getElementById("overall-message").textContent = data.messages.overall;
  document.getElementById("love-score").textContent = `${data.scores.love}/5`;
  document.getElementById("love-message").textContent = data.messages.love;
  document.getElementById("work-score").textContent = `${data.scores.work}/5`;
  document.getElementById("work-message").textContent = data.messages.work;
  document.getElementById("money-score").textContent = `${data.scores.money}/5`;
  document.getElementById("money-message").textContent = data.messages.money;
  document.getElementById("health-score").textContent = `${data.scores.health}/5`;
  document.getElementById("health-message").textContent = data.messages.health;
  document.getElementById("lucky-color").textContent = data.lucky.color;
  document.getElementById("lucky-item").textContent = data.lucky.item;
  document.getElementById("lucky-time").textContent = data.lucky.time;
  document.getElementById("lucky-action").textContent = data.lucky.action;

  const mood = document.getElementById("recent-mood");
  if (!latest.length) {
    mood.textContent = "No logs yet. Add your mood in Mood Log.";
    return;
  }
  mood.textContent = latest.map((l) => `${l.date}: ${l.mood}`).join(" / ");
}

function renderLogPage() {
  const form = document.getElementById("log-form");
  const dateInput = document.getElementById("log-date");
  const list = document.getElementById("log-list");
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  dateInput.value = ymd;

  function draw() {
    const logs = loadLogs().slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!logs.length) {
      list.innerHTML = "<li>No records yet.</li>";
      return;
    }
    list.innerHTML = logs
      .map((log) => `<li><strong>${log.date}</strong> - ${log.mood}<br>${escapeHtml(log.note || "")}</li>`)
      .join("");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const logs = loadLogs();
    const entry = {
      id: crypto.randomUUID(),
      date: dateInput.value,
      mood: document.getElementById("mood").value,
      note: document.getElementById("note").value.trim(),
    };
    const sameDateIndex = logs.findIndex((l) => l.date === entry.date);
    if (sameDateIndex >= 0) {
      logs[sameDateIndex] = entry;
    } else {
      logs.push(entry);
    }
    saveLogs(logs);
    form.reset();
    dateInput.value = ymd;
    draw();
  });

  draw();
}

function renderSettingsPage(config) {
  const profileForm = document.getElementById("profile-form");
  const passwordForm = document.getElementById("password-form");
  const exportBtn = document.getElementById("export-data");
  const clearBtn = document.getElementById("clear-data");

  document.getElementById("name").value = config.name || "";
  document.getElementById("birthday").value = config.birthday || "";
  document.getElementById("fortune-style").value = config.style || "balance";

  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    config.name = document.getElementById("name").value.trim();
    config.birthday = document.getElementById("birthday").value;
    config.style = document.getElementById("fortune-style").value;
    saveConfig(config);
    alert("Profile saved.");
  });

  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const current = document.getElementById("current-password").value;
    const next = document.getElementById("new-password").value;
    if (next.length < 4) {
      alert("New password needs at least 4 characters.");
      return;
    }
    const currentHash = await hashText(current);
    if (currentHash !== config.passHash) {
      alert("Current password is incorrect.");
      return;
    }
    config.passHash = await hashText(next);
    saveConfig(config);
    passwordForm.reset();
    alert("Password updated.");
  });

  exportBtn.addEventListener("click", () => {
    const dump = {
      config: loadConfig(),
      logs: loadLogs(),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fortune-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  clearBtn.addEventListener("click", () => {
    const ok = confirm("Delete all saved data? This cannot be undone.");
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEYS.config);
    localStorage.removeItem(STORAGE_KEYS.logs);
    sessionStorage.removeItem(SESSION_UNLOCKED);
    alert("Deleted. Reload page to start over.");
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function boot() {
  const config = loadConfig();
  if (!config.passHash) {
    await setupFirstPassword(config);
  } else {
    await unlockWithPassword(config);
  }

  if (page === "home") renderHome(config);
  if (page === "log") renderLogPage();
  if (page === "settings") renderSettingsPage(config);
}

boot();
