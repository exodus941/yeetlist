# YeeTlist

A personal YouTube watchlist that lives in your browser and syncs to your own
Google Drive. Paste a link, tag it, find it later.

No build step, no framework, no dependencies. Vanilla HTML, CSS and JavaScript
plus three serverless functions. Deploys to Vercel as-is.

**Live:** https://yeetlist.vercel.app

---

## What it does

**Add a video by pasting its link.** Title, channel, duration and upload date
are fetched for you. `youtu.be`, `/shorts`, `/embed`, `/live` and a plain watch
URL all work.

**Tag it.** Press the `+` on any row and type. Tags you have used already are
suggested as you go. Every tag carries an `×` to remove it.

**Find it again.** Search titles, channels and tags at once, or filter by tag
from the dropdown. A tag is matched with a `#` prefix, so searching `#vfx`
finds videos tagged `vfx` and ignores any whose title merely contains the word.

**Sort** by video title, channel, duration, upload date or date added, in
either direction.

**Import a file.** Point it at a `.md` or `.json` YeeTlist export to merge one
in, or at a browser bookmarks `.html` to pull every YouTube link out of it.
Bookmark files are parsed with a progress bar and report how many were added.

**Export a file.** `Export .md` writes `yeetlist.md`: a readable Markdown table
with a JSON payload underneath, so a round trip loses nothing.

**Sync to Drive.** See below.

## Google Drive sync

`Link Google Drive` asks for the `drive.file` scope, which is the narrowest
Drive scope Google offers. It grants access to files this app created and
nothing else. YeeTlist cannot list, read or search the rest of your Drive.

It keeps one file, `yeetlist.md`, and writes to it as you edit. Linking a
second device finds that same file by name and merges the two lists, so a
video added on your phone shows up on your laptop.

`Sync Now` forces a read-then-write immediately, rather than waiting for the
next edit. `Disconnect` hands the token back to Google and forgets the link.

**One known limit.** A Google access token lasts about an hour. A browser-only
token flow cannot renew one without a user gesture, because the request opens
a popup and browsers block a popup that no click asked for. YeeTlist keeps the
token across reloads, so a refresh inside that hour is seamless. Past it, your
first click anywhere on the page restores the connection.

## Running it locally

```bash
npm run dev
```

That serves the app and the API on http://localhost:3000. There is nothing to
install and nothing to compile.

To use the YouTube and Drive features locally, copy `.env.example` to
`.env.local` and fill in what you want. Both variables are optional.

```bash
cp .env.example .env.local
```

## Deploying

Push to a repository and import it into Vercel. There is no build command and
no output directory to set.

Then, in the Vercel project's environment variables:

| Variable | Optional | What it buys |
|---|---|---|
| `YOUTUBE_API_KEY` | yes | Duration and upload date. Without it, oEmbed still gives a title and a channel. |
| `GOOGLE_CLIENT_ID` | yes | The Drive button. Without it the app hides it and stores everything locally. |

There is no client secret anywhere in this project. The browser-only token
flow does not use one, so there is none to leak.

**Two settings that are easy to get wrong**, both in the Google Cloud console:

- Leave `YOUTUBE_API_KEY` **unrestricted by HTTP referrer**. It is used
  server-side, and a server sends no referrer, so a browser-restricted key is
  refused with `Requests from referer <empty> are blocked`.
- Add your deployed origin **and** `http://localhost:3000` to the OAuth
  client's **Authorized JavaScript origins**, or sign-in returns
  `Error 401: invalid_client`.

## How it is put together

| File | What it holds |
|---|---|
| `index.html` | The whole document, including the inline icon sprite. |
| `styles.css` | A token layer, then the components. Every number comes from a published scale. |
| `app.js` | State, rendering, filtering, import, export, toasts. |
| `drive.js` | The Google token flow and the Drive REST calls. |
| `api/config.js` | Serves the client ID and whether Drive is available at all. |
| `api/video.js` | Metadata for one video. |
| `api/videos.js` | Metadata for up to 50 videos in one call, at one quota unit. |
| `dev-server.cjs` | The local server. Mirrors the API so `npm run dev` behaves like production. |

`api/videos.js` is why importing a large bookmarks file is cheap. The YouTube
API charges one quota unit whether you ask for one video or fifty, so a
200-link file costs four requests rather than two hundred.

### The list is a table until it cannot be

Above 1173px every column shows in full. Below that the table gives up one
thing at a time, in the order you can most afford to lose it: first the
timestamps, keeping the dates, then the channel column caps and truncates,
then the title takes whatever is left. Under 953px the columns cannot hold
their own headings, so each row becomes a card instead.

## Checks

```bash
npm run check
```

Runs the syntax guard over every source file. It also runs as a pre-commit
hook.

`layout-tools.js` is a layout measuring instrument, served so it can be loaded
into the running page from the console:

```js
const src = await (await fetch('/layout-tools.js')).text()
new Function(src + '\nwindow.sweep=sweep;window.probe=probe')()
sweep()
```

It reports ghosts, covered elements, content spill, off-centre icons,
misaligned tops and baselines, mismatched heights, edges, gaps, overflow,
scrollers and undersized touch targets.

## Privacy

Your watchlist is yours. It lives in your browser's local storage and, if you
link it, in one file in your own Google Drive. There is no account, no
database and no server storing anything. The serverless functions only ask
YouTube about a video id and hand back what it says.
