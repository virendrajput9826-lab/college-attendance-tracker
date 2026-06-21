# College Attendance Tracker

A local-first college attendance tracker that tries to fetch a student's timetable and academic calendar from the web, then lets the student track lecture-wise attendance and attendance risk.

## What It Does

- Collects student setup details:
  - college name
  - course
  - branch
  - semester
  - section
- Attempts live web extraction for:
  - official college sources
  - timetable candidates
  - academic calendar candidates
  - semester dates
  - holiday/no-class dates
- Lets the user review extracted data before generating lecture sessions
- Generates lecture sessions from weekly timetable plus semester calendar
- Supports:
  - lecture-wise attendance marking
  - subject-wise attendance
  - overall attendance
  - holidays
  - extra classes
  - cancelled classes

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Parsing:
  - Cheerio for HTML parsing
  - pdf-parse for PDF text extraction
- Date logic: date-fns

## Project Structure

```text
.
├── public/
├── server/
│   └── index.js
├── src/
│   ├── main.jsx
│   └── styles.css
├── index.html
├── package.json
└── README.md
```

## Run Locally

Install dependencies:

```bash
npm install
```

Start the extraction backend:

```bash
npm run server
```

Start the frontend:

```bash
npm run dev
```

Open:

- App: `http://127.0.0.1:5173/`
- Extraction API: `http://localhost:4174/api/extract`

## Current Behavior

The app performs real web fetching through the backend. It does not rely only on mocked UI steps anymore.

Current extraction flow:

1. Search for likely timetable/calendar pages using the setup details
2. Fetch candidate HTML pages or PDFs
3. Rank sources
4. Extract timetable slots, semester dates, and holidays
5. Ask the user to review before generating lecture sessions

## Current Limitations

- Extraction is real, but heuristics are still basic
- Some colleges may return weak or partial timetable/calendar data
- Official timetable formats differ a lot across institutions
- College-specific parsers are not implemented yet
- API integrations for official institutional systems are not implemented yet

## Recommended Next Improvements

- Add college-specific source filters and parsers
- Add PDF-first handling for academic calendar documents
- Add OCR path for image/scanned timetable uploads
- Add confidence scoring per extracted field
- Add persistence using SQLite instead of only frontend local storage

## Scripts

- `npm run dev` - start frontend
- `npm run server` - start extraction backend
- `npm run build` - production build

## License

MIT
