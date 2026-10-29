// dashboard.js — full-page NeuroBridge dashboard. All data stays in
// chrome.storage.local; only text you submit to an AI feature is sent to Gemini.

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const store = {
  async get(k, d) { const o = await chrome.storage.local.get(k); return o[k] ?? d; },
  set(k, v) { return chrome.storage.local.set({ [k]: v }); },
};

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (["value", "checked", "disabled"].includes(k)) e[k] = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}

async function ai(prompt) {
  try { return (await chrome.runtime.sendMessage({ type: "NB_AI", prompt })) || { error: "no_response" }; }
  catch (e) { return { error: "no_response" }; }
}
const aiError = (r) => r.error === "no_key"
  ? "No Gemini API key yet. Add it from the NeuroBridge toolbar icon."
  : `Something went wrong (${r.error}). Try again.`;

function parseJson(text) {
  const t = String(text || "").replace(/```json|```/g, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < 0) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
}

const fmtDate = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
let profile = { ...DEFAULT_PROFILE };

// Feedback + save buttons under an AI result.
function resultActions(kind, style, getText) {
  const note = h("span", { class: "muted" });
  const vote = (ok) => {
    chrome.runtime.sendMessage({ type: "NB_FEEDBACK", style, ok });
    note.textContent = ok ? "Thanks, noted." : "Noted. You can change your style in Profile.";
  };
  return h("div", { class: "row" },
    h("button", { class: "ghost", onclick: () => vote(true) }, "👍 Helped"),
    h("button", { class: "ghost", onclick: () => vote(false) }, "👎 Didn't help"),
    h("button", { class: "ghost", onclick: () => { chrome.runtime.sendMessage({ type: "NB_SAVE", kind, text: getText() }); note.textContent = "Saved."; } }, "💾 Save"),
    h("button", { class: "ghost", onclick: () => { try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(getText())); } catch (e) {} } }, "🔊 Read aloud"),
    note);
}

// ---------- views ----------
const views = {};
const TABS = [
  ["today", "Today"], ["tasks", "Tasks"], ["transform", "Transform"], ["assistant", "Assistant"],
  ["message", "Message check"], ["checkin", "Check-in"], ["sensory", "Sensory"], ["nonverbal", "Nonverbal cues"], ["profile", "Profile"], ["privacy", "Privacy"],
];

async function show(name) {
  profile = await loadProfile();
  document.documentElement.style.fontSize = 16 * (profile.fontScale || 1) + "px";
  const nav = $("#nav");
  nav.replaceChildren(...TABS.filter(([k]) => k !== "checkin" || profile.wellbeing).map(([k, label]) =>
    h("button", { class: k === name ? "active" : "", onclick: () => show(k) }, label)));
  if (name === "checkin" && !profile.wellbeing) name = "today";
  $("#main").replaceChildren(await views[name]());
  location.hash = name;
}

// --- Today ---
views.today = async () => {
  const tasks = await store.get("nb_tasks", []);
  const checkins = await store.get("nb_checkins", []);
  const fb = await store.get("nb_feedback", []);
  const saved = await store.get("nb_saved", []);
  const root = h("div");

  // Current task
  const active = tasks.find((t) => t.steps.some((s) => !s.done));
  const card = h("div", { class: "card" }, h("h2", {}, "Next step"));
  if (active) {
    const done = active.steps.filter((s) => s.done).length;
    const next = active.steps.find((s) => !s.done);
    card.append(h("div", { class: "muted" }, active.title),
      h("div", { class: "step" }, next.text),
      h("div", { class: "progress" }, h("div", { style: `width:${(done / active.steps.length) * 100}%` })),
      h("button", { onclick: () => show("tasks") }, "Open tasks"));
  } else {
    card.append(h("p", { class: "sub" }, "No active task. Add one in Tasks and it will be broken into small steps."),
      h("button", { onclick: () => show("tasks") }, "Add a task"));
  }
  root.append(card);

  // Check-in
  if (profile.wellbeing) {
    const last = checkins[checkins.length - 1];
    root.append(h("div", { class: "card" }, h("h2", {}, "Last check-in"),
      h("p", { class: "sub" }, last ? `${fmtDate(last.t)}. Mood ${last.mood}/5, energy ${last.energy}/5${last.emotions.length ? ", " + last.emotions.join(", ") : ""}.` : "No check-ins yet. They're optional."),
      h("button", { class: "ghost", onclick: () => show("checkin") }, "Check in")));
  }

  // Feedback-based suggestion (transparent, user-controlled)
  const rate = {};
  for (const f of fb) { (rate[f.style] ??= { up: 0, n: 0 }).n++; if (f.ok) rate[f.style].up++; }
  const lines = Object.entries(rate).map(([s, r]) => `${s}: ${r.up} of ${r.n} rated helpful`);
  const best = Object.entries(rate).filter(([, r]) => r.n >= 3).sort((a, b) => b[1].up / b[1].n - a[1].up / a[1].n)[0];
  const fcard = h("div", { class: "card" }, h("h2", {}, "What has helped"));
  if (lines.length) {
    fcard.append(h("ul", {}, lines.map((l) => h("li", {}, l))));
    if (best && best[0] !== profile.style && best[1].up / best[1].n >= 0.6) {
      fcard.append(h("p", {}, `You've rated "${best[0]}" explanations helpful most often. Want to use it as your default?`),
        h("button", { onclick: async () => { await store.set("nb_profile", { ...profile, style: best[0] }); show("today"); } }, `Switch to ${best[0]}`));
    }
  } else fcard.append(h("p", { class: "sub" }, "Rate results with 👍 or 👎 and your suggestions will adapt. You always decide what changes."));
  root.append(fcard);

  // Saved
  const scard = h("div", { class: "card" }, h("h2", {}, "Saved results"));
  if (!saved.length) scard.append(h("p", { class: "sub" }, "Nothing saved yet."));
  for (const s of saved.slice(-5).reverse()) {
    scard.append(h("div", { class: "out" }, h("div", { class: "muted" }, `${fmtDate(s.t)} · ${s.kind}`), s.text));
  }
  root.append(scard);
  return root;
};

// --- Tasks ---
views.tasks = async () => {
  const root = h("div");
  const input = h("input", { type: "text", placeholder: 'e.g. "Prepare for my college presentation"' });
  const status = h("div", { class: "muted" });
  const list = h("div");

  async function addTask() {
    const title = input.value.trim();
    if (!title) return;
    status.textContent = "Breaking it down…";
    const r = await ai(`Break this task into ${profile.steps} small, concrete, ordered steps that someone who finds planning hard could start right away. Each step is one short sentence starting with a verb. ${profileHint(profile)} Return ONLY JSON like {"steps":["..."]}.\n\nTask: ${title}`);
    const data = r.error ? null : parseJson(r.text);
    if (!data?.steps?.length) { status.textContent = r.error ? aiError(r) : "Couldn't read the plan. Try rewording the task."; return; }
    const tasks = await store.get("nb_tasks", []);
    tasks.push({ id: Date.now(), title, steps: data.steps.map((s) => ({ text: String(s), done: false })) });
    await store.set("nb_tasks", tasks);
    input.value = ""; status.textContent = ""; draw();
  }

  async function mutate(id, fn) {
    const tasks = await store.get("nb_tasks", []);
    const t = tasks.find((x) => x.id === id);
    if (t) await fn(t, tasks);
    await store.set("nb_tasks", tasks);
    draw();
  }

  async function draw() {
    const tasks = await store.get("nb_tasks", []);
    list.replaceChildren();
    if (!tasks.length) list.append(h("p", { class: "sub" }, "No tasks yet."));
    for (const t of tasks) {
      const done = t.steps.filter((s) => s.done).length;
      const idx = t.steps.findIndex((s) => !s.done);
      const next = t.steps[idx];
      const card = h("div", { class: "card" }, h("h2", {}, t.title),
        h("div", { class: "progress" }, h("div", { style: `width:${(done / t.steps.length) * 100}%` })),
        h("div", { class: "muted" }, `${done} of ${t.steps.length} steps done`));
      if (next) {
        card.append(h("div", { class: "step" }, next.text), h("div", { class: "row" },
          h("button", { onclick: () => mutate(t.id, (task) => { task.steps[idx].done = true; }) }, "✓ Done"),
          h("button", { class: "ghost", onclick: async () => {
            status.textContent = "Splitting that step…";
            const r = await ai(`Split this step into 3 smaller, easier steps. One short sentence each, starting with a verb. ${profileHint(profile)} Return ONLY JSON like {"steps":["..."]}.\n\nStep: ${next.text}`);
            const data = r.error ? null : parseJson(r.text);
            status.textContent = data?.steps?.length ? "" : (r.error ? aiError(r) : "Couldn't split that step.");
            if (data?.steps?.length) mutate(t.id, (task) => {
              task.steps.splice(idx, 1, ...data.steps.map((s) => ({ text: String(s), done: false })));
            });
          } }, "This is too big"),
          h("button", { class: "ghost", onclick: () => mutate(t.id, (task) => { const [s] = task.steps.splice(idx, 1); task.steps.push(s); }) }, "Do later"),
          h("button", { class: "ghost", onclick: () => mutate(t.id, (task, all) => { all.splice(all.indexOf(task), 1); }) }, "Delete task")));
      } else {
        card.append(h("p", {}, "🎉 All steps done."), h("button", { class: "ghost", onclick: () => mutate(t.id, (task, all) => { all.splice(all.indexOf(task), 1); }) }, "Clear task"));
      }
      list.append(card);
    }
  }

  root.append(h("h2", {}, "Tasks"), h("p", { class: "sub" }, "Describe something big. You'll get one small step at a time."),
    h("div", { class: "card" }, input, h("div", { class: "row" }, h("button", { onclick: addTask }, "Break it down"), status)), list);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") addTask(); });
  await draw();
  return root;
};

// --- Transform ---
views.transform = async () => {
  const FORMATS = {
    simple: "Rewrite in short, clear sentences with everyday words, keeping the full meaning.",
    bullets: 'Convert into short bullet points using "-".',
    steps: "Convert into numbered, step-by-step instructions.",
    takeaways: "Give a one-sentence summary, then the 3 to 5 key takeaways as bullets.",
    sections: "Reorganize into short, clearly labelled sections.",
  };
  const text = h("textarea", { placeholder: "Paste a paragraph, instructions, an article…" });
  const format = h("select", {}, Object.keys(FORMATS).map((k) => h("option", { value: k }, k === "simple" ? "Simple language" : k[0].toUpperCase() + k.slice(1))));
  const style = h("select", {}, Object.keys(STYLE_HINTS).map((k) => h("option", { value: k }, k[0].toUpperCase() + k.slice(1))));
  style.value = profile.style;
  const out = h("div");
  const run = h("button", { onclick: async () => {
    const t = text.value.trim(); if (!t) return;
    out.replaceChildren(h("div", { class: "muted" }, "Working…"));
    const p = { ...profile, style: style.value };
    const r = await ai(`${FORMATS[format.value]} Output only the result, no preamble. ${profileHint(p)}\n\nText:\n${t}`);
    if (r.error) { out.replaceChildren(h("div", { class: "out" }, aiError(r))); return; }
    out.replaceChildren(h("div", { class: "out" }, r.text), resultActions("transform-" + format.value, style.value, () => r.text));
  } }, "Transform");
  return h("div", {}, h("h2", {}, "Content transformer"), h("p", { class: "sub" }, "Turn complicated text into something easier to process."),
    h("div", { class: "card" }, text,
      h("div", { class: "row" }, h("div", { class: "grow" }, h("label", {}, "Format"), format), h("div", { class: "grow" }, h("label", {}, "Explanation style"), style)),
      h("div", { class: "row" }, run), out));
};

// --- Assistant ---
views.assistant = async () => {
  const q = h("textarea", { placeholder: "Ask anything: organise your thoughts, understand instructions, plan your day…" });
  const out = h("div");
  return h("div", {}, h("h2", {}, "Assistant"), h("p", { class: "sub" }, "Answers follow your profile. It gives practical help, not diagnoses or medical advice."),
    h("div", { class: "card" }, q, h("div", { class: "row" }, h("button", { onclick: async () => {
      const t = q.value.trim(); if (!t) return;
      out.replaceChildren(h("div", { class: "muted" }, "Thinking…"));
      const r = await ai(`You are a practical, supportive assistant for a neurodivergent person. ${profileHint(profile)} If the question is about a health condition or crisis, say that a professional or someone they trust can help, and give only general, safe suggestions.\n\nQuestion: ${t}`);
      if (r.error) { out.replaceChildren(h("div", { class: "out" }, aiError(r))); return; }
      out.replaceChildren(h("div", { class: "out" }, r.text), resultActions("assistant", profile.style, () => r.text));
    } }, "Ask")), out));
};

// --- Message check ---
views.message = async () => {
  const msg = h("textarea", { placeholder: "Paste a message you're about to send, e.g. an email to a professor." });
  const who = h("select", {}, ["a professor or manager", "a colleague or classmate", "a friend or family member", "a customer or stranger"].map((o) => h("option", { value: o }, o)));
  const out = h("div");
  return h("div", {}, h("h2", {}, "Communication self-check"), h("p", { class: "sub" }, "Optional suggestions on clarity and tone. You decide how you communicate."),
    h("div", { class: "card" }, msg, h("label", {}, "Who is it for?"), who, h("div", { class: "row" }, h("button", { onclick: async () => {
      const t = msg.value.trim(); if (!t) return;
      out.replaceChildren(h("div", { class: "muted" }, "Checking…"));
      const r = await ai(`Review this message written to ${who.value}. Reply with three short parts, labelled: "Clarity" (what is clear and what could be ambiguous), "More direct version" (a rewrite that keeps the writer's meaning), and "Gentler version" (a warmer rewrite). These are optional suggestions; do not judge the writer's style as wrong. ${profileHint(profile)}\n\nMessage:\n${t}`);
      if (r.error) { out.replaceChildren(h("div", { class: "out" }, aiError(r))); return; }
      out.replaceChildren(h("div", { class: "out" }, r.text), resultActions("message-check", profile.style, () => r.text));
    } }, "Check my message")), out),
    h("div", { class: "card" }, h("h2", {}, "Practise out loud"), h("p", { class: "sub" }, "Rehearse speaking and get pace and filler-word feedback."),
      h("button", { class: "ghost", onclick: () => chrome.tabs.create({ url: chrome.runtime.getURL("speech.html") }) }, "Open speech check")));
};

// --- Check-in ---
views.checkin = async () => {
  const EMOTIONS = ["calm", "happy", "focused", "tired", "anxious", "overwhelmed", "frustrated", "sad"];
  const TRIGGERS = ["noise", "unexpected change", "demanding task", "crowds", "bright light", "social demands"];
  const MOODS = ["😣", "🙁", "😐", "🙂", "😄"];
  const sel = { mood: 0, energy: 0, emotions: new Set(), triggers: new Set() };
  const root = h("div");
  const result = h("div");
  const note = h("textarea", { placeholder: "Anything you want to remember about today (optional)", style: "min-height:60px" });

  const scale = (key) => h("div", { class: "row" }, [1, 2, 3, 4, 5].map((n) => {
    const b = h("button", { class: "chip", onclick: () => { sel[key] = n; b.parentNode.querySelectorAll(".chip").forEach((c) => c.classList.remove("on")); b.classList.add("on"); } }, key === "mood" ? `${MOODS[n - 1]} ${n}` : String(n));
    return b;
  }));
  const chips = (key, items) => h("div", { class: "row" }, items.map((it) => {
    const b = h("button", { class: "chip", onclick: () => { sel[key].has(it) ? sel[key].delete(it) : sel[key].add(it); b.classList.toggle("on"); } }, it);
    return b;
  }));

  function suggest(c) {
    const out = h("div", { class: "card" }, h("h2", {}, "Suggestions (yours to take or leave)"));
    const items = [];
    if (c.emotions.includes("overwhelmed") || c.mood <= 2) {
      items.push(h("li", {}, "Pause for a few minutes. Then pick one priority and break it into smaller steps. ", h("button", { class: "ghost", onclick: () => show("tasks") }, "Open tasks")));
    }
    if (c.triggers.includes("noise") || c.triggers.includes("crowds")) {
      items.push(h("li", {}, "Try headphones, or move somewhere quieter. ", h("button", { class: "ghost", onclick: () => chrome.runtime.sendMessage({ type: "NB_SOUND_CMD", payload: { action: "start", kind: "brown", volume: 30 } }) }, "Play brown noise")));
    }
    if (c.triggers.includes("bright light")) items.push(h("li", {}, "Dim the lights or take a break away from the screen if you can."));
    if (c.triggers.includes("unexpected change")) items.push(h("li", {}, "Write down what changed and the one next step. A small plan can make change easier to handle."));
    if (c.energy <= 2) items.push(h("li", {}, "Low energy: a short rest, water, or a snack may help before the next task."));
    if (profile.sensory.trim()) items.push(h("li", {}, `From your own sensory notes: ${profile.sensory.trim()}`));
    if (!items.length) items.push(h("li", {}, "Nice. Keep doing what's working."));
    out.append(h("ul", {}, items), h("p", { class: "muted" }, "These are general suggestions based only on what you entered. NeuroBridge can't know how you feel and isn't a substitute for mental health support."));
    return out;
  }

  async function drawHistory() {
    const list = await store.get("nb_checkins", []);
    const card = h("div", { class: "card" }, h("h2", {}, "Your history"));
    if (!list.length) { card.append(h("p", { class: "sub" }, "No check-ins yet.")); return card; }
    // last 14 days of average mood
    const days = [...Array(14)].map((_, i) => dayKey(Date.now() - (13 - i) * 86400000));
    const bars = h("div", { class: "bars" }, days.map((d) => {
      const day = list.filter((c) => dayKey(c.t) === d);
      const avg = day.length ? day.reduce((a, c) => a + c.mood, 0) / day.length : 0;
      return h("div", { class: "bar", style: `height:${(avg / 5) * 100}%;opacity:${avg ? 1 : .15}`, title: `${d}: ${avg ? avg.toFixed(1) + "/5" : "no check-in"}` });
    }));
    card.append(h("div", { class: "muted" }, "Average mood per day, last 14 days (hover for details)"), bars);
    const count = (key) => {
      const m = {}; list.forEach((c) => c[key].forEach((x) => (m[x] = (m[x] || 0) + 1)));
      return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${v})`).join(", ");
    };
    if (count("triggers")) card.append(h("p", {}, "Most reported stressors: ", count("triggers")));
    if (count("emotions")) card.append(h("p", {}, "Most reported feelings: ", count("emotions")));
    card.append(h("div", { class: "muted" }, "Recent"), h("ul", {}, list.slice(-5).reverse().map((c) => h("li", {}, `${fmtDate(c.t)}: mood ${c.mood}/5, energy ${c.energy}/5${c.note ? " · " + c.note : ""}`))));
    return card;
  }

  const form = h("div", { class: "card" },
    h("label", {}, "Mood"), scale("mood"), h("label", {}, "Energy"), scale("energy"),
    h("label", {}, "How would you describe it? (pick any)"), chips("emotions", EMOTIONS),
    h("label", {}, "Anything making things harder? (optional)"), chips("triggers", TRIGGERS),
    h("label", {}, "Note"), note,
    h("div", { class: "row" }, h("button", { onclick: async () => {
      if (!sel.mood || !sel.energy) { result.replaceChildren(h("p", { class: "muted" }, "Pick a mood and an energy level first.")); return; }
      const c = { t: Date.now(), mood: sel.mood, energy: sel.energy, emotions: [...sel.emotions], triggers: [...sel.triggers], note: note.value.trim() };
      const list = await store.get("nb_checkins", []); list.push(c); await store.set("nb_checkins", list);
      result.replaceChildren(suggest(c), await drawHistory());
    } }, "Save check-in")));
  root.append(h("h2", {}, "Check-in"), h("p", { class: "sub" }, "Optional and private. It stays on this device and is never shared."), form, result);
  result.append(await drawHistory());
  return root;
};


// --- Sensory: live sound filter + distracting-sound log ---
// A basic Web Audio chain: microphone -> high-pass -> hum notch -> low-pass
// -> limiter -> noise gate -> output. This is simple filtering, not AI
// sound separation. It keeps running while this tab stays open.
const DEFAULT_SOUND = { low: 120, high: 8000, gate: -80, volume: 80, notch: "off", limiter: true };
const SOUND_PRESETS = {
  quiet: ["Reduce background noise", { low: 120, high: 6000, gate: -55 }],
  voices: ["Voices only", { low: 300, high: 3400, gate: -60 }],
  soften: ["Soften harsh, high sounds", { low: 80, high: 3000, gate: -80 }],
  rumble: ["Reduce rumble and hum", { low: 200, high: 12000, gate: -80, notch: "50" }],
};
const sf = { ctx: null, stream: null, nodes: null, timer: null, running: false, settings: { ...DEFAULT_SOUND }, level: -100, band: "", onTick: null };

function sfApply() {
  if (!sf.nodes) return;
  const { hp, lp, notch, comp, out } = sf.nodes, s = sf.settings, t = sf.ctx.currentTime;
  hp.frequency.setTargetAtTime(s.low, t, 0.02);
  lp.frequency.setTargetAtTime(s.high, t, 0.02);
  notch.type = s.notch === "off" ? "allpass" : "notch";
  notch.frequency.value = s.notch === "off" ? 1000 : Number(s.notch);
  comp.threshold.value = s.limiter ? -24 : 0; comp.ratio.value = s.limiter ? 12 : 1;
  out.gain.setTargetAtTime(s.volume / 100, t, 0.02);
}

const rmsDb = (arr) => { let sum = 0; for (const v of arr) sum += v * v; return 10 * Math.log10(sum / arr.length + 1e-12); };

async function sfStart() {
  sf.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
  const ctx = new AudioContext({ latencyHint: "interactive" });
  const src = ctx.createMediaStreamSource(sf.stream);
  const n = {
    hp: Object.assign(ctx.createBiquadFilter(), { type: "highpass" }),
    notch: Object.assign(ctx.createBiquadFilter(), { type: "allpass" }),
    lp: Object.assign(ctx.createBiquadFilter(), { type: "lowpass" }),
    comp: ctx.createDynamicsCompressor(), gate: ctx.createGain(), out: ctx.createGain(),
    anIn: Object.assign(ctx.createAnalyser(), { fftSize: 2048 }), anF: Object.assign(ctx.createAnalyser(), { fftSize: 1024 }),
  };
  n.notch.Q.value = 30;
  src.connect(n.anIn); src.connect(n.hp); n.hp.connect(n.notch); n.notch.connect(n.lp);
  n.lp.connect(n.anF); n.lp.connect(n.comp); n.comp.connect(n.gate); n.gate.connect(n.out); n.out.connect(ctx.destination);
  sf.ctx = ctx; sf.nodes = n; sf.running = true; sfApply();

  const td = new Float32Array(1024), fd = new Float32Array(1024);
  sf.timer = setInterval(() => {
    n.anF.getFloatTimeDomainData(td); const fDb = rmsDb(td);
    const open = sf.settings.gate <= -80 || fDb > sf.settings.gate;
    n.gate.gain.setTargetAtTime(open ? 1 : 0.1, ctx.currentTime, open ? 0.01 : 0.15);
    n.anIn.getFloatTimeDomainData(td); sf.level = rmsDb(td);
    n.anIn.getFloatFrequencyData(fd);
    const hz = ctx.sampleRate / 2048, bands = { "low rumble (under 250 Hz)": [20, 250], "low-mid (250 to 1000 Hz)": [250, 1000], "voice range (1 to 3.4 kHz)": [1000, 3400], "high, sharp sounds (over 3.4 kHz)": [3400, 12000] };
    let best = "", bestP = 0;
    for (const [name, [a, b]] of Object.entries(bands)) {
      let p = 0, c = 0; for (let i = Math.floor(a / hz); i < Math.min(fd.length, Math.ceil(b / hz)); i++) { p += Math.pow(10, fd[i] / 10); c++; }
      p = c ? p / c : 0; if (p > bestP) { bestP = p; best = name; }
    }
    sf.band = best;
    if (sf.onTick) sf.onTick();
  }, 40);
}

function sfStop() {
  clearInterval(sf.timer); sf.running = false;
  if (sf.stream) sf.stream.getTracks().forEach((t) => t.stop());
  if (sf.ctx) sf.ctx.close();
  sf.ctx = sf.stream = sf.nodes = null; sf.level = -100;
}

views.sensory = async () => {
  sf.settings = { ...DEFAULT_SOUND, ...(await store.get("nb_sound_settings", {})) };
  const status = h("div", { class: "muted" });
  const meter = h("div", { class: "progress" }, h("div", { style: "width:0%" }));
  const bandLine = h("div", { class: "muted" });
  const head = h("input", { type: "checkbox" });
  const toggle = h("button", {}, sf.running ? "⏹ Stop filter" : "▶ Start live filter");
  const sliders = {};

  const save = () => { store.set("nb_sound_settings", sf.settings); sfApply(); };
  const slider = (key, label, min, max, step, fmt) => {
    const out = h("span", { class: "muted" }, fmt(sf.settings[key]));
    const input = h("input", { type: "range", min, max, step, style: "width:100%" });
    input.value = sf.settings[key];
    input.addEventListener("input", () => { sf.settings[key] = Number(input.value); out.textContent = fmt(sf.settings[key]); save(); });
    sliders[key] = { input, out, fmt };
    return h("div", {}, h("label", {}, label, " ", out), input);
  };
  const sync = () => Object.entries(sliders).forEach(([k, { input, out, fmt }]) => { input.value = sf.settings[k]; out.textContent = fmt(sf.settings[k]); });

  const notch = h("select", {}, [["off", "Off"], ["50", "50 Hz mains hum"], ["60", "60 Hz mains hum"]].map(([v, l]) => h("option", { value: v }, l)));
  notch.value = sf.settings.notch; notch.addEventListener("change", () => { sf.settings.notch = notch.value; save(); });
  const limiter = h("input", { type: "checkbox", checked: sf.settings.limiter });
  limiter.addEventListener("change", () => { sf.settings.limiter = limiter.checked; save(); });

  sf.onTick = () => {
    meter.firstChild.style.width = Math.max(0, Math.min(100, ((sf.level + 70) / 70) * 100)) + "%";
    bandLine.textContent = sf.running && sf.level > -60 ? `Mostly: ${sf.band}` : "";
  };

  toggle.addEventListener("click", async () => {
    if (sf.running) { sfStop(); toggle.textContent = "▶ Start live filter"; status.textContent = "Stopped."; return; }
    if (!head.checked) { status.textContent = "Please confirm you are wearing headphones first."; return; }
    try { await sfStart(); toggle.textContent = "⏹ Stop filter"; status.textContent = "Filtering live. Keep this tab open."; }
    catch (e) { status.textContent = "Couldn't use the microphone. Check permission and try again."; }
  });

  const presets = h("div", { class: "row" }, Object.entries(SOUND_PRESETS).map(([k, [label, vals]]) =>
    h("button", { class: "ghost", onclick: () => { Object.assign(sf.settings, DEFAULT_SOUND, vals); notch.value = sf.settings.notch; sync(); save(); } }, label)));

  // Distracting-sound log
  const logNote = h("input", { type: "text", placeholder: 'What is it? e.g. "fan", "traffic", "people talking"' });
  const logOut = h("div");
  async function drawLog() {
    const marks = await store.get("nb_sound_marks", []);
    logOut.replaceChildren();
    if (!marks.length) return;
    const counts = {}; marks.forEach((m) => { if (m.band) counts[m.band] = (counts[m.band] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const tip = top && top[0].startsWith("low rumble") ? 'Most of your logged sounds are low rumble. Try "Reduce rumble and hum".'
      : top && top[0].startsWith("high") ? 'Most of your logged sounds are high and sharp. Try "Soften harsh, high sounds".'
      : top && top[0].startsWith("voice") ? 'Most of your logged sounds are in the voice range. "Voices only" will keep speech, so try the quiet preset or headphones.'
      : "Try the presets above and keep the one that feels best.";
    logOut.append(h("p", {}, tip), h("ul", {}, marks.slice(-5).reverse().map((m) => h("li", {}, `${fmtDate(m.t)}: ${m.label || "sound"}${m.band ? " (" + m.band + ")" : ""}`))));
  }
  const logBtn = h("button", { class: "ghost", onclick: async () => {
    const marks = await store.get("nb_sound_marks", []);
    marks.push({ t: Date.now(), label: logNote.value.trim(), band: sf.running && sf.level > -60 ? sf.band : "" });
    await store.set("nb_sound_marks", marks.slice(-200)); logNote.value = ""; drawLog();
  } }, "Log a distracting sound");
  await drawLog();

  return h("div", {}, h("h2", {}, "Sensory support"), h("p", { class: "sub" }, "Tools for sounds that feel like too much. They help in some situations, not all."),
    h("div", { class: "card" }, h("h2", {}, "Live sound filter (experimental)"),
      h("p", { class: "sub" }, "Takes your microphone, reduces selected sounds, and plays the result in your headphones. It uses the browser's noise suppression plus simple filters and a quiet-sound gate. It is not AI sound separation, so it can't remove a sound that sits in the same range as speech. It adds a very small delay."),
      h("label", {}, head, " I'm wearing headphones (without them the sound can loop and squeal)"),
      h("div", { class: "row" }, toggle, status), meter, bandLine, presets,
      slider("low", "Cut sounds below", 20, 1000, 10, (v) => `${v} Hz`),
      slider("high", "Cut sounds above", 1000, 16000, 100, (v) => `${v} Hz`),
      slider("gate", "Quiet-sound gate (lower = off)", -80, -30, 1, (v) => v <= -80 ? "off" : `${v} dB`),
      slider("volume", "Output volume", 0, 100, 1, (v) => `${v}%`),
      h("label", {}, "Mains hum filter"), notch,
      h("label", {}, limiter, " Limit sudden loud sounds")),
    h("div", { class: "card" }, h("h2", {}, "Sounds that bother me"),
      h("p", { class: "sub" }, "Log what's distracting. NeuroBridge only stores your note, the time, and a rough sound range (no audio is recorded) and suggests a preset."),
      logNote, h("div", { class: "row" }, logBtn), logOut),
    h("div", { class: "card" }, h("h2", {}, "Other things that can help"),
      h("ul", {}, h("li", {}, "Headphones or earplugs, or moving somewhere quieter."), h("li", {}, "The calm and focus sounds from the toolbar popup."), h("li", {}, "A break. You can set reminders in Profile."))));
};

// --- Nonverbal cues ---
views.nonverbal = async () => h("div", {}, h("h2", {}, "Nonverbal cue explorer"),
  h("p", { class: "sub" }, "An optional learning aid. It uses your camera to describe a few observable body cues, such as head turns, crossed arms, raised hands, and amount of movement, and explains that each can mean many things."),
  h("div", { class: "card" },
    h("ul", {}, h("li", {}, "Off by default. The camera starts only when you press Start on the next page."),
      h("li", {}, "Analysis happens on this device. No video or images are recorded or uploaded."),
      h("li", {}, "It never says someone is bored, angry, dishonest, or uncomfortable. Cues are not mind-reading."),
      h("li", {}, "It's experimental and can be wrong, especially with poor lighting or when your upper body isn't in view.")),
    h("button", { onclick: () => chrome.tabs.create({ url: chrome.runtime.getURL("bodylang.html") }) }, "Open the cue explorer")));

// --- Profile ---
views.profile = async () => {
  const f = {
    style: h("select", {}, Object.keys(STYLE_HINTS).map((k) => h("option", { value: k }, k[0].toUpperCase() + k.slice(1)))),
    tone: h("select", {}, [["direct", "Direct"], ["gentle", "Gentle"]].map(([v, l]) => h("option", { value: v }, l))),
    steps: h("input", { type: "number", min: 3, max: 10 }),
    breakEvery: h("input", { type: "number", min: 0, max: 240 }),
    checkinEvery: h("input", { type: "number", min: 0, max: 480 }),
    fontScale: h("select", {}, [["1", "Normal"], ["1.15", "Larger"], ["1.3", "Largest"]].map(([v, l]) => h("option", { value: v }, l))),
    sensory: h("textarea", { placeholder: "e.g. Loud, constant noise is hard for me. I do better in a quiet room with headphones." }),
  };
  const wb = h("input", { type: "checkbox", checked: profile.wellbeing });
  f.style.value = profile.style; f.tone.value = profile.tone; f.steps.value = profile.steps;
  f.breakEvery.value = profile.breakEvery; f.checkinEvery.value = profile.checkinEvery;
  f.fontScale.value = String(profile.fontScale); f.sensory.value = profile.sensory;
  const status = h("span", { class: "muted" });
  return h("div", {}, h("h2", {}, "Your profile"), h("p", { class: "sub" }, "These settings apply automatically to every feature. Change them any time."),
    h("div", { class: "card" },
      h("label", {}, "Explanation style"), f.style, h("label", {}, "Tone"), f.tone,
      h("label", {}, "Steps in a breakdown (3 to 10)"), f.steps, h("label", {}, "Text size"), f.fontScale),
    h("div", { class: "card" },
      h("label", {}, "Break reminder every N minutes (0 = off)"), f.breakEvery,
      h("label", {}, "Check-in reminder every N minutes (0 = off)"), f.checkinEvery,
      h("div", { class: "row" }, wb, h("span", {}, "Turn on well-being check-ins"))),
    h("div", { class: "card" }, h("label", {}, "My sensory preferences (private notes, never sent to the AI)"), f.sensory),
    h("div", { class: "row" }, h("button", { onclick: async () => {
      const next = { style: f.style.value, tone: f.tone.value, steps: Math.min(10, Math.max(3, Number(f.steps.value) || 5)),
        breakEvery: Math.max(0, Number(f.breakEvery.value) || 0), checkinEvery: Math.max(0, Number(f.checkinEvery.value) || 0),
        wellbeing: wb.checked, fontScale: Number(f.fontScale.value) || 1, sensory: f.sensory.value };
      await store.set("nb_profile", next); status.textContent = "Saved."; show("profile");
    } }, "Save profile"), status));
};

// --- Privacy ---
views.privacy = async () => {
  const KEYS = [["nb_tasks", "Tasks"], ["nb_checkins", "Check-ins"], ["nb_saved", "Saved results"], ["nb_feedback", "Feedback ratings"], ["speech_history", "Speech-check history"], ["nb_sound_marks", "Logged sounds"]];
  const all = await chrome.storage.local.get(null);
  const rows = KEYS.map(([k, label]) => {
    const n = Array.isArray(all[k]) ? all[k].length : 0;
    return h("div", { class: "row" }, h("span", { class: "grow" }, `${label}: ${n}`),
      h("button", { class: "ghost", disabled: !n, onclick: async () => { if (confirm(`Delete all ${label.toLowerCase()}?`)) { await chrome.storage.local.remove(k); show("privacy"); } } }, "Delete"));
  });
  return h("div", {}, h("h2", {}, "Privacy and your data"),
    h("p", { class: "sub" }, "Everything below is stored only in this browser. Text you send to an AI feature goes to Google's Gemini API with your own key. Check-ins, sensory notes, and history are never sent."),
    h("div", { class: "card" }, rows),
    h("div", { class: "card" }, h("h2", {}, "Export or erase"),
      h("div", { class: "row" },
        h("button", { class: "ghost", onclick: () => {
          const data = {}; for (const [k] of [...KEYS, ["nb_profile"]]) if (all[k] !== undefined) data[k] = all[k];
          const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })), download: "neurobridge-data.json" });
          document.body.append(a); a.click(); a.remove();
        } }, "Export my data (JSON)"),
        h("button", { class: "danger", onclick: async () => {
          if (!confirm("Delete ALL NeuroBridge data, including your profile and API key?")) return;
          await chrome.storage.local.clear(); show("privacy");
        } }, "Delete everything"))),
    h("div", { class: "card" }, h("h2", {}, "Our principles"), h("ul", {},
      h("li", {}, "Nothing optional is collected without you turning it on."),
      h("li", {}, "No camera or microphone data is collected, except in the speech check when you press start."),
      h("li", {}, "AI output is a suggestion, not a fact or a diagnosis."),
      h("li", {}, "Well-being tracking is for you only. It is never shared with anyone else."))));
};

const startTab = location.hash.slice(1);
show(startTab in views ? startTab : "today");
