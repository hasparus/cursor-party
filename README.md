# Cursor Party

Multiplayer cursors for any website with one script tag. Runs on [PartyServer](https://github.com/cloudflare/partykit/tree/main/packages/partyserver) and Cloudflare Workers.

Forked from [partykit/cursor-party](https://github.com/partykit/cursor-party).

## Usage

Add the script tag just before the closing `</body>`:

```html
<script src="https://cursor-party.hasparus.workers.dev/cursors.js"></script>
```

The script connects to the origin it's served from. Only pages matching `WEBSITES` in `wrangler.toml` (URL patterns, see the [URL Pattern API](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API)) can connect; localhost is always allowed.

By default everyone on the same page (URL without query or hash) shares one room. Add `data-room="..."` to the script tag to split a page into rooms, e.g. one per document. Changing `data-room` switches rooms without re-running the script, and `data-room=""` leaves the room. Removing the script tag removes the cursors altogether.

Type `/` to cursor chat with other users.

## Development

```console
$ pnpm install
$ pnpm build    # bundles src/cursors.tsx into public/cursors.js
$ pnpm dev      # wrangler dev on http://localhost:8787
$ pnpm run deploy  # wrangler deploy
```

Open http://localhost:8787 in two browsers to see the cursors.

## Disabling secret cursor chat

- In `src/presence/Cursors.tsx` set `ENABLE_CHAT = false`

## Customizing the display of the cursors

You can modify the code in this repo to change the display of the cursors. You'll need to be familiar with JavaScript and CSS.

- Instead of cloning this repo, fork it to your own GitHub account
- `src/presence/Cursors.tsx`: To make the cursors fit in the browser windows instead of over the full document, change the hook to read: `useCursorTracking("document")`
- `src/presence/other-cursors.tsx`: Change the cursor container here, for example to change the z-index
- `src/presence/cursor.tsx`: Change the appearance of a cursor here, for example to swap out the pointer for an image of your choosing.
