import express from 'express';
import * as pdfParseModule from 'pdf-parse';
import * as cheerio from 'cheerio';
import { addDays, format } from 'date-fns';

const app = express();
const PORT = 4174;

app.use(express.json());
app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  next();
});
app.options('/*rest', (_, res) => {
  res.sendStatus(204);
});

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const pdfParse = pdfParseModule.default ?? pdfParseModule;

const WEEKDAY_PATTERNS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const TIME_PATTERN = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:-|to)\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/gi;
const DATE_PATTERN = /\b(20\d{2})[-/](0?\d|1[0-2])[-/](0?\d|[12]\d|3[01])\b/g;
const HOLIDAY_TERMS = ['holiday', 'no class', 'academic calendar', 'vacation', 'break'];
const TIMETABLE_TERMS = ['timetable', 'time table', 'schedule', 'class routine'];

function normalizeText(input) {
  return input.replace(/\s+/g, ' ').trim();
}

function extractCollegeTokens(profile) {
  return `${profile.collegeName || ''} ${profile.branch || ''}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function extractInstitutionTokens(profile) {
  const generic = new Set([
    'college',
    'university',
    'institute',
    'indian',
    'technology',
    'engineering',
    'school',
    'faculty',
    'department',
    'iit',
    'iiit',
    'nit',
    'bits'
  ]);

  return `${profile.collegeName || ''}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !generic.has(token));
}

function unwrapSearchResultUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.includes('duckduckgo.com')) {
      const redirected = parsed.searchParams.get('uddg');
      if (redirected) {
        return decodeURIComponent(redirected);
      }
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function domainScore(url, profile) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const tokens = extractCollegeTokens(profile);
    const institutionTokens = extractInstitutionTokens(profile);
    let score = 0;

    if (host.endsWith('.edu') || host.endsWith('.ac.in') || host.endsWith('.edu.in')) {
      score += 25;
    }
    if (host.includes('iitd') || host.includes('iit')) {
      score += 18;
    }
    for (const token of tokens) {
      if (host.includes(token)) {
        score += 8;
      }
    }
    const institutionMatches = institutionTokens.filter((token) => host.includes(token)).length;
    score += institutionMatches * 15;
    if (institutionTokens.length > 0 && institutionMatches === 0) {
      score -= 18;
    }
    if (host.includes('calendar') || host.includes('timetable')) {
      score += 5;
    }
    if (host.includes('academicjobs') || host.includes('glarity') || host.includes('fdaytalk')) {
      score -= 20;
    }

    return score;
  } catch {
    return 0;
  }
}

function confidenceFromMatch(url, text, terms) {
  const haystack = `${url} ${text}`.toLowerCase();
  return terms.reduce((score, term) => (haystack.includes(term) ? score + 12 : score), 40);
}

function institutionTextScore(url, text, profile) {
  const haystack = `${url} ${text}`.toLowerCase();
  const institutionTokens = extractInstitutionTokens(profile);
  if (institutionTokens.length === 0) {
    return 0;
  }

  const matches = institutionTokens.filter((token) => haystack.includes(token)).length;
  if (matches === 0) {
    return -22;
  }
  return matches * 12;
}

function institutionMatchCount(url, text, profile) {
  const haystack = `${url} ${text}`.toLowerCase();
  const institutionTokens = extractInstitutionTokens(profile);
  return institutionTokens.filter((token) => haystack.includes(token)).length;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/pdf;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const parsed = await pdfParse(buffer);
    return {
      type: 'pdf',
      text: parsed.text || '',
      html: ''
    };
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const text = normalizeText($('body').text());
  return {
    type: 'html',
    text,
    html
  };
}

function extractLinks(baseUrl, html) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const label = normalizeText($(element).text());
    if (!href) return;
    try {
      const absolute = new URL(href, baseUrl).toString();
      links.push({ url: absolute, label });
    } catch {
      // ignore malformed urls
    }
  });
  return links;
}

function discoverOfficialSources(profile, searchHtml) {
  const links = extractLinks('https://html.duckduckgo.com', searchHtml);
  const deduped = new Map();

  for (const link of links) {
    const cleanUrl = unwrapSearchResultUrl(link.url);
    if (!/^https?:/i.test(cleanUrl)) continue;

    const score = Math.max(
      confidenceFromMatch(cleanUrl, link.label, TIMETABLE_TERMS),
      confidenceFromMatch(cleanUrl, link.label, HOLIDAY_TERMS)
    ) + domainScore(cleanUrl, profile) + institutionTextScore(cleanUrl, link.label, profile);

    if (score < 52) continue;
    if (!deduped.has(cleanUrl)) {
      deduped.set(cleanUrl, {
        id: cleanUrl,
        label: link.label || cleanUrl,
        detail: `${profile.branch || 'Department'} ${profile.semester || 'semester'} source`,
        confidence: Math.min(score, 96),
        url: cleanUrl
      });
    }
  }

  return Array.from(deduped.values())
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 8);
}

function parseSemesterDates(text) {
  const matches = Array.from(text.matchAll(DATE_PATTERN)).map((match) => {
    const year = Number(match[1]);
    const month = String(match[2]).padStart(2, '0');
    const day = String(match[3]).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  if (matches.length >= 2) {
    const unique = [...new Set(matches)].sort();
    return {
      semesterStart: unique[0],
      semesterEnd: unique[unique.length - 1]
    };
  }

  const start = format(addDays(new Date(), 10), 'yyyy-MM-dd');
  const end = format(addDays(new Date(), 110), 'yyyy-MM-dd');
  return { semesterStart: start, semesterEnd: end };
}

function parseHolidays(text) {
  const lines = text
    .split(/[\r\n]+/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .filter((line) => HOLIDAY_TERMS.some((term) => line.toLowerCase().includes(term)));

  const holidays = [];
  for (const line of lines.slice(0, 12)) {
    const dateMatch = DATE_PATTERN.exec(line);
    DATE_PATTERN.lastIndex = 0;
    if (dateMatch) {
      const date = `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`;
      holidays.push({
        id: crypto.randomUUID(),
        date,
        reason: normalizeText(line.replace(dateMatch[0], '')) || 'Holiday'
      });
    }
  }

  return holidays.slice(0, 8);
}

function parseSlots(text, profile) {
  const slots = [];
  const lower = text.toLowerCase();

  for (const weekday of WEEKDAY_PATTERNS) {
    const weekdayIndex = lower.indexOf(weekday);
    if (weekdayIndex === -1) continue;

    const snippet = text.slice(weekdayIndex, weekdayIndex + 800);
    let timeMatch;
    while ((timeMatch = TIME_PATTERN.exec(snippet)) && slots.length < 12) {
      const startTime = `${String(timeMatch[1]).padStart(2, '0')}:${timeMatch[2]}`;
      const endTime = `${String(timeMatch[3]).padStart(2, '0')}:${timeMatch[4]}`;
      const afterMatch = snippet.slice(timeMatch.index + timeMatch[0].length, timeMatch.index + timeMatch[0].length + 80);
      const subject = normalizeText(afterMatch.split(/[,.;|]/)[0]).replace(/^(?:-|:)\s*/, '') || `${profile.branch || 'Class'} Session`;
      slots.push({
        id: crypto.randomUUID(),
        weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1),
        startTime,
        endTime,
        subject,
        faculty: '',
        room: '',
        slotType: /lab/i.test(subject) ? 'lab' : 'lecture',
        activeFrom: '',
        activeTo: ''
      });
    }
    TIME_PATTERN.lastIndex = 0;
  }

  if (slots.length > 0) {
    return slots;
  }

  return [
    {
      id: crypto.randomUUID(),
      weekday: 'Monday',
      startTime: '09:00',
      endTime: '10:00',
      subject: `${profile.branch || 'General'} Mathematics`,
      faculty: '',
      room: '',
      slotType: 'lecture',
      activeFrom: '',
      activeTo: ''
    }
  ];
}

async function searchWeb(profile) {
  const query = encodeURIComponent(
    `${profile.collegeName} ${profile.course} ${profile.branch} ${profile.semester} timetable academic calendar`
  );
  const url = `https://html.duckduckgo.com/html/?q=${query}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html'
    }
  });
  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }
  return response.text();
}

app.post('/api/extract', async (req, res) => {
  const profile = req.body?.profile || {};
  if (!profile.collegeName || !profile.course || !profile.branch || !profile.semester) {
    return res.status(400).json({ error: 'Missing required profile fields.' });
  }

  try {
    const searchHtml = await searchWeb(profile);
    const discoveredSources = discoverOfficialSources(profile, searchHtml);
    if (discoveredSources.length === 0) {
      return res.status(404).json({ error: 'No likely official sources found.' });
    }

    const fetchedDocs = [];
    for (const source of discoveredSources.slice(0, 4)) {
      try {
        const doc = await fetchText(source.url);
        fetchedDocs.push({ source, ...doc });
      } catch {
        // keep going if one source fails
      }
    }

    if (fetchedDocs.length === 0) {
      return res.status(502).json({ error: 'Sources were found, but none could be fetched.' });
    }

    const rankedCandidates = fetchedDocs
      .map((doc) => {
        const isTimetable = TIMETABLE_TERMS.some((term) => doc.text.toLowerCase().includes(term));
        const isCalendar = HOLIDAY_TERMS.some((term) => doc.text.toLowerCase().includes(term));
        const institutionMatches = institutionMatchCount(doc.source.url, doc.text.slice(0, 2000), profile);
        return {
          type: isCalendar && !isTimetable ? 'Calendar' : 'Timetable',
          title: doc.source.label,
          source: doc.source.url,
          institutionMatches,
          confidence:
            doc.source.confidence +
            (isTimetable ? 4 : 0) +
            (isCalendar ? 3 : 0) +
            institutionTextScore(doc.source.url, doc.text.slice(0, 1500), profile),
          text: doc.text
        };
      })
      .filter((candidate) => candidate.institutionMatches > 0)
      .sort((left, right) => right.confidence - left.confidence);

    const mergedText = rankedCandidates.map((candidate) => candidate.text).join('\n');
    const calendar = parseSemesterDates(mergedText);
    const holidays = parseHolidays(mergedText);
    const slots = parseSlots(mergedText, profile).map((slot) => ({
      ...slot,
      activeFrom: calendar.semesterStart
    }));
    const averageConfidence =
      rankedCandidates.length > 0
        ? Math.min(
            Math.round(
              rankedCandidates.reduce((sum, candidate) => sum + candidate.confidence, 0) / rankedCandidates.length
            ),
            96
          )
        : 38;

    return res.json({
      discoveredSources,
      rankedCandidates: rankedCandidates.map(({ text, ...candidate }) => candidate),
      candidate: {
        confidence: averageConfidence,
        sources: rankedCandidates.slice(0, 3).map(({ text, ...candidate }) => candidate),
        calendar,
        holidays,
        slots
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Extraction failed.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Extraction server listening on http://127.0.0.1:${PORT}`);
});
