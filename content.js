const STORAGE_KEY = "bookmarks";
const FINGERPRINT_LENGTH = 100;
const MAX_TITLE_LENGTH = 96;
const MAX_PREVIEW_LENGTH = 120;
const SEARCH_SCROLL_STEP = 720;
const SEARCH_DELAY_MS = 180;
const MAX_SEARCH_STEPS = 80;
const TURN_SELECTOR_CANDIDATES = [
  'article[data-testid^="conversation-turn-"]',
  '[data-testid^="conversation-turn-"]',
  "div[data-message-author-role]"
];
const UI_NOISE_PATTERNS = [
  /\bYou said\b:?\s*/gi,
  /\bChatGPT said\b:?\s*/gi,
  /show\s*more/gi,
  /show\s*less/gi,
  /\bCopy code\b/gi
];

let hydrateTimer = null;
let lastKnownUrl = normalizeChatUrl(location.href);

function normalizeText(text = "") {
  return text.replace(/\u200b/g, "").replace(/\s+/g, " ").trim();
}

function normalizeChatUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${pathname}`;
  } catch (error) {
    return url;
  }
}

function stripUiNoise(text = "") {
  let cleaned = text;
  for (const pattern of UI_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }

  cleaned = cleaned.replace(/\.{3,}/g, " ");
  return normalizeText(cleaned);
}

function sliceText(text, maxLength) {
  const cleaned = stripUiNoise(text);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return cleaned.slice(0, maxLength).trimEnd();
}

function toWholeWords(text, maxLength) {
  const cleaned = stripUiNoise(text);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  let end = maxLength;
  if (cleaned[end] && cleaned[end] !== " ") {
    const nextSpace = cleaned.indexOf(" ", end);
    const prevSpace = cleaned.lastIndexOf(" ", end);

    if (nextSpace !== -1 && nextSpace - maxLength <= 18) {
      end = nextSpace;
    } else if (prevSpace > Math.floor(maxLength * 0.6)) {
      end = prevSpace;
    }
  }

  return cleaned.slice(0, end).trim().replace(/[.,;:!?-]+$/, "").trim();
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function ensureStyles() {
  if (document.getElementById("bookmarkme-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "bookmarkme-style";
  style.textContent = `
    .bookmarkme-save-root {
      position: absolute;
      top: 10px;
      right: -74px;
      z-index: 10;
      opacity: 0;
      transform: translateY(-2px);
      transition: opacity 160ms ease, transform 160ms ease;
    }

    .bookmarkme-turn:hover .bookmarkme-save-root,
    .bookmarkme-save-root:focus-within {
      opacity: 1;
      transform: translateY(0);
    }

    .bookmarkme-save-button,
    .bookmarkme-launcher {
      border: 1px solid rgba(148, 163, 184, 0.24);
      background: rgba(15, 23, 42, 0.84);
      color: #f8fafc;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.24);
      backdrop-filter: blur(16px);
    }

    .bookmarkme-save-button {
      border-radius: 999px;
      padding: 6px 10px;
      font: 600 11px/1.1 Inter, ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      letter-spacing: 0.01em;
    }

    .bookmarkme-save-button:hover,
    .bookmarkme-launcher:hover {
      background: rgba(30, 41, 59, 0.96);
    }

    .bookmarkme-save-button[data-state="saved"] {
      background: rgba(22, 163, 74, 0.92);
      border-color: rgba(134, 239, 172, 0.5);
    }

    .bookmarkme-save-button[data-state="duplicate"] {
      background: rgba(59, 130, 246, 0.92);
      border-color: rgba(147, 197, 253, 0.5);
    }

    .bookmarkme-save-button[data-state="error"] {
      background: rgba(220, 38, 38, 0.92);
      border-color: rgba(252, 165, 165, 0.45);
    }

    .bookmarkme-launcher {
      position: fixed;
      right: 22px;
      bottom: 96px;
      z-index: 2147483647;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-width: 62px;
      height: 62px;
      padding: 0 18px;
      border-radius: 999px;
      cursor: pointer;
      transition: transform 160ms ease, background 160ms ease, box-shadow 160ms ease;
    }

    .bookmarkme-launcher:hover {
      transform: translateY(-2px) scale(1.01);
      box-shadow: 0 22px 46px rgba(15, 23, 42, 0.28);
    }

    .bookmarkme-launcher:active {
      transform: translateY(0);
    }

    .bookmarkme-launcher-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      flex: 0 0 auto;
    }

    .bookmarkme-launcher svg {
      width: 24px;
      height: 24px;
      stroke: currentColor;
    }

    .bookmarkme-launcher-label {
      font: 700 13px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }

    .bookmarkme-launcher[data-state="opening"] .bookmarkme-launcher-label {
      opacity: 0.86;
    }

    .bookmarkme-launcher[data-state="error"] {
      background: rgba(153, 27, 27, 0.92);
      border-color: rgba(252, 165, 165, 0.45);
    }

    .bookmarkme-highlight {
      animation: bookmarkme-highlight-fade 2.4s ease-out forwards;
    }

    @keyframes bookmarkme-highlight-fade {
      0% {
        background-color: rgba(250, 204, 21, 0.45);
        box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.4);
      }
      100% {
        background-color: transparent;
        box-shadow: none;
      }
    }

    @media (max-width: 1100px) {
      .bookmarkme-save-root {
        top: -8px;
        right: 0;
      }
    }

    @media (max-width: 720px) {
      .bookmarkme-launcher {
        right: 16px;
        bottom: 88px;
        min-width: 58px;
        height: 58px;
        padding: 0 16px;
      }

      .bookmarkme-launcher-label {
        font-size: 12px;
      }
    }

    @media (prefers-color-scheme: light) {
      .bookmarkme-save-button,
      .bookmarkme-launcher {
        background: rgba(255, 255, 255, 0.95);
        color: #0f172a;
        border-color: rgba(148, 163, 184, 0.3);
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.12);
      }

      .bookmarkme-save-button:hover,
      .bookmarkme-launcher:hover {
        background: rgba(248, 250, 252, 1);
      }

      .bookmarkme-launcher[data-state="error"] {
        color: #fff;
      }
    }
  `;

  document.documentElement.appendChild(style);
}

function extractMessageText(node) {
  const clone = node.cloneNode(true);
  clone
    .querySelectorAll(
      [
        "[data-bookmarkme-root]",
        "[data-bookmarkme-launcher]",
        ".bookmarkme-save-root",
        ".bookmarkme-launcher",
        "button",
        "nav",
        "svg",
        "textarea",
        "form"
      ].join(",")
    )
    .forEach((element) => element.remove());

  return stripUiNoise(clone.innerText || clone.textContent || "");
}

function getTurnNodes() {
  for (const selector of TURN_SELECTOR_CANDIDATES) {
    const nodes = Array.from(document.querySelectorAll(selector)).filter((node) => {
      const text = extractMessageText(node);
      return text.length > 0;
    });

    if (nodes.length >= 2) {
      return nodes;
    }
  }

  return [];
}

function getTurnRole(node, index, turns) {
  const directRole = node.getAttribute("data-message-author-role");
  if (directRole) {
    return directRole;
  }

  const nestedRoleNode = node.querySelector("[data-message-author-role]");
  const nestedRole = nestedRoleNode?.getAttribute("data-message-author-role");
  if (nestedRole) {
    return nestedRole;
  }

  if (turns[index - 1]?.role === "user") {
    return "assistant";
  }

  return index % 2 === 0 ? "user" : "assistant";
}

function buildTurns() {
  const rawTurns = getTurnNodes();
  const turns = rawTurns.map((node, index) => ({
    node,
    index,
    text: extractMessageText(node),
    role: null
  }));

  turns.forEach((turn, index) => {
    turn.role = getTurnRole(turn.node, index, turns);
  });

  return turns;
}

function buildPairs(turns = buildTurns()) {
  const pairs = [];
  let lastUserTurn = null;

  for (const turn of turns) {
    if (turn.role === "user") {
      lastUserTurn = turn;
      continue;
    }

    if (turn.role === "assistant") {
      pairs.push({
        assistant: turn,
        prompt: lastUserTurn
      });
    }
  }

  return pairs;
}

function setButtonState(button, label, stateName) {
  const defaultLabel = button.dataset.defaultLabel || "Save chat";
  button.textContent = label;
  button.dataset.state = stateName;

  window.clearTimeout(button._bookmarkmeTimer);
  button._bookmarkmeTimer = window.setTimeout(() => {
    button.textContent = defaultLabel;
    button.dataset.state = "";
  }, 1800);
}

function findPairForAssistantNode(node) {
  const pairs = buildPairs();
  return pairs.find((pair) => pair.assistant.node === node) || null;
}

async function readBookmarks() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
}

async function writeBookmarks(bookmarks) {
  await chrome.storage.local.set({ [STORAGE_KEY]: bookmarks });
}

function getResponseFingerprint(bookmark) {
  return stripUiNoise(bookmark.responseFingerprint || bookmark.textSnippet || "");
}

function getPromptFingerprint(bookmark) {
  return stripUiNoise(bookmark.promptFingerprint || bookmark.promptSnippet || bookmark.title || "");
}

function isDuplicateBookmark(existing, candidate) {
  return (
    normalizeChatUrl(existing.chatUrl) === candidate.chatUrl &&
    getResponseFingerprint(existing) === getResponseFingerprint(candidate) &&
    Math.abs(Number(existing.anchorIndex ?? -1) - candidate.anchorIndex) <= 1
  );
}

function getActionAnchorNode(turnNode) {
  const contentNode =
    turnNode.querySelector('[class*="prose"]') ||
    turnNode.querySelector(".markdown") ||
    turnNode.querySelector("[data-message-author-role]");

  if (contentNode?.parentElement instanceof HTMLElement) {
    return contentNode.parentElement;
  }

  return turnNode;
}

async function savePair(pair, button) {
  const promptText = pair.prompt?.text || "";
  const responseText = pair.assistant.text;
  const cleanedPrompt = stripUiNoise(promptText);
  const cleanedResponse = stripUiNoise(responseText);
  const responseFingerprint = sliceText(cleanedResponse, FINGERPRINT_LENGTH);
  const promptFingerprint = sliceText(cleanedPrompt, FINGERPRINT_LENGTH);
  const title = toWholeWords(cleanedPrompt || cleanedResponse, MAX_TITLE_LENGTH) || "Untitled prompt";
  const textSnippet = toWholeWords(cleanedResponse, MAX_PREVIEW_LENGTH);
  const promptSnippet = toWholeWords(cleanedPrompt, MAX_PREVIEW_LENGTH);
  const bookmark = {
    id: crypto.randomUUID(),
    title,
    textSnippet,
    chatUrl: normalizeChatUrl(location.href),
    timestamp: Date.now(),
    anchorIndex: pair.assistant.index,
    promptSnippet,
    promptFingerprint,
    responseFingerprint
  };

  if (!responseFingerprint) {
    setButtonState(button, "No text found", "error");
    return;
  }

  const bookmarks = await readBookmarks();
  if (bookmarks.some((entry) => isDuplicateBookmark(entry, bookmark))) {
    setButtonState(button, "Already saved", "duplicate");
    return;
  }

  bookmarks.unshift(bookmark);
  await writeBookmarks(bookmarks);
  setButtonState(button, "Saved", "saved");
  highlightElement(pair.assistant.node);
}

function createSaveButton(turnNode) {
  const root = document.createElement("div");
  root.className = "bookmarkme-save-root";
  root.dataset.bookmarkmeRoot = "save";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "bookmarkme-save-button";
  button.textContent = "Save chat";
  button.dataset.defaultLabel = "Save chat";
  button.setAttribute("aria-label", "Save this prompt and response pair");

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const pair = findPairForAssistantNode(turnNode);
    if (!pair) {
      setButtonState(button, "Pair not found", "error");
      return;
    }

    try {
      await savePair(pair, button);
    } catch (error) {
      console.error("BookmarkMe: failed to save pair", error);
      setButtonState(button, "Save failed", "error");
    }
  });

  root.appendChild(button);
  return root;
}

function setLauncherState(button, label, state = "") {
  const labelNode = button.querySelector(".bookmarkme-launcher-label");
  if (labelNode) {
    labelNode.textContent = label;
  }

  button.dataset.state = state;
}

function createLauncherButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bookmarkme-launcher";
  button.dataset.bookmarkmeLauncher = "true";
  button.setAttribute("aria-label", "Open BookmarkMe side panel");
  button.setAttribute("title", "Open BookmarkMe side panel");
  button.innerHTML = `
    <span class="bookmarkme-launcher-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="4"></rect>
        <path d="M9 4v16"></path>
        <path d="m14 8 2 1.5L18 8v8"></path>
      </svg>
    </span>
    <span class="bookmarkme-launcher-label">Bookmarks</span>
  `;

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    setLauncherState(button, "Opening...", "opening");

    try {
      chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
    } catch (error) {
      console.error("BookmarkMe: failed to open side panel", error);
      setLauncherState(button, "Error", "error");
      window.setTimeout(() => {
        setLauncherState(button, "Bookmarks");
      }, 1600);
      return;
    }

    window.setTimeout(() => {
      setLauncherState(button, "Bookmarks");
    }, 700);
  });

  return button;
}

function ensurePanelLauncher() {
  ensureStyles();

  let launcher = document.querySelector("[data-bookmarkme-launcher]");
  if (launcher) {
    if (launcher.parentElement !== document.body) {
      launcher.remove();
      launcher = null;
    }
  }

  if (!launcher) {
    document.body.appendChild(createLauncherButton());
  }
}

function hydrateSaveButtons() {
  ensureStyles();
  ensurePanelLauncher();

  const pairs = buildPairs();
  for (const pair of pairs) {
    const anchor = getActionAnchorNode(pair.assistant.node);
    if (!(anchor instanceof HTMLElement)) {
      continue;
    }

    pair.assistant.node.classList.add("bookmarkme-turn");
    if (window.getComputedStyle(anchor).position === "static") {
      anchor.style.position = "relative";
    }

    if (!anchor.querySelector('[data-bookmarkme-root="save"]')) {
      anchor.appendChild(createSaveButton(pair.assistant.node));
    }
  }
}

function scheduleHydrate(delay = 120) {
  window.clearTimeout(hydrateTimer);
  hydrateTimer = window.setTimeout(() => {
    hydrateSaveButtons();
  }, delay);
}

function getScrollableContainer() {
  const seed = getTurnNodes()[0] || document.querySelector("main");
  let current = seed;

  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const scrollable =
      /(auto|scroll|overlay)/.test(style.overflowY) &&
      current.scrollHeight > current.clientHeight + 120;

    if (scrollable) {
      return current;
    }

    current = current.parentElement;
  }

  return document.scrollingElement || document.documentElement;
}

function getScrollTop(container) {
  if (
    container === document.scrollingElement ||
    container === document.documentElement ||
    container === document.body
  ) {
    return document.scrollingElement?.scrollTop ?? window.scrollY ?? 0;
  }

  return container.scrollTop;
}

function isAtTop(container) {
  return getScrollTop(container) <= 4;
}

function scrollContainerBy(container, deltaY) {
  if (
    container === document.scrollingElement ||
    container === document.documentElement ||
    container === document.body
  ) {
    window.scrollBy({ top: deltaY, behavior: "auto" });
    return;
  }

  container.scrollBy({ top: deltaY, behavior: "auto" });
}

function chooseClosestPair(pairs, anchorIndex) {
  if (!pairs.length) {
    return null;
  }

  if (typeof anchorIndex !== "number" || Number.isNaN(anchorIndex)) {
    return pairs[0];
  }

  return pairs
    .slice()
    .sort(
      (left, right) =>
        Math.abs(left.assistant.index - anchorIndex) -
        Math.abs(right.assistant.index - anchorIndex)
    )[0];
}

function findBookmarkTarget(bookmark, allowApproximate = false) {
  const responseFingerprint = getResponseFingerprint(bookmark);
  const promptFingerprint = getPromptFingerprint(bookmark);
  const anchorIndex = Number(bookmark?.anchorIndex);
  const pairs = buildPairs();

  const exactAssistantMatches = pairs.filter((pair) =>
    pair.assistant.text.includes(responseFingerprint)
  );
  if (exactAssistantMatches.length) {
    return chooseClosestPair(exactAssistantMatches, anchorIndex)?.assistant.node || null;
  }

  const promptMatches = pairs.filter((pair) => {
    if (!promptFingerprint || !pair.prompt?.text) {
      return false;
    }

    return pair.prompt.text.includes(promptFingerprint);
  });

  if (promptMatches.length && allowApproximate) {
    return chooseClosestPair(promptMatches, anchorIndex)?.assistant.node || null;
  }

  if (!allowApproximate || Number.isNaN(anchorIndex)) {
    return null;
  }

  const nearby = chooseClosestPair(
    pairs.filter((pair) => Math.abs(pair.assistant.index - anchorIndex) <= 1),
    anchorIndex
  );

  return nearby?.assistant.node || chooseClosestPair(pairs, anchorIndex)?.assistant.node || null;
}

function highlightElement(element) {
  element.classList.remove("bookmarkme-highlight");
  void element.offsetWidth;
  element.classList.add("bookmarkme-highlight");

  window.setTimeout(() => {
    element.classList.remove("bookmarkme-highlight");
  }, 2600);
}

async function revealElement(element) {
  element.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "nearest"
  });

  await wait(260);
  highlightElement(element);
}

async function searchAndScrollToBookmark(bookmark) {
  let target = findBookmarkTarget(bookmark, false);
  if (target) {
    await revealElement(target);
    return { ok: true, mode: "direct" };
  }

  const container = getScrollableContainer();
  let previousTop = getScrollTop(container);
  let step = 0;

  while (!isAtTop(container) && step < MAX_SEARCH_STEPS) {
    scrollContainerBy(container, -SEARCH_SCROLL_STEP);
    await wait(SEARCH_DELAY_MS);

    target = findBookmarkTarget(bookmark, false);
    if (target) {
      await revealElement(target);
      return { ok: true, mode: "search" };
    }

    const currentTop = getScrollTop(container);
    if (currentTop === previousTop) {
      break;
    }

    previousTop = currentTop;
    step += 1;
  }

  await wait(SEARCH_DELAY_MS);
  target = findBookmarkTarget(bookmark, true);
  if (target) {
    await revealElement(target);
    return { ok: true, mode: "fallback" };
  }

  return { ok: false, reason: "not-found" };
}

function observePage() {
  if (!document.body) {
    window.setTimeout(observePage, 250);
    return;
  }

  const observer = new MutationObserver(() => {
    scheduleHydrate();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  scheduleHydrate(200);
}

function monitorRouteChanges() {
  window.setInterval(() => {
    const currentUrl = normalizeChatUrl(location.href);
    if (currentUrl !== lastKnownUrl) {
      lastKnownUrl = currentUrl;
      scheduleHydrate(180);
    }
  }, 1000);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "JUMP_TO_BOOKMARK") {
    searchAndScrollToBookmark(message.bookmark)
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.error("BookmarkMe: jump failed", error);
        sendResponse({ ok: false, reason: "error" });
      });
    return true;
  }

  if (message?.type === "PING_BOOKMARKME") {
    sendResponse({ ok: true });
  }

  return false;
});

observePage();
monitorRouteChanges();
