# Reshelve

Reorganize your Chrome bookmarks with AI — every change is previewed, confirmed, and undoable.

**[▸ Install from the Chrome Web Store](https://chromewebstore.google.com/detail/reshelve/hlmicephladojlmomimpngjaaaflapma)**

English | [简体中文](README.zh-CN.md)

<p align="center">
  <img src="docs/posters/reshelve-organize.webp" alt="Reshelve turns scattered bookmarks into an organized library." width="100%">
</p>

Reshelve reorganizes your **native Chrome bookmarks**, not some separate system. When it's
done, your bookmarks bar is still your bookmarks bar, and sync across your devices works
exactly as before.

<p align="center">
  <img src="docs/screenshots/en/1-scope.png" alt="You pick the scope. Unchecked folders are never read and never modified." width="880">
</p>

<p align="center">
  <img src="docs/screenshots/en/2-preview.png" alt="Review every move. Cancel any of them individually, or by confidence." width="880">
</p>


## You're in control, not the AI

<p align="center">
  <img src="docs/posters/reshelve-control.webp" alt="Preview, confirm, or undo every proposed bookmark move." width="100%">
</p>

- **You choose the scope.** Check the folders you want reorganized. Unchecked folders are
  never read and never modified — no bookmark moves out of them, and none moves in.
- **You choose how this run works.** Reshelve looks at the scope and recommends a path —
  file into the folders you already have, or redesign the tree if it really is a mess —
  and explains why. You can override it before anything runs: file everything, only the
  bookmarks sitting loose under the root, or redesign the whole tree.
- **Or skip the model and only clean titles.** Pick the platforms you care about (GitHub,
  GitLab, npm / PyPI / Docker Hub, Hugging Face, arXiv, YouTube, CSDN, Zhihu, Juejin,
  Bilibili, Medium / Dev.to). Rules run locally from the URL — no model, no page fetch.
  You review each rename before it lands.
- **Review every change.** Before anything is applied, every move and every rename is
  listed: where each bookmark came from, where it's going, and why. Cancel any of them
  individually, or filter in bulk by confidence.
- **Undo in one click.** Not happy with the result? Restore everything to how it was.

## Bring your own model

Reshelve has no server. You point it at your own endpoint:

- The official OpenAI API
- Any OpenAI-compatible service (DeepSeek, Moonshot, Zhipu, OpenCode Go, a self-hosted
  proxy, …)
- Ollama or LM Studio on your own machine — data never leaves your computer

One caveat: OpenCode Go is a gateway aimed at coding-agent traffic, so bookmark
classification over it is best-effort. If connection tests keep failing, switch to
a model vendor's direct endpoint (Zhipu, Kimi, ...).

Every API key you enter is stored locally in `chrome.storage`, and each is only ever sent
to the endpoint it belongs to. Deleting an endpoint in Settings deletes its key with it.

## Privacy, specifically

Claims worth checking rather than taking on faith:

| Claim | Where to verify |
|---|---|
| URLs are trimmed before being sent — query parameters, anchors and embedded credentials are stripped, leaving only domain and path | [`src/core/sanitize.ts`](src/core/sanitize.ts) |
| Host access is never requested at install time; at runtime only the single domain you entered is requested | [`src/sidepanel/lib/permissions.ts`](src/sidepanel/lib/permissions.ts) |
| Outbound traffic only goes to the endpoint you configured (chat, listing models, a connectivity probe), and — only once you run the dead-link check — a HEAD request to each bookmark's own site (falling back to GET when a server rejects HEAD). No analytics, telemetry, or tracking | [`src/llm/client.ts`](src/llm/client.ts), [`src/llm/models.ts`](src/llm/models.ts), [`src/engine/linkCheck.ts`](src/engine/linkCheck.ts) |

[`src/sidepanel/lib/favicons.ts`](src/sidepanel/lib/favicons.ts) also calls `fetch`, but not
outbound: it reads `chrome-extension://<id>/_favicon/`, Chrome's own local icon cache, so
that HTML exports can carry icons. Nothing leaves your machine.

The wildcards in `optional_host_permissions` exist for two reasons: the endpoint is yours to
choose and cannot be enumerated in advance, and the dead-link check has to be able to reach
whatever your bookmarks point at. Both are *optional* permissions — neither is granted at
install time. For the endpoint, `chrome.permissions.request()` only ever asks for the one
domain you typed. The all-sites permission is asked for only when you press the dead-link
check button, and never before.

Full policy: [Privacy Policy / 隐私权政策](https://gist.github.com/gaotiesuanna/239c067efd9cc7d98f25ed5daa4c3ef7)

## Also included

- **Local cleanup**, with no model. Deduplicate, check dead links, find long-unvisited
  bookmarks from Chrome's last-opened time (browsing history is not read), or group
  bookmarks whose title or URL contains text you enter. The dead-link check is the only
  cleanup that talks to the network, and only after you press the button.
- **Export** selected folders to JSON — full folder structure, or a flat list of links —
  or as a Netscape HTML bookmarks file other browsers can import.
- **Import** a bookmark file someone shared with you. You see what's inside before anything
  is written, and everything lands in one new folder. `javascript:` and `data:` links are
  blocked and reported explicitly rather than silently dropped.
- **Stats** ranks the domains your bookmarks come from. Ranking by visits is optional, and
  asks for history permission only if you press that button.

<p align="center">
  <img src="docs/screenshots/en/3-cleanup.png" alt="No model needed. Duplicates, empty folders, dead links, and bookmarks you stopped opening." width="880">
</p>

<p align="center">
  <img src="docs/screenshots/en/4-stale.png" alt="Find what you saved and forgot. Bucketed by last-opened time, no browsing history." width="880">
</p>

<p align="center">
  <img src="docs/screenshots/en/5-stats.png" alt="See where your bookmarks come from. Optionally ranked by how often you visit." width="880">
</p>


## Build from source

The Web Store listing above is the easy path. Build it yourself if you want to read the code
you're running, or hack on it:

```bash
npm install
npm run build     # type-check, then build to dist/
npm test          # 1900+ unit tests, no network
npm run dev       # dev server with HMR
```

Load the extension by pointing `chrome://extensions` → *Load unpacked* at `dist/`.

The manifest is generated from [`manifest.config.ts`](manifest.config.ts) by CRXJS at build
time — don't hand-write `dist/manifest.json`, it gets overwritten.

## Layout

| Path | What lives there |
|---|---|
| `src/core` | Pure logic: URL sanitizing, title rules, folder-tree building. No browser APIs |
| `src/engine` | Turning a plan into bookmark operations, and the undo snapshot |
| `src/llm` | The model client and prompts |
| `src/storage` | Settings, caches, undo snapshots |
| `src/background` | Service worker |
| `src/sidepanel` | The entire UI |
| `src/i18n` | Message lookup; strings live in `public/_locales` |

## License

[Apache-2.0](LICENSE)
