// shared.js — loaded by background.js and the dashboard.
// Single source of truth for the user's profile and how it shapes AI prompts.

const DEFAULT_PROFILE = {
  style: "concise",     // concise | detailed | structured | examples
  tone: "direct",       // direct | gentle
  steps: 5,             // default number of steps in a breakdown
  breakEvery: 0,        // minutes, 0 = off
  checkinEvery: 0,      // minutes, 0 = off
  wellbeing: true,      // optional well-being tracking on/off
  fontScale: 1,         // dashboard + panel text size
  sensory: "",          // the user's own sensory notes (never sent to the AI)
};

const STYLE_HINTS = {
  concise: "Be concise: only what matters, as few words as possible.",
  detailed: "Be thorough: explain each point fully, with context.",
  structured: "Use clear structure: short labelled sections and lists.",
  examples: "Explain with a concrete example for each main point.",
};

const TONE_HINTS = {
  direct: "Tone: direct and plain, no filler and no flattery.",
  gentle: "Tone: warm and gentle, but still clear and short.",
};

function profileHint(p) {
  return `${STYLE_HINTS[p.style] || ""} ${TONE_HINTS[p.tone] || ""} Avoid idioms and figurative language. Never diagnose, and never give medical or mental-health advice.`;
}

async function loadProfile() {
  const { nb_profile } = await chrome.storage.local.get("nb_profile");
  return { ...DEFAULT_PROFILE, ...(nb_profile || {}) };
}
