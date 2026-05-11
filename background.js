const CHATGPT_URL_PATTERN = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i;

function isChatGptUrl(url = "") {
  return CHATGPT_URL_PATTERN.test(url);
}

async function syncSidePanel(tabId, url = "") {
  if (!tabId) {
    return;
  }

  await chrome.sidePanel.setOptions({
    tabId,
    path: "sidepanel.html",
    enabled: isChatGptUrl(url)
  });
}

async function syncAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) => syncSidePanel(tab.id, tab.url || ""))
  );
}

async function enableActionToOpenPanel() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(async () => {
  await enableActionToOpenPanel();
  await syncAllTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await enableActionToOpenPanel();
  await syncAllTabs();
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "OPEN_SIDE_PANEL") {
    return;
  }

  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;

  if (typeof windowId !== "number") {
    return;
  }

  void chrome.sidePanel.open({ windowId }).catch((error) => {
    console.error("BookmarkMe: failed to open side panel", error);
  });

  if (typeof tabId === "number") {
    void chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: true
    });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") {
    return;
  }

  await syncSidePanel(tabId, changeInfo.url || tab.url || "");
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  await syncSidePanel(tabId, tab.url || "");
});
