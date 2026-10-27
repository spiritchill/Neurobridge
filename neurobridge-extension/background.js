// background.js — MV3 service worker.
// Owns the context menu and the Gemini API calls (so the API key never
// has to live in a content script injected into arbitrary pages).

const GEMINI_MODEL = "gemini-3.5-flash-lite";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "nb-simplify",
    title: "NeuroBridge: Simplify this text",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "nb-steps",
    title: "NeuroBridge: Break this into steps",
    contexts: ["selection"],
  });
});

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

function buildPrompt(kind, selection) {
  if (kind === "nb-steps") {
    return `Break the following into 5 small, ordered, concrete steps. One short sentence per step, plain language, numbered list only, no preamble.\n\nText:\n${selection}`;
  }
  return `Rewrite the following text in short, clear sentences with everyday words, keeping the full meaning. Output only the rewritten text, no preamble.\n\nText:\n${selection}`;
}

// --- Persistent calm/focus sound, via an offscreen document ---
// (A popup is destroyed on blur, so audio started inside it dies the
// instant the popup closes. An offscreen document has no such lifecycle
// tied to the popup, so sound keeps playing after the popup is closed.)

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
  if (msg.type !== "NB_SOUND_CMD") return; // let other listeners handle other message types
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
  return true; // keep the message channel open for the async response
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "nb-simplify" && info.menuItemId !== "nb-steps") return;
  const selection = info.selectionText || "";
  if (!selection.trim()) return;

  // Show a loading panel immediately, then update it once Gemini responds.
  chrome.tabs.sendMessage(tab.id, { type: "NB_LOADING" });

  const result = await callGemini(buildPrompt(info.menuItemId, selection));
  chrome.tabs.sendMessage(tab.id, {
    type: "NB_RESULT",
    kind: info.menuItemId,
    result,
  });
});
