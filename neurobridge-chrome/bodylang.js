// bodylang.js — local, optional body-cue explorer using MediaPipe Pose.
// Only describes observable posture/gesture cues. It does not infer emotion,
// intent, honesty, or mood, and no video leaves the device.

const $ = (s) => document.querySelector(s);
const canvas = $("#view"), g = canvas.getContext("2d");
const video = document.createElement("video");
video.playsInline = true; video.muted = true;

// What each cue is, what people might read into it, and why not to over-read it.
const CUES = {
  armsCrossed: ["Arms look crossed in front", "People cross their arms when they're cold, relaxed, thinking, comfortable, or keeping warm. It is not a reliable sign of any one feeling."],
  handRaised: ["A hand is raised above shoulder height", "Often a wave, a question, getting attention, adjusting hair or glasses, or stretching."],
  handNearFace: ["A hand is near the face", "Commonly thinking, resting, scratching, adjusting glasses, or covering a yawn or cough."],
  headTurnedLeft: ["Head is turned toward their left", "Usually looking at something else, such as a second screen, a person, or a note."],
  headTurnedRight: ["Head is turned toward their right", "Usually looking at something else, such as a second screen, a person, or a note."],
  headTiltLeft: ["Head is tilted toward their left shoulder", "Often listening, thinking, or just a comfortable resting position."],
  headTiltRight: ["Head is tilted toward their right shoulder", "Often listening, thinking, or just a comfortable resting position."],
  narrowShoulders: ["Shoulders look narrower than at baseline", "The body may be turned a little sideways, or leaning back. Camera angle can cause this too."],
  closer: ["Shoulders look wider than at baseline", "The person may be leaning toward the camera, or sitting closer to it."],
  lotsOfMovement: ["A lot of movement", "Could be gesturing while talking, shifting position, or adjusting something. Many people move more when concentrating or excited."],
};

let pose = null, stream = null, running = false, busy = false, rafId = 0;
let baseline = null, calibSamples = [], history = [], lastT = 0;
const seconds = {};

const vis = (p) => p && (p.visibility ?? 1) > 0.5;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

function analyze(lm) {
  const lS = lm[11], rS = lm[12];
  if (!vis(lS) || !vis(rS)) return { cues: [], note: "Shoulders aren't clearly in view." };
  const mid = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2 };
  const sw = dist(lS, rS);
  if (sw < 0.05) return { cues: [], note: "Move a little closer to the camera." };

  // Calibration: median shoulder width while facing the camera.
  if (!baseline) {
    calibSamples.push(sw);
    if (calibSamples.length >= 45) baseline = median(calibSamples);
    return { cues: [], note: "Setting your baseline…", calibrating: true };
  }

  const cues = [];
  const nose = lm[0], lE = lm[7], rE = lm[8], lW = lm[15], rW = lm[16];

  const ratio = sw / baseline;
  if (ratio < 0.72) cues.push("narrowShoulders"); else if (ratio > 1.3) cues.push("closer");

  // Image is unmirrored: the person's left side has the larger x.
  if (vis(nose)) {
    const off = (nose.x - mid.x) / sw;
    if (off > 0.4) cues.push("headTurnedLeft"); else if (off < -0.4) cues.push("headTurnedRight");
  }
  if (vis(lE) && vis(rE)) {
    const tilt = Math.atan2(lE.y - rE.y, lE.x - rE.x) * 180 / Math.PI;
    if (tilt > 15) cues.push("headTiltLeft"); else if (tilt < -15) cues.push("headTiltRight");
  }
  if ((vis(lW) && lW.y < mid.y - 0.2 * sw) || (vis(rW) && rW.y < mid.y - 0.2 * sw)) cues.push("handRaised");
  if (vis(nose) && ((vis(lW) && dist(lW, nose) < 0.7 * sw) || (vis(rW) && dist(rW, nose) < 0.7 * sw))) cues.push("handNearFace");
  if (vis(lW) && vis(rW) && lW.x < mid.x && rW.x > mid.x &&
      lW.y > mid.y && lW.y < mid.y + 1.6 * sw && rW.y > mid.y && rW.y < mid.y + 1.6 * sw) cues.push("armsCrossed");

  // Movement: average motion of a few points over roughly the last second.
  const pts = [mid, vis(nose) ? nose : mid, vis(lW) ? lW : mid, vis(rW) ? rW : mid];
  history.push(pts.map((p) => ({ x: p.x, y: p.y })));
  if (history.length > 30) history.shift();
  if (history.length > 10) {
    let total = 0, n = 0;
    for (let i = 1; i < history.length; i++) for (let j = 0; j < pts.length; j++) { total += dist(history[i][j], history[i - 1][j]); n++; }
    if (total / n / sw > 0.035) cues.push("lotsOfMovement");
  }
  return { cues };
}

const LINES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [7, 8], [0, 7], [0, 8]];
function draw(image, lm) {
  g.save(); g.clearRect(0, 0, canvas.width, canvas.height);
  g.translate(canvas.width, 0); g.scale(-1, 1);   // mirror, like a mirror/selfie view
  g.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (lm) {
    g.strokeStyle = "#7FE0CC"; g.lineWidth = 3; g.fillStyle = "#fff";
    for (const [a, b] of LINES) if (vis(lm[a]) && vis(lm[b])) {
      g.beginPath(); g.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height); g.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height); g.stroke();
    }
    for (const i of [0, 7, 8, 11, 12, 13, 14, 15, 16]) if (vis(lm[i])) {
      g.beginPath(); g.arc(lm[i].x * canvas.width, lm[i].y * canvas.height, 4, 0, 7); g.fill();
    }
  }
  g.restore();
}

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) e.setAttribute(k, v);
  for (const k of kids.flat()) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

function renderNow(result) {
  const box = $("#now");
  if (result.note) { box.replaceChildren(h("p", { class: "muted" }, result.note)); return; }
  if (!result.cues.length) { box.replaceChildren(h("p", { class: "muted" }, "No notable cues right now. That's normal.")); return; }
  box.replaceChildren(...result.cues.map((c) => h("div", { class: "cue" }, h("b", {}, CUES[c][0]), h("span", {}, "Could mean: " + CUES[c][1]))));
}

function renderSummary() {
  const entries = Object.entries(seconds).filter(([, s]) => s >= 1).sort((a, b) => b[1] - a[1]);
  const box = $("#summary");
  if (!entries.length) { box.replaceChildren(h("p", { class: "muted" }, "Time each cue was visible will appear here.")); return; }
  box.replaceChildren(h("ul", {}, entries.map(([c, s]) => h("li", {}, `${CUES[c][0]}: about ${Math.round(s)} s`))),
    h("p", { class: "muted" }, "This only counts how long a cue was visible. It doesn't say how anyone felt."));
}

function onResults(res) {
  draw(res.image, res.poseLandmarks);
  const now = performance.now(), dt = lastT ? (now - lastT) / 1000 : 0; lastT = now;
  if (!res.poseLandmarks) { renderNow({ cues: [], note: "No person detected in view." }); return; }
  const result = analyze(res.poseLandmarks);
  if (result.calibrating) $("#calib").textContent = `Setting your baseline… ${Math.round((calibSamples.length / 45) * 100)}%`;
  else if (baseline) $("#calib").textContent = "Baseline set. Press Stop and Start again to recalibrate.";
  for (const c of result.cues) seconds[c] = (seconds[c] || 0) + dt;
  renderNow(result);
  if (Math.random() < 0.1) renderSummary();
}

async function loop() {
  if (!running) return;
  if (video.readyState >= 2 && !busy) {
    busy = true;
    try { await pose.send({ image: video }); } catch (e) {}
    busy = false;
  }
  rafId = requestAnimationFrame(loop);
}

async function start() {
  $("#startBtn").disabled = true;
  $("#status").textContent = "Loading the on-device model…";
  try {
    if (!pose) {
      pose = new Pose({ locateFile: (f) => `vendor/pose/${f}` });
      pose.setOptions({ modelComplexity: 0, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      pose.onResults(onResults);
      await pose.initialize();
    }
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    video.srcObject = stream; await video.play();
  } catch (e) {
    $("#status").textContent = "Couldn't start the camera or model. Check camera permission and try again.";
    $("#startBtn").disabled = false; return;
  }
  baseline = null; calibSamples = []; history = []; lastT = 0;
  running = true; $("#stopBtn").disabled = false; $("#status").textContent = "Camera on. Processing on this device only.";
  loop();
}

function stop() {
  running = false; cancelAnimationFrame(rafId);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null; video.srcObject = null;
  g.clearRect(0, 0, canvas.width, canvas.height);
  $("#startBtn").disabled = false; $("#stopBtn").disabled = true;
  $("#status").textContent = "Camera off."; renderSummary();
}

$("#startBtn").addEventListener("click", start);
$("#stopBtn").addEventListener("click", stop);
window.addEventListener("pagehide", stop);
