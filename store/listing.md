# Play Store listing

Copy from here into Play Console. Every length below is measured against the
field's own limit, and the count is in brackets.

## App name (30)

```
YeeTlist
```

(8)

## Short description (80)

```
A watchlist for YouTube links, and a home for every other bookmark.
```

(67)

## Full description (4000)

```
YeeTlist keeps two lists. One holds YouTube links, with the title, the channel
and the runtime fetched for you. The other holds every bookmark that is not a
video. A link goes to the right list on its own, so there is nothing to file.

Share to it from anywhere. Any app that can share a link can send one here: a
browser, YouTube, a chat. The link is added while you carry on with what you
were doing.

Find things again.

• Tag anything, and filter by tag
• Rate a link out of five, half stars included, and filter by rating
• Search titles, channels, addresses and tags at once
• Sort by name, channel, runtime, upload date, date added or rating
• Paste a playlist and every video in it is added

It works with no connection. The list lives on the device, so it opens and
reads the same on a train as at a desk.

Sync is optional, and narrow. Connecting Google Drive keeps one list across
your devices. It asks for the narrowest Drive permission Google offers, which
reaches only the single file this app writes and nothing else you own. There
is no account to make, no server holding your list and no tracking of any
kind.

Export whenever you like. The whole library writes out as a Markdown file you
can read anywhere.
```

(1224)

## Category

Productivity

## Contact and policy

- Privacy policy: https://yeetlist.vercel.app/privacy.html
- Website: https://yeetlist.vercel.app
- Support: https://github.com/exodus941/yeetlist/issues

## Graphics

| Asset | Where | Status |
|---|---|---|
| App icon 512x512 | `icons/icon-512.png` | generated |
| Feature graphic 1024x500 | `store/feature-1024x500.png` | generated |
| Phone screenshots, 4 | `store/screenshots/` | taken on the device |

Every screenshot is 1080x1920, which is 9:16 exactly. Play asks for that ratio
with each side between 320 and 3840 pixels, and a phone's own 1080x2400 is
9:20. The emulator was set to `wm size 1080x1920` and `wm density 380` rather
than cropping, so nothing is cut off.

| File | What it shows |
|---|---|
| `1-watchlist.png` | the watchlist with tags and ratings on each row |
| `2-filters.png` | search, the tag filter and the rating filter, open |
| `3-rating-filter.png` | the rating filter's own menu |
| `4-bookmarks.png` | the second list, for links that are not videos |

**THE SCREENSHOTS ARE THE ONE THING A GENERATOR CANNOT HONESTLY MAKE.** Play
wants pictures of the app as it runs, and a mockup drawn beside it would be a
picture of something nobody can install. These were taken from the signed APK
running on an Android 14 emulator, with data added through the app itself.

## Data safety form

| Question | Answer |
|---|---|
| Does your app collect or share any user data? | No |
| Is all user data encrypted in transit? | Yes, the site is HTTPS only |
| Do you provide a way to request data deletion? | Yes, the policy page says how |

The Drive file belongs to the reader's own account and is written by their own
credentials, so nothing is collected by this app. The token is held on the
device.

## Content rating

Answer no to every question. There is no user-generated content shared with
others, no messaging, no purchases and no ads.
