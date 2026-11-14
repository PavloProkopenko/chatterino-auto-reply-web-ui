# Manual check: what does your browser allow on the real plugin folder?

Why: the hosted site can only reach files the browser lets it reach. Browsers block some system folders and ask for permission in different ways. This page tells us what Chrome/Edge really does on your real folders, so the design follows reality (Phase 2b).

Nothing is uploaded anywhere. The page never shows file contents, only names, sizes and results. The two write checks write the **same text back** (or create and delete a temporary file), so your settings do not change. Still, make a copy of `config.json` first.

## Steps (Chrome or Edge)
1. Copy your real `Plugins/<Auto Reply folder>/data/config.json` somewhere safe.
2. Start the site: `pnpm dev` (see the README). It opens the site; instead open this address in the same browser: `http://127.0.0.1:5173/fsa-check.html` (the port may differ, copy it from the terminal line `http://127.0.0.1:PORT/#...`).
3. **Block 1:** press "Выбрать папку плагина" and pick your real plugin folder, the one that contains `info.json` and `data`. Typical places: macOS `~/Library/Application Support/<app folder>/Plugins/<plugin folder>` (in the dialog press Cmd+Shift+G and paste the path), Windows `%APPDATA%\<app folder>\Plugins\<plugin folder>` (paste into the dialog's address bar).
   - Read the result: did the browser allow the folder? Is `info.json` found, with the version? Is `data/config.json` readable?
   - Press "Проверить запись: создать и удалить временный файл в data".
   - Press "Проверить запись в config.json" and then run `/autoreply reload` in Leafyrino: any warning? any `config.json.bad`? Also check that no extra files stay in `data/`.
4. **Block 2:** press "Выбрать только config.json" and pick the real file. Press its write check.
5. **Block 3:** with something picked, press "Запомнить выбранное", then reload the page (Cmd/Ctrl+R). Read what the page says about the permission after reload (granted / prompt / denied). If it says prompt, press "Запросить разрешение снова" and note what the browser shows.
6. Press "Скопировать результат" and paste the whole result into the section below (or send it to me). It contains your folder names but no file contents; replace the user name if you like.

## Result so far
- macOS, Chrome (owner, 2026-11-14): picking `~/Library/Application Support/chatterino/Plugins/` as a folder is refused ("can't open this folder because it contains system files"). Picking `data/config.json` as a file is refused too. Direct access to the plugin folder is therefore not available there; Phase 2c makes open + download the main flow. Windows (`%APPDATA%`) is UNVERIFIED.

## Result (fill in)
- Browser and OS:
- Did Chrome/Edge allow picking the plugin folder? Which folder exactly?
- `info.json` found with the right version?
- Temporary-file write check:
- In-place `config.json` write: result, `/autoreply reload` warnings, `config.json.bad`?
- Picking only `config.json`: allowed? write ok?
- After reload: permission state (granted / prompt / denied):
- Anything surprising (extra files, permission prompts, messages):

Delete `src/ui/fsa-check.html` and `src/ui/fsa-check.ts` after the check (I do that).
