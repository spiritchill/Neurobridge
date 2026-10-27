// --- API key ---
const apiKeyInput = document.getElementById("apiKeyInput");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const keyStatus = document.getElementById("keyStatus");

chrome.storage.local.get("gemini_key").then(({ gemini_key }) => {
  apiKeyInput.value = gemini_key || "";
  keyStatus.textContent = gemini_key ? "Key saved." : "No key yet.";
});

saveKeyBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  chrome.storage.local.set({ gemini_key: key }).then(() => {
    keyStatus.textContent = key ? "Saved." : "Cleared.";
  });
});

// --- Open speech check in its own tab ---
document.getElementById("openSpeechBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("speech.html") });
});

// --- Calm & focus ambient sound ---
// Playback actually happens in an offscreen document owned by
// background.js, so it keeps running after this popup closes.
// This popup only sends commands and reflects the last known state.
const soundToggle = document.getElementById("soundToggle");
const soundType = document.getElementById("soundType");
const volSlider = document.getElementById("volSlider");
let playing = false;

function sendSoundCmd(payload) {
  return chrome.runtime.sendMessage({ type: "NB_SOUND_CMD", payload });
}

function setToggleUI() {
  soundToggle.textContent = playing ? "⏸" : "▶";
}

chrome.storage.local.get("nb_sound_state").then(({ nb_sound_state }) => {
  if (nb_sound_state) {
    playing = !!nb_sound_state.playing;
    soundType.value = nb_sound_state.kind || "white";
    volSlider.value = nb_sound_state.volume ?? 30;
  }
  setToggleUI();
});

soundToggle.addEventListener("click", async () => {
  if (playing) {
    await sendSoundCmd({ action: "stop" });
    playing = false;
  } else {
    await sendSoundCmd({ action: "start", kind: soundType.value, volume: Number(volSlider.value) });
    playing = true;
  }
  setToggleUI();
});

volSlider.addEventListener("input", () => {
  sendSoundCmd({ action: "setVolume", volume: Number(volSlider.value) });
});

soundType.addEventListener("change", async () => {
  if (playing) {
    await sendSoundCmd({ action: "start", kind: soundType.value, volume: Number(volSlider.value) });
  }
});
