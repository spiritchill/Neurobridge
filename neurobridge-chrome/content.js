// content.js — runs on every page. Only draws a small floating panel
// when told to; does nothing otherwise.

(function () {
  let panel = null;
  const BTN = "background:#E3F0EC;color:#1F7A6C;border:none;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:13px;";
  let fontScale = 1;
  chrome.storage.local.get("nb_profile").then(({ nb_profile }) => { fontScale = nb_profile?.fontScale || 1; });

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "nb-panel";
    panel.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 2147483647;
      width: 320px; max-height: 70vh; overflow-y: auto;
      background: #ffffff; color: #1D2B27; border: 1px solid #DCE6E2;
      border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.18);
      font-family: system-ui, sans-serif; font-size: ${Math.round(14 * fontScale)}px; line-height: 1.5;
      padding: 14px 16px;
    `;
    document.documentElement.appendChild(panel);
    return panel;
  }

  function renderLoading() {
    const p = ensurePanel();
    p.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>NeuroBridge</strong><span id="nb-close" style="cursor:pointer;">✕</span>
      </div>
      <div style="color:#5C6D67;">Thinking…</div>`;
    document.getElementById("nb-close").onclick = () => panel.remove() || (panel = null);
  }

  function renderResult(kind, result, style) {
    const p = ensurePanel();
    let body;
    if (result.error === "no_key") {
      body = `<div>No Gemini API key saved yet. Click the NeuroBridge toolbar icon and paste your key there.</div>`;
    } else if (result.error) {
      body = `<div>Something went wrong (${result.error}). Try again.</div>`;
    } else if (kind === "nb-steps") {
      const lines = result.text.split("\n").map((l) => l.replace(/^\s*\d+[\.\)]\s*/, "").trim()).filter(Boolean);
      body = `<ol style="padding-left:18px;margin:0;">${lines.map((l) => `<li style="margin-bottom:6px;">${escapeHtml(l)}</li>`).join("")}</ol>`;
    } else {
      body = `<div style="white-space:pre-wrap;">${escapeHtml(result.text)}</div>`;
    }

    p.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>NeuroBridge</strong><span id="nb-close" style="cursor:pointer;">✕</span>
      </div>
      ${body}
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        <button id="nb-read" style="${BTN}">🔊 Read aloud</button>
        ${result.error ? "" : `<button id="nb-up" style="${BTN}" title="This helped">👍</button>
        <button id="nb-down" style="${BTN}" title="This didn't help">👎</button>
        <button id="nb-save" style="${BTN}">💾 Save</button>`}
        <span id="nb-thanks" style="font-size:12px;color:#5C6D67;"></span>
      </div>`;

    document.getElementById("nb-close").onclick = () => { panel.remove(); panel = null; };
    const thanks = (t) => { const el = document.getElementById("nb-thanks"); if (el) el.textContent = t; };
    const vote = (ok) => {
      chrome.runtime.sendMessage({ type: "NB_FEEDBACK", style, ok });
      thanks(ok ? "Thanks, noted." : "Noted. You can change your style in the dashboard.");
    };
    const up = document.getElementById("nb-up");
    if (up) {
      up.onclick = () => vote(true);
      document.getElementById("nb-down").onclick = () => vote(false);
      document.getElementById("nb-save").onclick = () => {
        chrome.runtime.sendMessage({ type: "NB_SAVE", kind, text: result.text });
        thanks("Saved to your dashboard.");
      };
    }
    document.getElementById("nb-read").onclick = () => {
      try {
        const utter = new SpeechSynthesisUtterance(p.innerText);
        speechSynthesis.cancel();
        speechSynthesis.speak(utter);
      } catch (e) {}
    };
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "NB_LOADING") renderLoading();
    if (msg.type === "NB_RESULT") renderResult(msg.kind, msg.result, msg.style);
  });
})();
