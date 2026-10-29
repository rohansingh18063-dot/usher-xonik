/*
 * Website chat widget.
 *
 *   <script src="https://usher.xonik.com/widget.js" data-key="pk_live_..." async></script>
 *
 * Loads the client's widget settings (only on their allowed domains), then
 * shows a chat button. Everything renders inside a Shadow DOM, so the
 * website's CSS and the widget's CSS never affect each other. The session ID
 * and messages are kept in the browser, so the conversation continues on
 * every page of the website.
 *
 * With data-preview instead of data-key, the widget takes its settings from
 * the parent window (the dashboard's live preview) and sends nothing.
 */
(() => {
  "use strict";

  if (window.__chatWidgetLoaded) return;
  window.__chatWidgetLoaded = true;

  const script =
    document.currentScript ||
    document.querySelector('script[src*="widget.js"][data-key], script[src*="widget.js"][data-preview]');
  if (!script) return;

  const PREVIEW = script.hasAttribute("data-preview");
  const KEY = (script.getAttribute("data-key") || "").trim();
  const API = new URL(script.src, location.href).origin;
  const CONFIG_URL = `${API}/api/public/widget?key=${encodeURIComponent(KEY)}`;
  const CHAT_URL = `${API}/api/public/chat?key=${encodeURIComponent(KEY)}`;
  const LEADS_URL = `${API}/api/public/leads?key=${encodeURIComponent(KEY)}`;
  const STORE = `chat-widget:${KEY}`;
  const OPEN_STORE = `chat-widget-open:${KEY}`;
  const MAX_LENGTH = 1000;
  const MAX_STORED = 60;
  const IDLE_LIMIT = 24 * 60 * 60 * 1000;
  const DEFAULT_COLOR = "#2952e3";

  const TEXT = {
    open: "Open chat",
    close: "Close chat",
    restart: "Start a new conversation",
    send: "Send message",
    input: "Your message",
    placeholder: "Type your message…",
    log: "Conversation",
    quick: "Suggested questions",
    you: "You: ",
    typing: "Typing",
    preview: "This is a preview. On your website, your assistant's reply appears here.",
    paused: "This assistant is not available right now. Please contact the business directly.",
    network: "We couldn't reach the assistant. Please check your internet connection and try again.",
    unavailable: "The assistant is unavailable right now. Please try again in a moment.",
    notAllowed: "This chat isn't available on this website right now. Please contact the business directly.",
    offer: "Request an appointment",
    formTitle: "Request an appointment",
    formIntro: (business) => `Leave your details and ${business} will call you to confirm a time.`,
    back: "Back to chat",
    name: "Your name",
    mobile: "Mobile number",
    mobileHint: "10-digit mobile number, or your country code and number (for example +44 7700 900123).",
    date: "Preferred date",
    time: "Preferred time",
    times: { morning: "Morning", afternoon: "Afternoon", evening: "Evening" },
    concern: "Treatment or concern (optional)",
    consent: "I agree that the clinic may contact me",
    submit: "Send request",
    sending: "Sending…",
    nameError: "Enter your name.",
    mobileError: "Enter a valid mobile number: 10 digits, or your country code and number.",
    dateError: "Choose a date from today onwards.",
    timeError: "Choose a preferred time.",
    consentError: "Please agree that the clinic may contact you.",
    sent: (lead, business) =>
      `Thank you, ${lead.name}. Your request has been sent to ${business}. They will call you on ${lead.mobile} to confirm a time. Your appointment is not booked until they confirm it.`,
    previewSent: "This is a preview. On your website, the request goes to the clinic here.",
  };

  // Used when a response carries no message of its own.
  const ERRORS = {
    assistant_paused: TEXT.paused,
    monthly_limit_reached:
      "This assistant has reached its message limit for this month. Please contact the business directly.",
    ip_rate_limited: "You're sending messages a little too fast. Please slow down and try again in a minute.",
    key_rate_limited: "The assistant is very busy right now. Please try again in a minute.",
    origin_not_allowed: TEXT.notAllowed,
    session_limit: "This conversation has reached its limit. Please start a new conversation.",
  };

  const ICONS = {
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.4 3.7A.6.6 0 0 1 5.6 19v-3H6.5A2.5 2.5 0 0 1 4 13.5v-8Z"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87z"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>',
    restart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg>',
  };

  const CSS = `
    :host { all: initial !important; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    [hidden] { display: none !important; }
    .root {
      position: fixed; z-index: 2147483647; bottom: 20px; right: 20px;
      font: 400 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0f172a; text-align: left; letter-spacing: normal; text-transform: none; word-spacing: normal;
      -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%;
    }
    .root.left { right: auto; left: 20px; }
    button, textarea { font: inherit; color: inherit; letter-spacing: inherit; text-transform: none; }
    button { cursor: pointer; border: 0; background: none; -webkit-tap-highlight-color: transparent; }
    svg { display: block; width: 100%; height: 100%; }
    :focus { outline: none; }
    :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }

    .launcher {
      display: flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 50%;
      background: var(--brand); color: var(--on-brand); box-shadow: 0 6px 20px rgba(15, 23, 42, .25);
      transition: transform .15s ease;
    }
    .launcher:hover { transform: scale(1.05); }
    .launcher span { width: 28px; height: 28px; }
    .launcher .icon-close { width: 22px; height: 22px; }
    .open .launcher .icon-chat, .launcher .icon-close { display: none; }
    .open .launcher .icon-close { display: block; }

    .panel {
      position: absolute; bottom: 76px; right: 0; display: flex; flex-direction: column;
      width: 380px; height: min(640px, calc(100vh - 120px)); min-height: 360px; overflow: hidden;
      background: #fff; border-radius: 16px; box-shadow: 0 12px 48px rgba(15, 23, 42, .28);
    }
    .left .panel { right: auto; left: 0; }

    .header {
      display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 14px;
      background: var(--brand); color: var(--on-brand);
    }
    .avatar {
      display: flex; flex: none; align-items: center; justify-content: center; width: 40px; height: 40px;
      overflow: hidden; border-radius: 50%; background: #fff; color: var(--brand-text);
      font-weight: 700; font-size: 17px; line-height: 1;
    }
    .avatar img { display: block; width: 100%; height: 100%; object-fit: contain; padding: 3px; }
    .title { flex: 1; min-width: 0; overflow: hidden; font-size: 16px; font-weight: 600; line-height: 1.3; white-space: nowrap; text-overflow: ellipsis; }
    .icon {
      display: flex; flex: none; align-items: center; justify-content: center; width: 38px; height: 38px;
      padding: 9px; border-radius: 10px;
    }
    .icon:hover { background: rgba(127, 127, 127, .22); }
    .header :focus-visible { outline-color: var(--on-brand); outline-offset: 0; }

    .messages {
      display: flex; flex: 1; flex-direction: column; gap: 10px; overflow-y: auto; overscroll-behavior: contain;
      padding: 16px; background: #f8fafc;
    }
    .messages:focus-visible { outline-offset: -3px; }
    .bubble {
      max-width: 85%; padding: 9px 13px; border-radius: 16px; font-size: 15px; line-height: 1.45;
      white-space: pre-wrap; overflow-wrap: anywhere;
    }
    .assistant { align-self: flex-start; background: #fff; border: 1px solid #e2e8f0; border-bottom-left-radius: 4px; color: #0f172a; }
    .visitor { align-self: flex-end; background: var(--brand); color: var(--on-brand); border-bottom-right-radius: 4px; }
    .failed { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
    .bubble .action {
      display: inline-block; margin-top: 8px; padding: 6px 12px; border-radius: 999px;
      background: #fff; border: 1px solid #fca5a5; color: #991b1b; font-size: 14px; white-space: normal;
    }
    .typing { display: inline-flex; gap: 4px; padding: 6px 0; }
    .typing i { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; animation: blink 1.2s infinite ease-in-out both; }
    .typing i:nth-child(2) { animation-delay: .15s; }
    .typing i:nth-child(3) { animation-delay: .3s; }
    @keyframes blink { 0%, 80%, 100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }

    .quick { display: flex; flex-wrap: wrap; gap: 8px; padding: 2px 16px 14px; background: #f8fafc; }
    .quick button {
      padding: 7px 13px; border-radius: 999px; background: #fff; border: 1.5px solid var(--brand);
      color: #0f172a; font-size: 14px; line-height: 1.3; text-align: left;
    }
    .quick button:hover { background: var(--brand); color: var(--on-brand); }

    .composer { display: flex; align-items: flex-end; gap: 8px; padding: 10px; border-top: 1px solid #e2e8f0; background: #fff; }
    .composer textarea {
      flex: 1; min-width: 0; min-height: 44px; max-height: 120px; resize: none; padding: 10px 12px;
      border: 1px solid #cbd5e1; border-radius: 12px; background: #fff; color: #0f172a;
      font-size: 16px; line-height: 1.4;
    }
    .composer textarea::placeholder { color: #64748b; opacity: 1; }
    .composer textarea:focus { border-color: var(--focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 25%, transparent); }
    .composer textarea:focus-visible { outline: none; }
    .composer textarea:disabled { background: #f1f5f9; cursor: not-allowed; }
    .send {
      display: flex; flex: none; align-items: center; justify-content: center; width: 44px; height: 44px;
      padding: 11px; border-radius: 12px; background: var(--brand); color: var(--on-brand);
    }
    .send:disabled { opacity: .5; cursor: not-allowed; }

    .bubble .offer {
      display: inline-block; margin-top: 10px; padding: 8px 14px; border-radius: 999px;
      background: var(--brand); color: var(--on-brand); font-size: 14px; font-weight: 600; white-space: normal;
    }

    .lead { display: flex; flex: 1; flex-direction: column; min-height: 0; background: #fff; }
    .lead-top { display: flex; align-items: center; gap: 6px; padding: 8px 12px 8px 6px; border-bottom: 1px solid #e2e8f0; }
    .lead-top .icon { color: #334155; }
    .lead-top h3 { font-size: 16px; font-weight: 600; color: #0f172a; }
    .lead-body { display: flex; flex: 1; flex-direction: column; gap: 14px; overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px 16px; }
    .lead-intro { color: #475569; font-size: 14px; }
    .field { display: flex; flex-direction: column; gap: 5px; border: 0; min-width: 0; }
    .field > label, .field legend { font-size: 14px; font-weight: 600; color: #0f172a; }
    .field legend { margin-bottom: 5px; }
    .lead input[type="text"], .lead input[type="tel"], .lead input[type="date"], .lead textarea {
      width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 10px;
      background: #fff; color: #0f172a; font-size: 16px; line-height: 1.3;
    }
    .lead textarea { resize: vertical; min-height: 64px; }
    .lead input:focus, .lead textarea:focus { border-color: var(--focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 25%, transparent); }
    .lead input:focus-visible, .lead textarea:focus-visible { outline: none; }
    .lead [aria-invalid="true"] { border-color: #dc2626; }
    .hint { color: #64748b; font-size: 13px; }
    .error { color: #b91c1c; font-size: 13px; }
    .times { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .times label {
      display: flex; align-items: center; justify-content: center; min-height: 44px; padding: 8px; border: 1px solid #cbd5e1;
      border-radius: 10px; font-size: 14px; cursor: pointer; text-align: center;
    }
    .times label:has(input:checked) { border-color: var(--brand); background: var(--brand); color: var(--on-brand); font-weight: 600; }
    .times label:has(input:focus-visible) { outline: 3px solid var(--focus); outline-offset: 2px; }
    .times[aria-invalid="true"] label { border-color: #dc2626; }
    .consent label { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; font-weight: 400; color: #0f172a; cursor: pointer; }
    .consent input { flex: none; width: 20px; height: 20px; margin-top: 1px; accent-color: var(--brand); }
    .form-error { padding: 10px 12px; border-radius: 10px; background: #fef2f2; color: #991b1b; font-size: 14px; }
    .lead-foot { padding: 12px 16px; border-top: 1px solid #e2e8f0; }
    .lead-foot button {
      width: 100%; min-height: 46px; border-radius: 12px; background: var(--brand); color: var(--on-brand);
      font-size: 16px; font-weight: 600;
    }
    .lead-foot button:disabled { opacity: .6; cursor: progress; }

    @media (max-width: 480px) {
      .root { bottom: 16px; right: 16px; }
      .root.left { left: 16px; }
      .panel { position: fixed; inset: 0; width: 100%; height: 100%; min-height: 0; border-radius: 0; }
      .open .launcher { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .launcher { transition: none; }
      .typing i { animation: none; opacity: .7; }
    }
  `;

  let config = null;
  let state = loadState();
  let busy = false;
  let el = null;
  let pageOverflow = null;
  const smallScreen = window.matchMedia("(max-width: 480px)");

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  function start() {
    if (PREVIEW) return startPreview();
    if (!/^pk_live_[A-Za-z0-9_-]{32}$/.test(KEY)) {
      return warn("add your public key to the script tag, for example data-key=\"pk_live_...\".");
    }

    fetch(CONFIG_URL, { credentials: "omit" })
      .then((response) =>
        response.json().then(
          (body) => (response.ok ? body : Promise.reject(new Error(body?.error?.message || TEXT.unavailable))),
          () => Promise.reject(new Error(TEXT.unavailable)),
        ),
      )
      .then((settings) => {
        mount();
        applyConfig(settings);
        if (read("sessionStorage", OPEN_STORE) === "1") setOpen(true, false);
      })
      .catch((error) => {
        warn(
          error instanceof TypeError
            ? "it could not load. Check that this website's domain is on the allowed domains for your key."
            : error.message,
        );
      });
  }

  function startPreview() {
    // window.origin, not location.origin: in the dashboard's srcdoc frame the
    // location is about:srcdoc, while the document has the dashboard's origin.
    const origin = window.origin;
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent || event.origin !== origin) return;
      if (event.data?.type !== "chat-widget-preview") return;
      const first = !el;
      if (first) mount();
      applyConfig(event.data.config);
      if (first) setOpen(true, false);
    });
    window.parent.postMessage({ type: "chat-widget-ready" }, origin);
  }

  function warn(message) {
    console.warn(`Chat widget: ${message}`);
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  function applyConfig(raw) {
    const color = /^#[0-9a-f]{6}$/i.test(raw?.brandColor) ? raw.brandColor : DEFAULT_COLOR;
    config = {
      assistantName: String(raw?.assistantName || "Chat").slice(0, 60),
      logoUrl: /^https?:\/\//.test(raw?.logoUrl) ? raw.logoUrl : null,
      brandColor: color,
      position: raw?.position === "left" ? "left" : "right",
      welcomeMessage: String(raw?.welcomeMessage || "Hi! How can I help you today?").slice(0, 500),
      quickReplies: Array.isArray(raw?.quickReplies)
        ? raw.quickReplies
            .map((reply) => (typeof reply === "string" ? { text: reply, action: "message" } : reply))
            .filter((reply) => typeof reply?.text === "string" && reply.text.trim())
            .map((reply) => ({ text: reply.text, action: reply.action === "appointment_form" ? "appointment_form" : "message" }))
            .slice(0, 6)
        : [],
      businessName: String(raw?.businessName || raw?.assistantName || "the clinic").slice(0, 120),
      available: raw?.available !== false,
    };

    const onBrand = contrast(color, "#ffffff") >= contrast(color, "#0f172a") ? "#ffffff" : "#0f172a";
    const style = el.root.style;
    style.setProperty("--brand", color);
    style.setProperty("--on-brand", onBrand);
    // Brand color where it is readable on white, dark slate otherwise.
    style.setProperty("--brand-text", contrast(color, "#ffffff") >= 3 ? color : "#0f172a");
    style.setProperty("--focus", contrast(color, "#ffffff") >= 3 ? color : "#0f172a");
    el.root.classList.toggle("left", config.position === "left");

    el.title.textContent = config.assistantName;
    el.initial.textContent = config.assistantName.trim().charAt(0).toUpperCase();
    if (config.logoUrl) {
      if (el.logo.getAttribute("src") !== config.logoUrl) el.logo.src = config.logoUrl;
      el.logo.hidden = false;
      el.initial.hidden = true;
    } else {
      el.logo.hidden = true;
      el.logo.removeAttribute("src");
      el.initial.hidden = false;
    }

    el.input.disabled = !config.available;
    el.input.placeholder = config.available ? TEXT.placeholder : "";
    updateSendButton();
    renderMessages();
  }

  function contrast(a, b) {
    const [la, lb] = [luminance(a), luminance(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function luminance(hex) {
    const value = parseInt(hex.slice(1), 16);
    const [r, g, b] = [value >> 16, (value >> 8) & 255, value & 255].map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // ---------------------------------------------------------------------------
  // Building the widget
  // ---------------------------------------------------------------------------

  function mount() {
    const host = document.createElement("chat-widget-root");
    host.setAttribute("style", "all: initial !important;");
    const shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <style>${CSS}</style>
      <div class="root">
        <section class="panel" id="panel" role="dialog" aria-labelledby="title" hidden>
          <div class="header">
            <span class="avatar" aria-hidden="true"><img class="logo" alt="" hidden><span class="initial"></span></span>
            <h2 class="title" id="title"></h2>
            <button type="button" class="icon restart" aria-label="${TEXT.restart}" title="${TEXT.restart}">${ICONS.restart}</button>
            <button type="button" class="icon close" aria-label="${TEXT.close}" title="${TEXT.close}">${ICONS.close}</button>
          </div>
          <div class="messages" role="log" aria-label="${TEXT.log}" tabindex="0"></div>
          <div class="quick" role="group" aria-label="${TEXT.quick}"></div>
          <form class="composer" novalidate>
            <label class="sr-only" for="input">${TEXT.input}</label>
            <textarea id="input" rows="1" maxlength="${MAX_LENGTH}" autocomplete="off"></textarea>
            <button type="submit" class="send" aria-label="${TEXT.send}">${ICONS.send}</button>
          </form>
          <form class="lead" novalidate hidden aria-labelledby="lead-title">
            <div class="lead-top">
              <button type="button" class="icon back" aria-label="${TEXT.back}" title="${TEXT.back}">${ICONS.back}</button>
              <h3 id="lead-title">${TEXT.formTitle}</h3>
            </div>
            <div class="lead-body">
              <p class="lead-intro"></p>
              <div class="field">
                <label for="lead-name">${TEXT.name}</label>
                <input type="text" id="lead-name" name="name" autocomplete="name" maxlength="80" aria-describedby="lead-name-error">
                <p class="error" id="lead-name-error" hidden></p>
              </div>
              <div class="field">
                <label for="lead-mobile">${TEXT.mobile}</label>
                <input type="tel" id="lead-mobile" name="mobile" autocomplete="tel" inputmode="tel" maxlength="20" aria-describedby="lead-mobile-hint lead-mobile-error">
                <p class="hint" id="lead-mobile-hint">${TEXT.mobileHint}</p>
                <p class="error" id="lead-mobile-error" hidden></p>
              </div>
              <div class="field">
                <label for="lead-date">${TEXT.date}</label>
                <input type="date" id="lead-date" name="date" aria-describedby="lead-date-error">
                <p class="error" id="lead-date-error" hidden></p>
              </div>
              <fieldset class="field">
                <legend>${TEXT.time}</legend>
                <div class="times" id="lead-time" role="radiogroup" aria-describedby="lead-time-error">
                  ${["morning", "afternoon", "evening"]
                    .map((time) => `<label><input class="sr-only" type="radio" name="time" value="${time}">${TEXT.times[time]}</label>`)
                    .join("")}
                </div>
                <p class="error" id="lead-time-error" hidden></p>
              </fieldset>
              <div class="field">
                <label for="lead-concern">${TEXT.concern}</label>
                <textarea id="lead-concern" name="concern" maxlength="500" rows="2"></textarea>
              </div>
              <div class="field consent">
                <label><input type="checkbox" id="lead-consent" name="consent" aria-describedby="lead-consent-error">${TEXT.consent}</label>
                <p class="error" id="lead-consent-error" hidden></p>
              </div>
              <p class="form-error" role="alert" hidden></p>
            </div>
            <div class="lead-foot"><button type="submit" class="lead-submit">${TEXT.submit}</button></div>
          </form>
        </section>
        <button type="button" class="launcher" aria-label="${TEXT.open}" aria-expanded="false" aria-controls="panel">
          <span class="icon-chat">${ICONS.chat}</span><span class="icon-close">${ICONS.close}</span>
        </button>
      </div>`;

    const $ = (selector) => shadow.querySelector(selector);
    el = {
      shadow,
      root: $(".root"),
      panel: $(".panel"),
      launcher: $(".launcher"),
      title: $(".title"),
      logo: $(".logo"),
      initial: $(".initial"),
      restart: $(".restart"),
      close: $(".close"),
      log: $(".messages"),
      quick: $(".quick"),
      form: $(".composer"),
      input: $("#input"),
      send: $(".send"),
      lead: $(".lead"),
      leadIntro: $(".lead-intro"),
      leadSubmit: $(".lead-submit"),
      leadError: $(".form-error"),
    };

    el.logo.addEventListener("error", () => {
      el.logo.hidden = true;
      el.initial.hidden = false;
    });
    el.launcher.addEventListener("click", () => setOpen(el.panel.hidden));
    el.close.addEventListener("click", () => setOpen(false));
    el.restart.addEventListener("click", restart);
    el.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !el.panel.hidden) {
        event.stopPropagation();
        if (!el.lead.hidden) closeLeadForm();
        else setOpen(false);
      }
    });
    shadow.querySelector(".back").addEventListener("click", closeLeadForm);
    el.lead.addEventListener("submit", (event) => {
      event.preventDefault();
      submitLead();
    });
    el.form.addEventListener("submit", (event) => {
      event.preventDefault();
      send(el.input.value);
    });
    el.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        send(el.input.value);
      }
    });
    el.input.addEventListener("input", () => {
      autoGrow();
      updateSendButton();
    });
    smallScreen.addEventListener?.("change", () => lockPageScroll(!el.panel.hidden && smallScreen.matches));

    document.body.appendChild(host);
  }

  function setOpen(open, moveFocus = true) {
    el.panel.hidden = !open;
    el.root.classList.toggle("open", open);
    el.launcher.setAttribute("aria-expanded", String(open));
    el.launcher.setAttribute("aria-label", open ? TEXT.close : TEXT.open);
    if (!PREVIEW) write("sessionStorage", OPEN_STORE, open ? "1" : null);
    lockPageScroll(open && smallScreen.matches);

    if (open) {
      scrollToEnd();
      if (moveFocus) (!el.lead.hidden ? field("name") : config.available ? el.input : el.close).focus();
    } else if (moveFocus) {
      el.launcher.focus();
    }
  }

  // On small screens the chat covers the page, so the page behind it should not scroll.
  function lockPageScroll(lock) {
    const html = document.documentElement;
    if (lock && pageOverflow === null) {
      pageOverflow = html.style.overflow;
      html.style.overflow = "hidden";
    } else if (!lock && pageOverflow !== null) {
      html.style.overflow = pageOverflow;
      pageOverflow = null;
    }
  }

  function bubble(role, text, failed, offer) {
    const node = document.createElement("div");
    node.className = `bubble ${role}${failed ? " failed" : ""}`;
    const label = document.createElement("span");
    label.className = "sr-only";
    label.textContent = role === "visitor" ? TEXT.you : `${config.assistantName}: `;
    const body = document.createElement("span");
    body.className = "text";
    body.textContent = text;
    node.append(label, body);
    if (offer && config.available) node.append(offerButton());
    return node;
  }

  /** Shown under a reply when the visitor asked for an appointment or a callback. */
  function offerButton() {
    const line = document.createElement("div");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "offer";
    button.textContent = TEXT.offer;
    button.addEventListener("click", openLeadForm);
    line.append(button);
    return line;
  }

  function renderMessages() {
    el.log.textContent = "";
    el.log.append(bubble("assistant", config.welcomeMessage));
    if (!config.available) el.log.append(bubble("assistant", TEXT.paused, true));
    for (const message of state.messages) el.log.append(bubble(message.role, message.text, message.failed, message.offer));
    renderQuickReplies();
    scrollToEnd();
  }

  function renderQuickReplies() {
    el.quick.textContent = "";
    const show =
      config.available && config.quickReplies.length > 0 && !state.messages.some((m) => m.role === "visitor");
    el.quick.hidden = !show || !el.lead.hidden;
    if (!show) return;
    for (const reply of config.quickReplies) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = reply.text;
      button.addEventListener("click", () => (reply.action === "appointment_form" ? openLeadForm() : send(reply.text)));
      el.quick.append(button);
    }
  }

  function scrollToEnd() {
    el.log.scrollTop = el.log.scrollHeight;
  }

  function autoGrow() {
    el.input.style.height = "auto";
    el.input.style.height = `${Math.min(el.input.scrollHeight + 2, 120)}px`;
  }

  function updateSendButton() {
    el.send.disabled = busy || !config.available || !el.input.value.trim();
  }

  // ---------------------------------------------------------------------------
  // Conversation
  // ---------------------------------------------------------------------------

  async function send(text) {
    const message = String(text || "").trim().slice(0, MAX_LENGTH);
    if (!message || busy || !config.available) return;
    const hadFocus = el.shadow.activeElement === el.input;

    busy = true;
    state.messages.push({ role: "visitor", text: message });
    el.log.append(bubble("visitor", message));
    el.input.value = "";
    autoGrow();
    updateSendButton();
    renderQuickReplies();
    saveState();

    const reply = bubble("assistant", "");
    const typing = document.createElement("span");
    typing.className = "typing";
    typing.setAttribute("role", "status");
    typing.innerHTML = `<i></i><i></i><i></i><span class="sr-only">${TEXT.typing}</span>`;
    reply.append(typing);
    el.log.append(reply);
    el.log.setAttribute("aria-busy", "true");
    scrollToEnd();

    let answer = "";
    let failure = null;
    let offer = false;
    const show = (value) => {
      answer = value;
      typing.remove();
      reply.querySelector(".text").textContent = value;
      scrollToEnd();
    };

    if (PREVIEW) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      show(TEXT.preview);
    } else {
      try {
        const response = await fetch(CHAT_URL, {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: state.sessionId, message, pageUrl: location.href.slice(0, 2000) }),
        });
        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => null);
          failure = { code: body?.error?.code, message: body?.error?.message || ERRORS[body?.error?.code] || TEXT.unavailable };
        } else {
          failure = await readStream(response.body, show, () => show(""), () => (offer = true));
        }
      } catch {
        failure = { code: "network", message: await connectionProblem() };
      }
    }

    reply.remove();
    if (answer.trim()) {
      state.messages.push({ role: "assistant", text: answer.trim(), ...(offer && !failure ? { offer: true } : {}) });
      el.log.append(bubble("assistant", answer.trim(), false, offer && !failure));
    } else if (!failure) {
      failure = { message: TEXT.unavailable };
    }
    if (failure) {
      state.messages.push({ role: "assistant", text: failure.message, failed: true });
      const node = bubble("assistant", failure.message, true);
      if (failure.code === "session_limit") node.append(restartButton());
      el.log.append(node);
    }

    el.log.removeAttribute("aria-busy");
    busy = false;
    updateSendButton();
    saveState();
    scrollToEnd();
    if (hadFocus) el.input.focus();
  }

  /** Reads newline-delimited JSON events; returns a failure, if any. */
  async function readStream(stream, show, reset, onOffer) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let failure = null;
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === "text") show((text += event.text));
        else if (event.type === "reset") reset((text = ""));
        else if (event.type === "error") failure = { message: event.message || TEXT.unavailable };
        else if (event.type === "action" && event.action === "appointment_form") onOffer();
      }
      if (done) return failure;
    }
  }

  /**
   * The browser hides why a request failed. If the visitor is online and the
   * settings cannot be read either, this website is most likely no longer
   * allowed to use the assistant.
   */
  async function connectionProblem() {
    if (navigator.onLine === false) return TEXT.network;
    try {
      const response = await fetch(CONFIG_URL, { credentials: "omit" });
      return response.ok ? TEXT.network : TEXT.unavailable;
    } catch {
      return TEXT.notAllowed;
    }
  }

  function restartButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action";
    button.textContent = TEXT.restart;
    button.addEventListener("click", restart);
    const line = document.createElement("div");
    line.append(button);
    return line;
  }

  function restart() {
    if (busy || submitting) return;
    if (!el.lead.hidden) {
      el.lead.reset();
      el.lead.hidden = true;
      el.log.hidden = el.form.hidden = false;
    }
    state = freshState();
    saveState();
    renderMessages();
    (config.available ? el.input : el.close).focus();
  }

  // ---------------------------------------------------------------------------
  // Appointment request form
  // ---------------------------------------------------------------------------

  const FIELDS = ["name", "mobile", "date", "time", "consent"];
  const SERVER_FIELDS = { preferredDate: "date", preferredTime: "time" };
  let submitting = false;

  const field = (name) => el.lead.elements[name];

  function openLeadForm() {
    if (!config.available || !el.lead.hidden) return;
    const latest = new Date();
    latest.setDate(latest.getDate() + 180);
    field("date").min = localDate(new Date());
    field("date").max = localDate(latest);
    el.leadIntro.textContent = TEXT.formIntro(config.businessName);
    clearLeadErrors();
    el.log.hidden = el.quick.hidden = el.form.hidden = true;
    el.lead.hidden = false;
    field("name").focus();
  }

  function closeLeadForm() {
    el.lead.hidden = true;
    el.log.hidden = el.form.hidden = false;
    renderQuickReplies();
    scrollToEnd();
    (config.available ? el.input : el.close).focus();
  }

  function clearLeadErrors() {
    for (const name of FIELDS) {
      el.shadow.getElementById(`lead-${name}-error`).hidden = true;
      fieldTarget(name).removeAttribute("aria-invalid");
    }
    el.leadError.hidden = true;
  }

  function fieldTarget(name) {
    return name === "time" ? el.shadow.getElementById("lead-time") : field(name);
  }

  function showFieldError(name, message) {
    const error = el.shadow.getElementById(`lead-${name}-error`);
    error.textContent = message;
    error.hidden = false;
    fieldTarget(name).setAttribute("aria-invalid", "true");
  }

  function focusField(name) {
    (name === "time" ? el.lead.querySelector('input[name="time"]') : field(name)).focus();
  }

  function showFormError(message) {
    el.leadError.textContent = message;
    el.leadError.hidden = false;
  }

  /** Checks the form like the server does; the server has the final say. */
  function readLead() {
    const lead = {
      name: field("name").value.trim(),
      mobile: field("mobile").value.trim(),
      preferredDate: field("date").value,
      preferredTime: field("time").value,
      concern: field("concern").value.trim(),
      consent: field("consent").checked,
    };
    const errors = {};
    if (lead.name.length < 2) errors.name = TEXT.nameError;
    if (!normalizeMobile(lead.mobile)) errors.mobile = TEXT.mobileError;
    const date = field("date");
    if (!lead.preferredDate || lead.preferredDate < date.min || lead.preferredDate > date.max) errors.date = TEXT.dateError;
    if (!lead.preferredTime) errors.time = TEXT.timeError;
    if (!lead.consent) errors.consent = TEXT.consentError;
    return { lead, errors };
  }

  async function submitLead() {
    if (submitting) return;
    clearLeadErrors();
    const { lead, errors } = readLead();
    const invalid = FIELDS.filter((name) => errors[name]);
    if (invalid.length) {
      for (const name of invalid) showFieldError(name, errors[name]);
      focusField(invalid[0]);
      return;
    }

    submitting = true;
    el.leadSubmit.disabled = true;
    el.leadSubmit.textContent = TEXT.sending;
    try {
      let confirmation;
      if (PREVIEW) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        confirmation = TEXT.previewSent;
      } else {
        let response;
        try {
          response = await fetch(LEADS_URL, {
            method: "POST",
            credentials: "omit",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...lead, sessionId: state.sessionId, pageUrl: location.href.slice(0, 2000) }),
          });
        } catch {
          showFormError(await connectionProblem());
          return;
        }
        const body = await response.json().catch(() => null);
        const code = body?.error?.code;
        if (response.status === 201) {
          confirmation = TEXT.sent(body.lead, config.businessName);
        } else if (code === "duplicate_lead") {
          confirmation = body.error.message;
        } else if (code === "invalid_lead") {
          const names = Object.keys(body.error.fields || {})
            .map((key) => SERVER_FIELDS[key] || key)
            .filter((name) => FIELDS.includes(name));
          for (const [key, message] of Object.entries(body.error.fields || {})) {
            const name = SERVER_FIELDS[key] || key;
            if (FIELDS.includes(name)) showFieldError(name, message);
          }
          if (names.length) focusField(names[0]);
          else showFormError(body.error.message);
          return;
        } else {
          showFormError(body?.error?.message || ERRORS[code] || TEXT.unavailable);
          return;
        }
      }

      el.lead.reset();
      closeLeadForm();
      state.messages.push({ role: "assistant", text: confirmation });
      el.log.append(bubble("assistant", confirmation));
      saveState();
      scrollToEnd();
    } finally {
      submitting = false;
      el.leadSubmit.disabled = false;
      el.leadSubmit.textContent = TEXT.submit;
    }
  }

  /**
   * An Indian mobile number (10 digits starting with 6 to 9, optionally with
   * 0 or 91 in front), or any international number with a country code.
   */
  function normalizeMobile(input) {
    const compact = String(input).trim().replace(/[\s().-]/g, "");
    if (!/^(\+|00)?\d+$/.test(compact)) return null;
    const indian = (digits) => /^[6-9]\d{9}$/.test(digits);
    if (/^(\+|00)/.test(compact)) {
      const digits = compact.replace(/^(\+|00)/, "");
      if (digits.startsWith("91")) return indian(digits.slice(2)) ? `+${digits}` : null;
      return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
    }
    const local = compact.length === 11 && compact.startsWith("0") ? compact.slice(1) : compact;
    if (indian(local)) return `+91${local}`;
    if (local.length === 12 && local.startsWith("91") && indian(local.slice(2))) return `+${local}`;
    return null;
  }

  function localDate(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // ---------------------------------------------------------------------------
  // Browser storage (may be unavailable, for example in private browsing)
  // ---------------------------------------------------------------------------

  function freshState() {
    return { sessionId: uuid(), messages: [] };
  }

  function loadState() {
    if (PREVIEW) return freshState();
    try {
      const saved = JSON.parse(read("localStorage", STORE) || "null");
      if (
        saved &&
        /^[0-9a-f-]{36}$/.test(saved.sessionId) &&
        Array.isArray(saved.messages) &&
        Date.now() - saved.updatedAt < IDLE_LIMIT
      ) {
        const messages = saved.messages.filter(
          (m) => m && (m.role === "visitor" || m.role === "assistant") && typeof m.text === "string",
        );
        return { sessionId: saved.sessionId, messages };
      }
    } catch {
      // Unreadable: start over.
    }
    return freshState();
  }

  function saveState() {
    if (PREVIEW) return;
    const messages = state.messages.slice(-MAX_STORED);
    write("localStorage", STORE, JSON.stringify({ sessionId: state.sessionId, messages, updatedAt: Date.now() }));
  }

  function read(area, name) {
    try {
      return window[area].getItem(name);
    } catch {
      return null;
    }
  }

  function write(area, name, value) {
    try {
      if (value === null) window[area].removeItem(name);
      else window[area].setItem(name, value);
    } catch {
      // Storage full or blocked: the conversation still works on this page.
    }
  }

  /** A random version 4 UUID; works on http pages too, where crypto.randomUUID is missing. */
  function uuid() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
