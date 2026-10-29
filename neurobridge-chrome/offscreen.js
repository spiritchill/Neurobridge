// offscreen.js — runs in a hidden, persistent extension document.
// This is what actually keeps sound playing after the popup closes:
// the popup is destroyed on blur, but this document is not.

let audioCtx = null, node = null, gainNode = null;

function makeNoiseBuffer(ctx, kind) {
  const size = 2 * ctx.sampleRate;
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < size; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === "brown") {
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5;
    } else {
      data[i] = white * 0.5;
    }
  }
  return buffer;
}

function start(kind, volumePercent) {
  stop(); // clean any existing playback first
  audioCtx = new AudioContext();
  gainNode = audioCtx.createGain();
  gainNode.gain.value = (volumePercent / 100) * 0.5;
  gainNode.connect(audioCtx.destination);

  if (kind === "tone") {
    node = audioCtx.createOscillator();
    node.type = "sine";
    node.frequency.value = 110;
    node.connect(gainNode);
    node.start();
  } else {
    const src = audioCtx.createBufferSource();
    src.buffer = makeNoiseBuffer(audioCtx, kind);
    src.loop = true;
    src.connect(gainNode);
    src.start();
    node = src;
  }
}

function stop() {
  if (node) { try { node.stop(); } catch (e) {} try { node.disconnect(); } catch (e) {} node = null; }
  if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
  gainNode = null;
}

function setVolume(volumePercent) {
  if (gainNode) gainNode.gain.value = (volumePercent / 100) * 0.5;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "nb-offscreen") return;
  if (msg.action === "start") start(msg.kind, msg.volume);
  if (msg.action === "stop") stop();
  if (msg.action === "setVolume") setVolume(msg.volume);
  sendResponse({ ok: true });
});
