import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import * as pdfParseModule from 'pdf-parse';
import * as cheerio from 'cheerio';

const ratelimit =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(8, '1 d')
      })
    : null;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const pdfParse = pdfParseModule.default ?? pdfParseModule;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_PATTERNS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const TIME_PATTERN = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:-|to)\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/gi;
const DATE_PATTERN = /\b(20\d{2})[-/](0?\d|1[0-2])[-/](0?\d|[12]\d|3[01])\b/g;
const HOLIDAY_TERMS = ['holiday', 'no class', 'academic calendar', 'vacation', 'break'];
const TIMETABLE_TERMS = ['timetable', 'time table', 'schedule', 'class routine'];

function normalizeText(input = '') {
  return input.replace(/\s+/g, ' ').trim();
}

function capitalize(word = '') {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : '';
}

function todayPlus(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function randomId(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
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
    'campus'
  ]);

  return `${profile.collegeName || ''}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !generic.has(token));
}

function extractCollegeTokens(profile) {
  return `${profile.collegeName || ''} ${profile.branch || ''}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
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

function confidenceFromMatch(url, text, terms) {
  const haystack = `${url} ${text}`.toLowerCase();
  return terms.reduce((score, term) => (haystack.includes(term) ? score + 12 : score), 40);
}

function institutionTextScore(url, text, profile) {
  const haystack = `${url} ${text}`.toLowerCase();
  const institutionTokens = extractInstitutionTokens(profile);
  if (institutionTokens.length === 0) return 0;
  const matches = institutionTokens.filter((token) => haystack.includes(token)).length;
  if (matches === 0) return -22;
  return matches * 12;
}

function institutionMatchCount(url, text, profile) {
  const haystack = `${url} ${text}`.toLowerCase();
  const institutionTokens = extractInstitutionTokens(profile);
  return institutionTokens.filter((token) => haystack.includes(token)).length;
}

function domainScore(url, profile) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const tokens = extractCollegeTokens(profile);
    const institutionTokens = extractInstitutionTokens(profile);
    let score = 0;

    if (host.endsWith('.edu') || host.endsWith('.ac.in') || host.endsWith('.edu.in')) score += 25;
    for (const token of tokens) {
      if (host.includes(token)) score += 8;
    }
    const institutionMatches = institutionTokens.filter((token) => host.includes(token)).length;
    score += institutionMatches * 15;
    if (institutionTokens.length > 0 && institutionMatches === 0) score -= 18;
    if (host.includes('calendar') || host.includes('timetable')) score += 5;
    return score;
  } catch {
    return 0;
  }
}

function extractLinks(baseUrl, html) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const label = normalizeText($(element).text());
    if (!href) return;
    try {
      links.push({ url: new URL(href, baseUrl).toString(), label });
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

    const score =
      Math.max(
        confidenceFromMatch(cleanUrl, link.label, TIMETABLE_TERMS),
        confidenceFromMatch(cleanUrl, link.label, HOLIDAY_TERMS)
      ) +
      domainScore(cleanUrl, profile) +
      institutionTextScore(cleanUrl, link.label, profile);

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
    .slice(0, 6);
}

async function searchWeb(profile) {
  const query = encodeURIComponent(
    `${profile.collegeName || ''} ${profile.course || ''} ${profile.branch || ''} ${profile.semester || ''} timetable academic calendar`
  );
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html' }
  });
  if (!response.ok) throw new Error(`Search failed: ${response.status}`);
  return response.text();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/pdf;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const parsed = await pdfParse(buffer);
    return { type: 'pdf', text: parsed.text || '', html: '' };
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return {
    type: 'html',
    text: normalizeText($('body').text()),
    html
  };
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
    return { semesterStart: unique[0], semesterEnd: unique[unique.length - 1] };
  }

  return { semesterStart: todayPlus(10), semesterEnd: todayPlus(110) };
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
      holidays.push({
        id: randomId('holiday'),
        date: `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`,
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
    while ((timeMatch = TIME_PATTERN.exec(snippet)) && slots.length < 18) {
      const startTime = `${String(timeMatch[1]).padStart(2, '0')}:${timeMatch[2]}`;
      const endTime = `${String(timeMatch[3]).padStart(2, '0')}:${timeMatch[4]}`;
      const afterMatch = snippet.slice(timeMatch.index + timeMatch[0].length, timeMatch.index + timeMatch[0].length + 80);
      const subject = normalizeText(afterMatch.split(/[,.;|]/)[0]).replace(/^(?:-|:)\s*/, '') || `${profile.branch || 'Class'} Session`;
      slots.push({
        id: randomId('slot'),
        weekday: capitalize(weekday),
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

  return slots;
}

function normalizeVisionSlots(rawSlots = [], profile = {}) {
  return rawSlots
    .map((slot) => {
      const weekdayMap = {
        mon: 'Monday',
        tue: 'Tuesday',
        wed: 'Wednesday',
        thu: 'Thursday',
        fri: 'Friday',
        sat: 'Saturday'
      };
      const dayKey = String(slot.day || '').slice(0, 3).toLowerCase();
      const weekday = weekdayMap[dayKey] || (WEEKDAYS.includes(slot.day) ? slot.day : 'Monday');
      return {
        id: randomId('slot'),
        weekday,
        startTime: slot.start_time || slot.startTime || '09:00',
        endTime: slot.end_time || slot.endTime || '10:00',
        subject: slot.subject || `${profile.branch || 'Class'} Session`,
        faculty: '',
        room: slot.room || '',
        slotType: ['lecture', 'lab', 'tutorial'].includes(slot.type) ? slot.type : 'lecture',
        activeFrom: '',
        activeTo: ''
      };
    })
    .filter((slot) => slot.subject);
}

function buildCandidatePayload({ profile, slots, calendar, holidays, discoveredSources, rankedCandidates, confidence }) {
  const safeCalendar = calendar || { semesterStart: todayPlus(10), semesterEnd: todayPlus(110) };
  const safeSlots = (slots || []).map((slot) => ({
    ...slot,
    id: slot.id || randomId('slot'),
    activeFrom: slot.activeFrom || safeCalendar.semesterStart,
    activeTo: slot.activeTo || ''
  }));

  return {
    discoveredSources: discoveredSources || [],
    rankedCandidates: rankedCandidates || [],
    candidate: {
      confidence: confidence || 80,
      sources: (rankedCandidates || []).slice(0, 3),
      calendar: safeCalendar,
      holidays: holidays || [],
      slots: safeSlots.length > 0
        ? safeSlots
        : [
            {
              id: randomId('slot'),
              weekday: 'Monday',
              startTime: '09:00',
              endTime: '10:00',
              subject: `${profile.branch || 'Class'} Session`,
              faculty: '',
              room: '',
              slotType: 'lecture',
              activeFrom: safeCalendar.semesterStart,
              activeTo: ''
            }
          ]
    }
  };
}

async function parseProviderResponse(provider, response) {
  if (provider === 'openai') {
    return response?.choices?.[0]?.message?.content || '';
  }
  if (provider === 'google') {
    return response?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  }
  return response?.content?.[0]?.text || '';
}

async function callVisionModel({ provider, model, apiKey, imageBase64, mediaType, prompt, textOnly }) {
  if (!apiKey) throw new Error('Missing API key for selected provider.');

  if (provider === 'openai') {
    const body = {
      model: model || 'gpt-4.1-mini',
      messages: [
        {
          role: 'user',
          content: textOnly
            ? [{ type: 'text', text: prompt }]
            : [
                { type: 'input_text', text: prompt },
                {
                  type: 'input_image',
                  image_url: `data:${mediaType};base64,${imageBase64}`
                }
              ]
        }
      ]
    };
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    return response.json();
  }

  if (provider === 'google') {
    const parts = textOnly
      ? [{ text: prompt }]
      : [
          { inlineData: { mimeType: mediaType, data: imageBase64 } },
          { text: prompt }
        ];
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-flash'}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] })
      }
    );
    return response.json();
  }

  const messages = textOnly
    ? [{ role: 'user', content: prompt }]
    : [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 }
            },
            { type: 'text', text: prompt }
          ]
        }
      ];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-3-5-sonnet-latest',
      max_tokens: 1200,
      messages
    })
  });
  return response.json();
}

function buildVisionPrompt() {
  return `You are a timetable parser. Extract every lecture slot from this image or document.
Return ONLY valid JSON, no markdown:
{"slots":[{"subject":"","day":"Mon","start_time":"09:00","end_time":"10:00","room":"","type":"lecture"}],"semesterStart":null,"semesterEnd":null,"holidays":[{"date":"2026-01-26","reason":"Holiday"}]}
Rules:
- day must be Mon Tue Wed Thu Fri Sat
- use 24hr HH:MM time
- merged labs should be one row with full duration
- skip breaks and free periods
- type must be lecture, lab, or tutorial
- use empty string or null when unclear`;
}

function buildTextPrompt(text) {
  return `Extract timetable structure from this text.
${text}

Return ONLY valid JSON:
{"slots":[{"subject":"","day":"Mon","start_time":"09:00","end_time":"10:00","room":"","type":"lecture"}],"semesterStart":null,"semesterEnd":null,"holidays":[{"date":"2026-01-26","reason":"Holiday"}]}`;
}

function parseJsonSafely(text) {
  const trimmed = String(text || '').trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) throw new Error('Model did not return JSON.');
  return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
}

async function handleWebExtraction(profile) {
  const searchHtml = await searchWeb(profile);
  const discoveredSources = discoverOfficialSources(profile, searchHtml);
  if (discoveredSources.length === 0) throw new Error('No likely official sources found.');

  const fetchedDocs = [];
  for (const source of discoveredSources.slice(0, 4)) {
    try {
      const doc = await fetchText(source.url);
      fetchedDocs.push({ source, ...doc });
    } catch {
      // keep going
    }
  }
  if (fetchedDocs.length === 0) throw new Error('Sources were found, but none could be fetched.');

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
  const slots = parseSlots(mergedText, profile).map((slot) => ({ ...slot, activeFrom: calendar.semesterStart }));
  const displaySources = rankedCandidates.map(({ text, institutionMatches, ...candidate }) => candidate);

  return buildCandidatePayload({
    profile,
    slots,
    calendar,
    holidays,
    discoveredSources,
    rankedCandidates: displaySources,
    confidence:
      displaySources.length > 0
        ? Math.min(Math.round(displaySources.reduce((sum, item) => sum + item.confidence, 0) / displaySources.length), 96)
        : 80
  });
}

async function handleUploadExtraction(body) {
  const { profile = {}, fileName = 'uploaded file', mimeType = '', contentBase64 = '', provider, model, apiKey } = body;
  if (!contentBase64) throw new Error('Missing upload content.');

  if (mimeType.includes('pdf') || fileName.toLowerCase().endsWith('.pdf')) {
    const parsed = await pdfParse(Buffer.from(contentBase64, 'base64'));
    const text = parsed.text || '';
    const calendar = parseSemesterDates(text);
    const holidays = parseHolidays(text);
    const slots = parseSlots(text, profile).map((slot) => ({ ...slot, activeFrom: calendar.semesterStart }));
    return buildCandidatePayload({
      profile,
      slots,
      calendar,
      holidays,
      discoveredSources: [
        {
          id: randomId('upload'),
          label: fileName,
          detail: 'Uploaded PDF',
          confidence: 84,
          url: `Uploaded file: ${fileName}`
        }
      ],
      rankedCandidates: [
        {
          type: 'Timetable',
          title: fileName,
          source: `Uploaded file: ${fileName}`,
          confidence: 84
        }
      ],
      confidence: 84
    });
  }

  const providerResponse = await callVisionModel({
    provider: provider || 'anthropic',
    model,
    apiKey,
    imageBase64: contentBase64,
    mediaType: mimeType || 'image/png',
    prompt: buildVisionPrompt(),
    textOnly: false
  });
  const text = await parseProviderResponse(provider || 'anthropic', providerResponse);
  const parsed = parseJsonSafely(text);
  const slots = normalizeVisionSlots(parsed.slots, profile);
  const calendar = {
    semesterStart: parsed.semesterStart || todayPlus(10),
    semesterEnd: parsed.semesterEnd || todayPlus(110)
  };
  const holidays = Array.isArray(parsed.holidays)
    ? parsed.holidays.map((holiday) => ({
        id: randomId('holiday'),
        date: holiday.date || todayPlus(20),
        reason: holiday.reason || 'Holiday'
      }))
    : [];

  return buildCandidatePayload({
    profile,
    slots,
    calendar,
    holidays,
    discoveredSources: [
      {
        id: randomId('upload'),
        label: fileName,
        detail: `${provider || 'anthropic'} vision extraction`,
        confidence: 82,
        url: `Uploaded file: ${fileName}`
      }
    ],
    rankedCandidates: [
      {
        type: 'Timetable',
        title: fileName,
        source: `Uploaded file: ${fileName}`,
        confidence: 82
      }
    ],
    confidence: 82
  });
}

async function handleDirectVision(body) {
  const { profile = {}, provider, model, apiKey, imageBase64, mediaType = 'image/png', htmlText = '' } = body;
  const prompt = imageBase64 ? buildVisionPrompt() : buildTextPrompt(htmlText);
  const providerResponse = await callVisionModel({
    provider: provider || 'anthropic',
    model,
    apiKey,
    imageBase64,
    mediaType,
    prompt,
    textOnly: !imageBase64
  });
  const text = await parseProviderResponse(provider || 'anthropic', providerResponse);
  const parsed = parseJsonSafely(text);
  const slots = normalizeVisionSlots(parsed.slots, profile);
  return buildCandidatePayload({
    profile,
    slots,
    calendar: {
      semesterStart: parsed.semesterStart || todayPlus(10),
      semesterEnd: parsed.semesterEnd || todayPlus(110)
    },
    holidays: Array.isArray(parsed.holidays)
      ? parsed.holidays.map((holiday) => ({
          id: randomId('holiday'),
          date: holiday.date || todayPlus(20),
          reason: holiday.reason || 'Holiday'
        }))
      : [],
    discoveredSources: [],
    rankedCandidates: [
      {
        type: imageBase64 ? 'Timetable' : 'Calendar',
        title: `${provider || 'anthropic'} ${model || 'default model'}`,
        source: 'Direct model extraction',
        confidence: 80
      }
    ],
    confidence: 80
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  try {
    if (ratelimit) {
      const ipHeader = req.headers['x-forwarded-for'];
      const ip = Array.isArray(ipHeader) ? ipHeader[0] : ipHeader || 'anonymous';
      const { success } = await ratelimit.limit(ip);
      if (!success) {
        return res.status(429).json({ error: 'Limit reached, try tomorrow.' });
      }
    }

    const body = req.body || {};
    const route = body.route || body.method || 'web';

    if (route === 'web') {
      return res.status(200).json(await handleWebExtraction(body.profile || body.query || {}));
    }

    if (route === 'upload') {
      return res.status(200).json(await handleUploadExtraction(body));
    }

    if (route === 'vision') {
      return res.status(200).json(await handleDirectVision(body));
    }

    return res.status(400).json({ error: 'Unsupported extraction route.' });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Extraction failed.'
    });
  }
}
