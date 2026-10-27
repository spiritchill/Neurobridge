

# NeuroBridge — In-Page Assistant

A lightweight browser extension that makes reading and communicating easier. Select any text on any web page and get a simpler version or a step-by-step breakdown, right where you're reading. Powered by Google Gemini using your own API key.

Features
Simplify text

Select text on any page, right-click, and choose Simplify this text. The extension rewrites it in short, clear sentences with everyday words, keeping the full meaning. The result appears in a small floating panel on the page.

Break it into steps

Select text, right-click, and choose Break this into steps. You get a numbered list of five small, concrete steps in plain language, which is useful for instructions, forms, or dense paragraphs.

Read aloud

Every result has a Read aloud button that uses your browser's built-in text-to-speech.

Speech check

Rehearse something before you say it to someone. Speak it or type it, and get:

words per minute (spoken mode)
a filler-word count (um, uh, like, basically, and so on)
short, encouraging tips on clarity and wording

Your last 20 attempts are saved locally so you can look back at them. Voice input works in browsers that support the Web Speech API (such as Chrome). In Firefox, use the typed mode.

Calm and focus sound

Play white noise, deep brown noise, or a low steady tone with an adjustable volume. The sound is generated in the browser, with no audio files.

Setup
Get a free Gemini API key from Google AI Studio.
Install the extension.
Click the toolbar icon, paste your key, and press Save.
Select text on any page and right-click.
Install from source

Clone or download this repository first.

Chrome (and Edge, Brave)
Open chrome://extensions (or edge://extensions).
Turn on Developer mode (top right).
Click Load unpacked and select the extension folder, the one that contains manifest.json.
Pin the extension from the puzzle-piece menu, then add your API key.
Firefox
Open about:debugging and go to This Firefox.
Click Load Temporary Add-on and select manifest.json.

Chrome and Firefox builds differ slightly. Chrome needs "background": {"service_worker": "background.js"} and plays the calm sound through an offscreen document (offscreen.html and offscreen.js, with the offscreen permission). Firefox needs "background": {"scripts": ["background.js"]}, has no offscreen API, and plays the sound directly from background.js. It also needs the browser_specific_settings block with an add-on ID. Keep a separate manifest and background script for each browser.

Publishing
Chrome Web Store
Zip the extension files so manifest.json is at the top level of the zip, not inside a subfolder.
Sign in to the Chrome Web Store Developer Dashboard with a Google account. First-time developers pay a one-time registration fee (currently $5).
Click Add new item and upload the zip.
Fill in the store listing: description, at least one screenshot (1280x800 or 640x400), an icon, and a category.
On the Privacy tab, explain why each permission is needed, declare that selected text is sent to the Gemini API, and link a privacy policy.
Click Submit for review. Review can take a few days, and broad permissions like <all_urls> may take longer.
Firefox Add-ons (addons.mozilla.org)
Zip the Firefox build with manifest.json at the top level.
Sign in at addons.mozilla.org and choose Submit a New Add-on.
Select On this site for a public listing, upload the zip, and fix any validator errors.
Complete the listing and submit for review.
Privacy
Your API key is stored only in your browser's local extension storage and is sent only to Google's Gemini API.
Text you select is sent to the Gemini API only when you choose Simplify or Break into steps, or run a speech check. Nothing is sent in the background.
Speech-check history is stored locally on your device.
There are no analytics, trackers, or third-party servers.
Permissions
Permission	Why it's needed
contextMenus	Adds the right-click options
storage	Saves your API key, sound settings, and speech history locally
activeTab, scripting	Shows the result panel on the current page
generativelanguage.googleapis.com	Calls the Gemini API
<all_urls>	Lets the result panel appear on any page you select text on
Tech

Manifest V3, plain JavaScript, no build step and no dependencies.

License
