# College Attendance Tracker

A mobile-friendly local-first attendance tracker built with React, Vite, and PWA support.

## What It Does

- stores student attendance data locally in the browser
- supports weekly timetable setup and semester date ranges
- generates lecture sessions from timetable slots
- tracks present/absent attendance per lecture
- shows overall and subject-wise attendance status
- supports upload-based timetable extraction with editable review
- supports web-based college timetable/calendar discovery

## Current Architecture

- Frontend: React + Vite
- Local storage layer: Dexie / IndexedDB foundation
- PWA: `vite-plugin-pwa`
- Serverless extraction endpoint: `api/extract.js`
- Optional rate limit: Upstash Redis

## Vision Provider Support

Upload extraction can use user-supplied API credentials for:

- Anthropic
- OpenAI
- Google Gemini

The user can choose:

- provider
- model
- API key

inside the setup screen before running upload extraction.

## Project Structure

```text
.
├── api/
│   └── extract.js
├── public/
│   ├── icon.svg
│   └── manifest.json
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── styles.css
│   ├── db/
│   │   └── db.js
│   ├── extraction/
│   │   ├── visionExtract.js
│   │   └── webSearch.js
│   └── logic/
│       ├── attendanceCalc.js
│       └── slotGenerator.js
├── index.html
├── package.json
├── vercel.json
└── vite.config.js
```

## Run Locally

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

Open:

- App: `http://127.0.0.1:5173/`

## Build

```bash
npm run build
```

This generates the production build and PWA service worker.

## Deploy To Vercel

1. Push this repo to GitHub
2. Import the repo into Vercel
3. Deploy

Optional environment variables for rate limiting:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

There is no required provider API key in Vercel if you want end users to bring their own key in the UI.

## Notes

- The old local Express backend still exists in `server/index.js` for local experimentation, but Vercel deployment uses `api/extract.js`
- Upload extraction is the main path that uses provider/model/API key selection
- Web extraction does not require a vision API key

## License

MIT
