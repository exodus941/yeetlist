# Yeetlist

A place for the things you want to come back to: videos, links and notes.
It runs in the browser and as an Android app, and syncs between devices
through your own Google Drive. Paste a link, tag it, rate it, find it later.

No build step, no framework, no dependencies. Vanilla HTML, CSS and JavaScript
plus a handful of serverless functions. Deploys to Vercel as-is.

**Live:** https://yeetlist.vercel.app
**Android:** the newest APK is always on the [releases page](https://github.com/exodus941/yeetlist/releases/latest).

---

## Three lists

Each list sits behind its own tab and keeps its own search, filters, sort,
selection and page.

**YouTube** takes video links and fetches the title, channel, duration and
upload date. `youtu.be`, `/shorts`, `/embed`, `/live` and plain watch links
all work. A playlist link adds every video in it.

**Bookmarks** takes any other link and reads the site's own name off the
page, falling back to its title and then to the address. The pencil on a row
renames it.

**Notes** holds text of your own, written and edited in place.

A link pasted into the wrong list goes to the list it belongs in, and a link
shared from another app never becomes a note.

## Finding things again

- **Tags.** Press `+` on any row and type. Tags you have used are suggested.
  Select several rows and tag them at once.
- **Ratings.** Up to five stars on any video or bookmark.
- **Search** covers names, channels, addresses and tags at once. `#tag`
  matches a tag rather than a word.
- **Filters** by tag, by rating, or for whatever is still untagged.
- **Sort** by any column, either way round.
- **Pages** of 50, with a box to type a page number and jump.

On a wide screen a list is a table. As the window narrows it gives up the
least useful detail first, then turns each row into a card.

## Upload and Download

**Download** writes a file: the videos, the bookmarks, both, or the notes.
Links go out as a browser bookmark file, so Chrome, Firefox, Safari and Edge
can import them as a folder. Notes go out as Markdown. The whole Yeetlist
record rides along inside, so uploading the file back keeps tags, ratings,
dates and deletions.

**Upload** takes a Yeetlist file back and merges it. It also reads almost any
other file for links: a browser's own bookmarks export, a page saved from the
web, a notes file, a plain list of addresses. Videos go to YouTube, other
links become bookmarks.

It only takes links that are entries. A link inside a sentence, or in a
page's navigation, is a citation rather than something you saved:

| In | An entry is | Left out |
|---|---|---|
| Markdown, text | a list item, a heading, or a line that is nothing but the link | a link inside a sentence, and anything indented under a list item |
| HTML | a link leading its own list item, or filling its own paragraph | a link mid-sentence, and anything in a `nav`, `header` or `footer` |

A file of two hundred links costs no requests for its bookmarks and one
request per fifty for its videos. Progress shows as it goes.

## Google Drive sync

`Link Google Drive` asks for `drive.file`, the narrowest Drive access Google
offers. Yeetlist can see only the files it created, and never the rest of
your Drive.

It keeps two files: `yeetlist.md` for videos and bookmarks, and
`yeetnotes.md` for notes. It writes as you edit and checks for changes made
on your other devices. Linking a second device finds the same files and
merges, so something added on the phone shows up on the laptop. Deletions
travel too.

**Offline** everything still works. Changes made without a connection are
sent once it comes back, after reading what your other devices did first, so
neither side overwrites the other.

**If the link drops,** a message says why, how long the link had lasted and
how long earlier links lasted, and stays until you close it or link again.
Error messages carry a copy button, for pasting into a report.

## The Android app

The app shows the live site in its own window, using the web engine built
into Android. No browser app is involved, and your lists and Google link live
in the app's own storage.

- **Sign-in** goes through Android's own Google account picker.
- **Share** a link from any app to add it.
- **Updates** arrive through the app itself: it checks on launch and offers
  the newest build. **Check for Updates** in the Download menu asks now.
- **Offline** it opens from the copy it keeps. The very first launch needs a
  connection, and waits for one if there is none.

Everything inside the app updates with the website, with no new install. A
new APK is only needed when the app's own window changes.

## Running it locally

```bash
npm run dev
```

That serves the app and the API on http://localhost:3000. There is nothing
to install and nothing to compile.

To use YouTube details and Drive locally, copy `.env.example` to `.env.local`
and fill in what you want. Every variable is optional.

## Deploying

Push to a repository and import it into Vercel. There is no build command and
no output directory to set. Then set the environment variables:

| Variable | What it buys |
|---|---|
| `YOUTUBE_API_KEY` | Duration and upload date. Without it a video still gets its title and channel. |
| `GOOGLE_CLIENT_ID` | The Drive button. Without it everything stays on the device. |
| `GOOGLE_CLIENT_SECRET` | With the next one, a link that lasts rather than one that needs a click each hour. |
| `SESSION_SECRET` | Encrypts the stored link. Any long random string. Changing it signs every device out. |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

In the Google Cloud console:

- Leave `YOUTUBE_API_KEY` **unrestricted by HTTP referrer**. It is used by
  the server, which sends no referrer.
- Add your site and `http://localhost:3000` to the web client's
  **Authorized JavaScript origins**, and both callback addresses to
  **Authorized redirect URIs**:
  ```
  http://localhost:3000/api/oauth/callback
  https://YOUR-DEPLOYMENT/api/oauth/callback
  ```
- Set the consent screen's **Publishing status** to **In production**. While
  it says Testing, Google ends every link after 7 days.
- For the Android app, add an **Android** OAuth client in the same project,
  with the package `app.yeetlist.twa` and the SHA-1 of the signing key. Every
  Android build prints that SHA-1.

The Android APK is built by GitHub Actions on every push to `main`, signed
with a key held in the repository's secrets, and published as a release.

## How it is put together

| File | What it holds |
|---|---|
| `index.html` | The whole document, including the icon set. |
| `styles.css` | A token layer, then the components. Every number comes from a published scale. |
| `app.js` | State, rendering, filters, pages, upload, download and messages. |
| `drive.js` | The Google link and the Drive calls. |
| `notes.js`, `notes-ui.js` | The notes list and its editor. |
| `sw.js` | Keeps a copy of the app for offline use. |
| `api/*.js` | Video details, a page's name, playlists, and the app's settings. |
| `api/oauth/*.js` | Starting, finishing, renewing and ending a Google link, including the Android app's own door. |
| `api/_session.js` | Sealing the stored link, and talking to Google. |
| `android/` | The Android app: one window, plus sign-in, shares, saving and the updater. |
| `tools/` | The icon makers, the release tidier, and the checks. |

## Checks

```bash
npm run check
```

Every commit runs the full set of checks in `.githooks/pre-commit`: syntax,
layout rules, sync, the Android app's agreement with the page, and the brand
mark's copies agreeing with its one source.

## Privacy

Your lists are yours. They live on your device and, if you link it, in two
files in your own Google Drive. There is no account, no database and no
server storing anything. See [privacy.html](privacy.html).
