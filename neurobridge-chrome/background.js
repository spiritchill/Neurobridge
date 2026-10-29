// background.js — MV3 service worker (Chrome).
importScripts("shared.js");
// Owns the context menu and the Gemini API calls (so the API key never
// has to live in a content script injected into arbitrary pages).

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const NOTIFY_ICON = chrome.runtime.getURL("icon128.png");

const MENU_ITEMS = [
  { id: "nb-simplify", title: "NeuroBridge: Simplify this text" },
  { id: "nb-steps", title: "NeuroBridge: Break this into steps" },
  { id: "nb-takeaways", title: "NeuroBridge: Key takeaways" },
];

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  for (const m of MENU_ITEMS) {
    chrome.contextMenus.create({ id: m.id, title: m.title, contexts: ["selection"] });
  }
  applyReminders(await loadProfile());
});

chrome.runtime.onStartup.addListener(async () => applyReminders(await loadProfile()));

async function getApiKey() {
  const { gemini_key } = await chrome.storage.local.get("gemini_key");
  return gemini_key || "";
}

async function callGemini(prompt) {
  const key = await getApiKey();
  if (!key) return { error: "no_key" };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { error: `gemini_${res.status}`, detail: body };
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    return { text };
  } catch (e) {
    return { error: "network", detail: String(e) };
  }
}

function buildPrompt(kind, selection, p) {
  const hint = profileHint(p);
  if (kind === "nb-steps") {
    return `Break the following into ${p.steps} small, ordered, concrete steps. One short sentence per step, plain language, numbered list only, no preamble. ${hint}\n\nText:\n${selection}`;
  }
  if (kind === "nb-takeaways") {
    return `Give a one-sentence summary, then the 3 to 5 key takeaways as a short bullet list using "-". No preamble. ${hint}\n\nText:\n${selection}`;
  }
  return `Rewrite the following text in short, clear sentences with everyday words, keeping the full meaning. Output only the rewritten text, no preamble. ${hint}\n\nText:\n${selection}`;
}

// --- Messages from the dashboard and content script ---
async function pushCapped(key, item, cap) {
  const { [key]: list = [] } = await chrome.storage.local.get(key);
  list.push(item);
  await chrome.storage.local.set({ [key]: list.slice(-cap) });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only extension pages (popup/dashboard) may spend the API key, never
  // content scripts running on web pages.
  const fromExtensionPage = !!sender.url && sender.url.startsWith(chrome.runtime.getURL(""));
  if (msg.type === "NB_AI" && fromExtensionPage) {
    callGemini(msg.prompt).then(sendResponse);
    return true;
  }
  if (msg.type === "NB_FEEDBACK") {
    pushCapped("nb_feedback", { t: Date.now(), style: msg.style, ok: !!msg.ok }, 300).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "NB_SAVE") {
    pushCapped("nb_saved", { t: Date.now(), kind: msg.kind, text: String(msg.text || "").slice(0, 5000) }, 100).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// --- Reminders (user-configured in the profile) ---
async function applyReminders(p) {
  await chrome.alarms.clearAll();
  if (p.breakEvery > 0) chrome.alarms.create("nb-break", { periodInMinutes: p.breakEvery });
  if (p.wellbeing && p.checkinEvery > 0) chrome.alarms.create("nb-checkin", { periodInMinutes: p.checkinEvery });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  const message = alarm.name === "nb-break"
    ? "Time for a short break. Stretch, drink some water, or rest your eyes."
    : alarm.name === "nb-checkin"
    ? "Quick check-in: how are you feeling right now? Open the NeuroBridge dashboard when you're ready."
    : null;
  if (message) chrome.notifications.create({ type: "basic", iconUrl: NOTIFY_ICON, title: "NeuroBridge", message });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.nb_profile) {
    applyReminders({ ...DEFAULT_PROFILE, ...(changes.nb_profile.newValue || {}) });
  }
});

// --- Calm/focus sound, via an offscreen document ---
// A service worker can't play audio and a popup dies when it closes, so a
// hidden offscreen document plays the sound.

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Play a calming ambient sound that continues after the popup closes.",
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "NB_SOUND_CMD") return;
  (async () => {
    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({ target: "nb-offscreen", ...msg.payload });
    const { nb_sound_state: prev } = await chrome.storage.local.get("nb_sound_state");
    const state = { playing: prev?.playing ?? false, kind: prev?.kind ?? "white", volume: prev?.volume ?? 30 };
    if (msg.payload.action === "start") { state.playing = true; state.kind = msg.payload.kind; state.volume = msg.payload.volume; }
    if (msg.payload.action === "stop") { state.playing = false; }
    if (msg.payload.action === "setVolume") { state.volume = msg.payload.volume; }
    await chrome.storage.local.set({ nb_sound_state: state });
    sendResponse({ ok: true });
  })();
  return true;
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!MENU_ITEMS.some((m) => m.id === info.menuItemId)) return;
  const selection = info.selectionText || "";
  if (!selection.trim()) return;

  // Show a loading panel immediately, then update it once Gemini responds.
  chrome.tabs.sendMessage(tab.id, { type: "NB_LOADING" });

  const profile = await loadProfile();
  const result = await callGemini(buildPrompt(info.menuItemId, selection, profile));
  chrome.tabs.sendMessage(tab.id, {
    type: "NB_RESULT",
    kind: info.menuItemId,
    style: profile.style,
    result,
  });
});
