# BookmarkMe for ChatGPT

A Chrome Extension (Manifest V3) that lets you save specific ChatGPT prompt/response pairs and jump back to them later.

## What it does

- Adds a `Save Chat` button to assistant replies inside ChatGPT.
- Stores bookmarks in `chrome.storage.local`.
- Shows bookmarks for the current conversation inside a side panel.
- Jumps back to a saved response by searching visible messages first, then scrolling upward in steps until the message is found or the top is reached.
- Briefly highlights the target message after navigation.

## Stored bookmark shape

The extension stores bookmarks under the `bookmarks` key in `chrome.storage.local`.

```json
{
  "id": "uuid",
  "title": "Prompt preview",
  "textSnippet": "First 100 chars of the assistant response",
  "chatUrl": "https://chatgpt.com/c/...",
  "timestamp": 1712345678901,
  "anchorIndex": 12,
  "promptSnippet": "First 100 chars of the user prompt"
}
```

The first five fields satisfy the requested storage contract. `anchorIndex` and `promptSnippet` are included as extra fingerprint data to improve matching reliability.

## Files

- `manifest.json`: MV3 manifest with only `storage` and `sidePanel` as named permissions, plus ChatGPT host access.
- `background.js`: Enables opening the side panel from the extension action and limits the panel to ChatGPT tabs.
- `content.js`: Injects save controls, fingerprints message pairs, and performs search-and-scroll navigation.
- `sidepanel.html`: Side panel UI shell and styles.
- `sidepanel.js`: Loads chat-specific bookmarks, renders cards, and sends jump requests to the page.

## Notes

- The content script uses resilient selectors and fallback role inference because ChatGPT does not expose stable message IDs.
- Bookmarks are scoped to the normalized conversation URL, so the side panel only shows items for the current chat.
- Duplicate bookmarks for the same response are blocked using URL, snippet, and approximate turn index checks.
