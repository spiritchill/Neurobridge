const GEMINI_MODEL = "gemini-3.5-flash-lite";
const FILLER_WORDS = ["um", "uh", "like", "so", "actually", "basically", "you know", "kind of", "sort of"];

const micBtn = document.getElementById("micBtn");
const transcriptEl = document.getElementById("transcript");
const outputEl = document.getElementById("output");
const statsEl = document.getElementById("stats");
const historyEl = document.getElementById("history");
const typedInput = document.getElementById("typedInput");
const checkTypedBtn = document.getElementById("checkTypedBtn");
const voicePanel = document.getElementById("voicePanel");
const typePanel = document.getElementById("typePanel");

// --- Tabs ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.setAttribute("aria-pressed", "false"));
    btn.setAttribute("aria-pressed", "true");
    const isVoice = btn.dataset.tab === "voice";
    voicePanel.style.display = isVoice ? "block" : "none";
    typePanel.style.display = isVoice ? "none" : "block";
  });
});

// --- Gemini call ---
async function callGemini(prompt) {
  const { gemini_key } = await chrome.storage.local.get("gemini_key");
  if (!gemini_key) throw new Error("No API key saved — set it in the NeuroBridge popup first.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": gemini_key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
}

// --- Local stats: no AI call needed for these ---
function countFillers(text) {
  const lower = text.toLowerCase();
  let count = 0;
  for (const f of FILLER_WORDS) {
    const re = new RegExp(`\\b${f.replace(/\s+/g, "\\s+")}\\b`, "g");
    count += (lower.match(re) || []).length;
  }
  return count;
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function showStats({ wpm, fillers, words }) {
  statsEl.style.display = "flex";
  statsEl.innerHTML = `
    ${wpm != null ? `<div><b>${wpm}</b> words/min</div>` : ""}
    <div><b>${fillers}</b> filler word${fillers === 1 ? "" : "s"}</div>
    <div><b>${words}</b> word${words === 1 ? "" : "s"}</div>
  `;
}

// --- History ---
async function saveAttempt(entry) {
  const { speech_history } = await chrome.storage.local.get("speech_history");
  const history = speech_history || [];
  history.unshift(entry);
  await chrome.storage.local.set({ speech_history: history.slice(0, 20) });
  renderHistory(history);
}

function renderHistory(history) {
  if (!history || history.length === 0) {
    historyEl.innerHTML = `<p class="sub">Nothing yet — your practice attempts will show up here.</p>`;
    return;
  }
  historyEl.innerHTML = history
    .map((h) => {
      const when = new Date(h.time).toLocaleString();
      const statLine = [
        h.wpm != null ? `${h.wpm} wpm` : null,
        `${h.fillers} filler${h.fillers === 1 ? "" : "s"}`,
        h.mode === "typed" ? "typed" : "spoken",
      ].filter(Boolean).join(" · ");
      return `<div class="history-item">
        <div class="history-time">${escapeHtml(when)} — ${statLine}</div>
        <div style="margin:4px 0;">“${escapeHtml(h.text)}”</div>
        <div style="color:#1F7A6C;">${escapeHtml(h.feedback)}</div>
      </div>`;
    })
    .join("");
}

chrome.storage.local.get("speech_history").then(({ speech_history }) => renderHistory(speech_history));

document.getElementById("clearHistoryBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({ speech_history: [] });
  renderHistory([]);
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- Shared: get feedback + stats + save, for either voice or typed input ---
async function processAttempt(text, mode, durationSeconds) {
  outputEl.textContent = "Thinking…";
  const fillers = countFillers(text);
  const words = wordCount(text);
  const wpm = durationSeconds ? Math.round((words / durationSeconds) * 60) : null;
  showStats({ wpm, fillers, words });

  try {
    const feedback = await callGemini(
      `Someone practicing spoken communication said or wrote: "${text}". Give 2-3 short, encouraging tips on clarity or wording only. Plain text list, no preamble.`
    );
    outputEl.textContent = feedback.trim();
    await saveAttempt({ time: Date.now(), text, mode, wpm, fillers, feedback: feedback.trim() });
  } catch (err) {
    outputEl.textContent = err.message;
  }
}

// --- Voice input ---
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizing = false;
let startTime = 0;

if (SpeechRec) {
  const rec = new SpeechRec();
  rec.lang = "en-US";
  rec.continuous = false;
  rec.interimResults = false;

  rec.onstart = () => { recognizing = true; startTime = Date.now(); micBtn.textContent = "⏺ Listening…"; transcriptEl.textContent = ""; };
  rec.onend = () => { recognizing = false; micBtn.textContent = "Start speaking"; };
  rec.onerror = (e) => { transcriptEl.textContent = "Mic error: " + e.error; recognizing = false; micBtn.textContent = "Start speaking"; };

  rec.onresult = (e) => {
    const said = e.results[0][0].transcript;
    const durationSeconds = Math.max(1, (Date.now() - startTime) / 1000);
    transcriptEl.textContent = "“" + said + "”";
    processAttempt(said, "spoken", durationSeconds);
  };

  micBtn.addEventListener("click", () => { recognizing ? rec.stop() : rec.start(); });
} else {
  micBtn.disabled = true;
  transcriptEl.textContent = "Speech recognition not supported in this browser.";
}

// --- Typed input ---
checkTypedBtn.addEventListener("click", () => {
  const text = typedInput.value.trim();
  if (!text) return;
  processAttempt(text, "typed", null);
});
