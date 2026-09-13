# YeeTlist

A personal list of things to come back to, living in your browser and syncing
to your own Google Drive. Paste a link, tag it, find it later.

Two lists behind a tab each. **YouTube** fetches the title, channel, duration
and upload date for every video. **Other Bookmarks** takes any other link and
reads the site's own name off the page.

No build step, no framework, no dependencies. Vanilla HTML, CSS and JavaScript
plus four serverless functions. Deploys to Vercel as-is.

**Live:** https://yeetlist.vercel.app

---

## What it does

**Add a video by pasting its link.** Title, channel, duration and upload date
are fetched for you. `youtu.be`, `/shorts`, `/embed`, `/live` and a plain watch
URL all work.

**Add anything else from the Other Bookmarks tab.** The page's own
`og:site_name` becomes the row's name, falling back to its `<title>` and then
to the hostname, so a site that refuses the request is still bookmarked. The
name is a snapshot taken once, and the pencil on any row edits it in place.

Each tab takes the links it is named for and refuses the other's, so nothing
lands in a list you are not looking at.

**Tag it.** Press the `+` on any row and type. Tags you have used already are
suggested as you go. Every tag carries an `×` to remove it.

**Find it again.** Search titles, channels, addresses and tags at once, or
filter by tag from the dropdown. A tag is matched with a `#` prefix, so
searching `#vfx` finds things tagged `vfx`. It ignores any whose title merely
contains the word. `Untagged` leads the menu, for whatever is still unsorted.

**Sort** by any column the list has, in either direction. Videos sort by title,
channel, duration, upload date or date added. Bookmarks sort by site name,
address or date added.

Each list keeps its own tags, filter, search, selection and sort. Switching
tabs never carries one list's filter onto the other.

**Import a file.** A `.md` or `.json` YeeTlist export merges in, keeping tags,
dates and deletions. **Any other file is read for links** — a browser
bookmarks `.html`, a page saved from the web, a notes file, a plain list of
addresses. Whatever it finds is sorted into the two lists: YouTube videos go
to the watchlist and every other link becomes a bookmark. A YouTube playlist
or channel is a link rather than a video, so it lands in Other Bookmarks
instead of being dropped.

A video link counts wherever it appears, because the id names one video
whether it was saved or merely quoted. **A bookmark has to be an entry**, and
each format says what that means:

| In | An entry is | Left out |
|---|---|---|
| Markdown, text | a list item, a heading, or a line that is nothing but the link | a link inside a sentence, and anything in an indented block under a list item |
| HTML | a link leading its own list item, or filling its own paragraph | a link mid-sentence, and anything in a `nav`, `header` or `footer` |

Images, stylesheets and other assets are never bookmarks. Neither is a
`javascript:` or `mailto:` address.

That split is what makes an arbitrary file usable. One 46-video Markdown
export carries 109 other addresses in its video descriptions: Spotify,
Bandcamp, Facebook, a thumbnail per entry. Every one of those is cited rather
than saved, and the import takes the 46 videos and none of the 109.

The link's own text is the name you saved it under, so it beats anything a
fetch could return. A bare link takes the heading above it, if that heading
has not already named something, and otherwise the hostname. A file of two
hundred links costs no requests at all for its bookmarks, and one request per
fifty for its videos. Both are reported with a progress bar and a count.

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

### Two ways to hold the connection

Which one runs depends on what the deployment is given, and the app degrades
rather than breaking when it is given less.

**With `GOOGLE_CLIENT_ID` alone** the browser asks Google for a token itself.
That token lasts about an hour, and there is nothing to renew it with. Every
renewal is a fresh request, which opens a popup, and a browser blocks a popup
that no click asked for. So it needs one click about once an hour. YeeTlist
keeps the token across reloads, so a refresh inside that hour is seamless, and
past it your first click anywhere on the page restores the connection.

**Add `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET`** and the server runs the
authorization code flow instead. Google returns a refresh token, which is
encrypted and kept in an `HttpOnly` cookie, so no script on the page can read
it and no database is needed. Renewal is then one silent server-to-server
request. No popup, no gesture, and the link survives a reload, a deploy and a
closed tab.

Linking becomes a redirect rather than a popup, for the same reason: a
redirect cannot be blocked.

### If it stops working after about a week

Check the consent screen's **Publishing status** in the Google Cloud console.
While it is on **Testing**, Google expires the grant after 7 days, and no
amount of refresh-token handling survives that. Press **Publish app**.

`drive.file` is a non-sensitive scope, so this does not drag you into the
security review that the broader Drive scopes require.

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
| `GOOGLE_CLIENT_SECRET` | yes | With the next one, the lasting connection described above. |
| `SESSION_SECRET` | yes | Encrypts the stored refresh token. Any long random string. |

Generate the session secret rather than inventing one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Changing it signs every reader out, because the stored cookies can no longer
be opened. That is how you revoke every session at once.

**Three settings that are easy to get wrong**, all in the Google Cloud
console:

- Leave `YOUTUBE_API_KEY` **unrestricted by HTTP referrer**. It is used
  server-side, and a server sends no referrer, so a browser-restricted key is
  refused with `Requests from referer <empty> are blocked`.
- Add your deployed origin **and** `http://localhost:3000` to the OAuth
  client's **Authorized JavaScript origins**, or sign-in returns
  `Error 401: invalid_client`.
- Add both callback addresses to **Authorized redirect URIs**, which is a
  different list from the origins. Miss this and Google answers
  `redirect_uri_mismatch`. The app repeats the exact URL to paste.

```
http://localhost:3000/api/oauth/callback
https://YOUR-DEPLOYMENT/api/oauth/callback
```

## How it is put together

| File | What it holds |
|---|---|
| `index.html` | The whole document, including the inline icon sprite. |
| `styles.css` | A token layer, then the components. Every number comes from a published scale. |
| `app.js` | State, rendering, filtering, import, export, toasts. |
| `drive.js` | The Google token flow and the Drive REST calls. |
| `api/config.js` | Serves the client ID, and which of the two Drive flows this deployment can run. |
| `api/video.js` | Metadata for one video. |
| `api/videos.js` | Metadata for up to 50 videos in one call, at one quota unit. |
| `api/link.js` | A page's own name, for a bookmark. Streams the head and stops at `</head>`, gives up after 6 seconds, and answers an empty name rather than an error so the hostname can stand in. |
| `api/oauth/*.js` | Start, callback, token and disconnect for the server-side flow. |
| `lib/session.mjs` | Cookie sealing and the Google token exchange. One implementation, imported by both servers. |
| `dev-server.cjs` | The local server. Imports the same OAuth handlers, so the preview cannot disagree with production. |

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
