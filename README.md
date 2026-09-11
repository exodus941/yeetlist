# YeeTlist

A YouTube-dark-mode, browser-based personal watchlist designed to deploy on Vercel.

## Run and deploy

This project has no build step. Deploy this folder to Vercel, then optionally set `YOUTUBE_API_KEY` in the Vercel project environment. With the key, the `/api/video` serverless endpoint retrieves title, primary channel, duration, and publication timestamp using YouTube Data API v3. Without it, it uses YouTube oEmbed for title/channel only.

For the local preview, copy `.env.example` to `.env.local`, put your key after `YOUTUBE_API_KEY=`, then restart `npm run dev`. Do not commit `.env.local`.

## Portable Dropbox copy

Use **Export .md** to write `yeetlist.md` inside a folder Dropbox syncs, and **Import** it on another device. The Markdown file contains readable export information plus a JSON payload so imports remain lossless.

Browsers cannot silently write to a local Dropbox folder; that is a browser security boundary. To achieve automatic background sync, connect the app to Dropbox OAuth and use its Files API (store the app's Dropbox refresh token only in Vercel environment variables, never in browser code). The import/export flow is deliberately ready for that later addition.
