const STORAGE_KEY = "bookmarks";
const statusElement = document.getElementById("status");
const emptyStateElement = document.getElementById("emptyState");
const bookmarkListElement = document.getElementById("bookmarkList");
const refreshButton = document.getElementById("refreshButton");

function normalizeChatUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${pathname}`;
  } catch (error) {
    return url;
  }
}

function isChatGptUrl(url = "") {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(url);
}

function normalizeText(text = "") {
  return text.replace(/\u200b/g, "").replace(/\s+/g, " ").trim();
}

function stripUiNoise(text = "") {
  return normalizeText(
    text
      .replace(/\bYou said\b:?\s*/gi, " ")
      .replace(/\bChatGPT said\b:?\s*/gi, " ")
      .replace(/show\s*more/gi, " ")
      .replace(/show\s*less/gi, " ")
      .replace(/\.{3,}/g, " ")
  );
}

function completeWords(text, maxLength) {
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

function getBookmarkTitle(bookmark) {
  return (
    completeWords(
      bookmark.promptSnippet || bookmark.promptFingerprint || bookmark.title || "Untitled prompt",
      96
    ) || "Untitled prompt"
  );
}

function getBookmarkSnippet(bookmark) {
  return completeWords(bookmark.textSnippet || bookmark.responseFingerprint || "", 120);
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "Saved recently";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab || null;
}

async function getBookmarks() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
}

function setStatus(text = "") {
  statusElement.textContent = text;
}

function clearBookmarks() {
  bookmarkListElement.replaceChildren();
}

function renderEmpty(message, subtitle) {
  clearBookmarks();
  emptyStateElement.hidden = false;
  emptyStateElement.innerHTML = `<strong>${message}</strong>${subtitle ? `<span>${subtitle}</span>` : ""}`;
}

function createButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${className}`.trim();
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

async function deleteBookmark(id) {
  const bookmarks = await getBookmarks();
  const filtered = bookmarks.filter((bookmark) => bookmark.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
}

async function jumpToBookmark(bookmark) {
  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    setStatus("No active tab available.");
    return;
  }

  const title = getBookmarkTitle(bookmark);
  setStatus(`Searching for "${title}"...`);

  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: "JUMP_TO_BOOKMARK",
      bookmark
    });

    if (response?.ok) {
      setStatus(`Jumped to "${title}".`);
      return;
    }

    setStatus("That bookmark could not be located in the current chat.");
  } catch (error) {
    console.error("BookmarkMe: jump failed", error);
    setStatus("The page script is not ready yet. Try refreshing ChatGPT once.");
  }
}

function renderBookmarks(bookmarks) {
  clearBookmarks();
  emptyStateElement.hidden = bookmarks.length > 0;

  if (!bookmarks.length) {
    return;
  }

  const fragment = document.createDocumentFragment();

  bookmarks.forEach((bookmark) => {
    const titleText = getBookmarkTitle(bookmark);
    const snippetText = getBookmarkSnippet(bookmark);
    const card = document.createElement("article");
    card.className = "bookmark-card";

    const title = document.createElement("h2");
    title.className = "bookmark-title";
    title.textContent = titleText;

    const meta = document.createElement("p");
    meta.className = "bookmark-meta";
    meta.textContent = formatTimestamp(bookmark.timestamp);

    const actions = document.createElement("div");
    actions.className = "bookmark-actions";

    if (snippetText) {
      const snippet = document.createElement("p");
      snippet.className = "bookmark-snippet";
      snippet.textContent = snippetText;
      card.append(title, snippet, meta);
    } else {
      card.append(title, meta);
    }

    const jumpButton = createButton("Jump", "button-primary", () => jumpToBookmark(bookmark));
    const deleteButton = createButton("Delete", "button-danger", async () => {
      await deleteBookmark(bookmark.id);
      setStatus(`Removed "${titleText}".`);
    });

    actions.append(jumpButton, deleteButton);
    card.appendChild(actions);
    fragment.appendChild(card);
  });

  bookmarkListElement.appendChild(fragment);
}

async function refreshPanel() {
  const activeTab = await getActiveTab();
  if (!activeTab?.url || !isChatGptUrl(activeTab.url)) {
    setStatus("");
    renderEmpty("No active ChatGPT chat", "Open a conversation and use Save chat to create bookmarks.");
    return;
  }

  const currentChatUrl = normalizeChatUrl(activeTab.url);
  const bookmarks = await getBookmarks();
  const relevantBookmarks = bookmarks
    .filter((bookmark) => normalizeChatUrl(bookmark.chatUrl) === currentChatUrl)
    .sort((left, right) => right.timestamp - left.timestamp);

  renderBookmarks(relevantBookmarks);
  setStatus(
    relevantBookmarks.length
      ? `${relevantBookmarks.length} bookmark${relevantBookmarks.length === 1 ? "" : "s"}`
      : "Use Save chat inside the conversation to create your first bookmark."
  );

  if (!relevantBookmarks.length) {
    renderEmpty("No bookmarks yet", "Use Save chat on any message. Only bookmarks from this conversation appear here.");
  }
}

refreshButton.addEventListener("click", () => {
  refreshPanel().catch((error) => {
    console.error("BookmarkMe: refresh failed", error);
    setStatus("Refresh failed. Try again.");
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) {
    refreshPanel().catch((error) => {
      console.error("BookmarkMe: storage sync failed", error);
    });
  }
});

chrome.tabs.onActivated.addListener(() => {
  refreshPanel().catch((error) => {
    console.error("BookmarkMe: tab activation refresh failed", error);
  });
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    refreshPanel().catch((error) => {
      console.error("BookmarkMe: tab update refresh failed", error);
    });
  }
});

refreshPanel().catch((error) => {
  console.error("BookmarkMe: initial load failed", error);
  setStatus("Unable to load bookmarks right now.");
});
