import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  Check,
  ClipboardList,
  Clock,
  Edit3,
  FileUp,
  Gauge,
  Globe,
  Home,
  ListChecks,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import {
  addDays,
  differenceInCalendarDays,
  format,
  isAfter,
  isBefore,
  parseISO
} from 'date-fns';
import './styles.css';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SLOT_TYPES = ['lecture', 'lab', 'tutorial'];
const ATTENDANCE_STATUS = {
  present: 'Present',
  absent: 'Absent',
  unmarked: 'Unmarked',
  excused: 'Excused'
};

const extractionSteps = [
  {
    key: 'discover',
    title: 'Find official college sources',
    pending: 'Waiting to search official sources',
    running: 'Scanning official website, department notices, and academic calendar pages.',
    done: 'Official sources found'
  },
  {
    key: 'rank',
    title: 'Rank timetable and calendar candidates',
    pending: 'Waiting to rank source candidates',
    running: 'Comparing timetable and calendar matches for your branch, semester, and section.',
    done: 'Candidates ranked'
  },
  {
    key: 'extract',
    title: 'Extract weekly slots, semester dates, and holidays',
    pending: 'Waiting to extract structured data',
    running: 'Parsing timetable slots, semester range, and no-class dates.',
    done: 'Structured data extracted'
  },
  {
    key: 'review',
    title: 'Ask for review before generating lectures',
    pending: 'Waiting to prepare review',
    running: 'Preparing editable review before lectures are generated.',
    done: 'Ready for review'
  }
];

const todayISO = () => format(new Date(), 'yyyy-MM-dd');
const isStaticDemo =
  import.meta.env.VITE_STATIC_DEMO === 'true' ||
  (typeof window !== 'undefined' && window.location.hostname.endsWith('github.io'));

const seedState = {
  profile: {
    collegeName: '',
    course: '',
    branch: '',
    semester: '',
    section: '',
    thresholdPct: 75
  },
  calendar: {
    semesterStart: todayISO(),
    semesterEnd: format(addDays(new Date(), 95), 'yyyy-MM-dd')
  },
  holidays: [
    {
      id: crypto.randomUUID(),
      date: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
      reason: 'Academic holiday'
    }
  ],
  slots: [
    {
      id: crypto.randomUUID(),
      weekday: 'Monday',
      startTime: '09:00',
      endTime: '10:00',
      subject: 'Mathematics',
      faculty: '',
      room: 'A-204',
      slotType: 'lecture',
      activeFrom: todayISO(),
      activeTo: ''
    },
    {
      id: crypto.randomUUID(),
      weekday: 'Monday',
      startTime: '10:00',
      endTime: '11:00',
      subject: 'Physics',
      faculty: '',
      room: 'Lab 1',
      slotType: 'lecture',
      activeFrom: todayISO(),
      activeTo: ''
    },
    {
      id: crypto.randomUUID(),
      weekday: 'Wednesday',
      startTime: '14:00',
      endTime: '16:00',
      subject: 'Programming Lab',
      faculty: '',
      room: 'CS Lab',
      slotType: 'lab',
      activeFrom: todayISO(),
      activeTo: ''
    }
  ],
  overrides: [],
  attendance: {}
};

function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setPersistentValue = (nextValue) => {
    setValue((current) => {
      const resolved = typeof nextValue === 'function' ? nextValue(current) : nextValue;
      localStorage.setItem(key, JSON.stringify(resolved));
      return resolved;
    });
  };

  return [value, setPersistentValue];
}

function generateSessions(slots, calendar, holidays, overrides) {
  const start = parseISO(calendar.semesterStart);
  const end = parseISO(calendar.semesterEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || isAfter(start, end)) {
    return [];
  }

  const holidayMap = new Map(holidays.map((holiday) => [holiday.date, holiday.reason]));
  const sessions = [];
  const totalDays = differenceInCalendarDays(end, start);

  for (let offset = 0; offset <= totalDays; offset += 1) {
    const date = addDays(start, offset);
    const isoDate = format(date, 'yyyy-MM-dd');
    const weekday = format(date, 'EEEE');
    const slotsForDay = slots.filter((slot) => {
      const activeFromOk = !slot.activeFrom || !isBefore(date, parseISO(slot.activeFrom));
      const activeToOk = !slot.activeTo || !isAfter(date, parseISO(slot.activeTo));
      return slot.weekday === weekday && activeFromOk && activeToOk;
    });

    for (const slot of slotsForDay) {
      const isHoliday = holidayMap.has(isoDate);
      sessions.push({
        id: `${isoDate}-${slot.id}`,
        slotId: slot.id,
        date: isoDate,
        weekday,
        subject: slot.subject,
        startTime: slot.startTime,
        endTime: slot.endTime,
        faculty: slot.faculty,
        room: slot.room,
        slotType: slot.slotType,
        status: isHoliday ? 'holiday' : 'scheduled',
        source: 'generated',
        note: isHoliday ? holidayMap.get(isoDate) : ''
      });
    }
  }

  for (const override of overrides) {
    if (override.type === 'cancelled') {
      const index = sessions.findIndex((session) => session.id === override.sessionId);
      if (index >= 0) {
        sessions[index] = {
          ...sessions[index],
          status: 'cancelled',
          source: 'override',
          note: override.reason || 'Cancelled'
        };
      }
    }

    if (override.type === 'extra') {
      sessions.push({
        id: override.id,
        slotId: null,
        date: override.date,
        weekday: format(parseISO(override.date), 'EEEE'),
        subject: override.subject,
        startTime: override.startTime,
        endTime: override.endTime,
        faculty: override.faculty || '',
        room: override.room || '',
        slotType: override.slotType || 'lecture',
        status: 'extra',
        source: 'manual',
        note: override.reason || 'Extra class'
      });
    }
  }

  return sessions.sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
}

function isValidDenominator(session, asOfDate = new Date()) {
  const sessionDate = parseISO(session.date);
  return !isAfter(sessionDate, asOfDate) && ['scheduled', 'extra', 'rescheduled'].includes(session.status);
}

function calculateAttendance(sessions, attendance, thresholdPct) {
  const validSessions = sessions.filter((session) => isValidDenominator(session));
  const presentSessions = validSessions.filter((session) => attendance[session.id] === 'present');
  const bySubjectMap = new Map();

  for (const session of validSessions) {
    if (!bySubjectMap.has(session.subject)) {
      bySubjectMap.set(session.subject, { subject: session.subject, total: 0, present: 0 });
    }
    const bucket = bySubjectMap.get(session.subject);
    bucket.total += 1;
    if (attendance[session.id] === 'present') {
      bucket.present += 1;
    }
  }

  const decorate = (row) => {
    const pct = row.total === 0 ? 100 : (row.present / row.total) * 100;
    const canMiss = calculateCanMiss(row.present, row.total, thresholdPct);
    const needAttend = calculateNeedAttend(row.present, row.total, thresholdPct);
    return {
      ...row,
      pct,
      canMiss,
      needAttend,
      status: pct >= thresholdPct + 5 ? 'safe' : pct >= thresholdPct ? 'watch' : 'danger'
    };
  };

  return {
    overall: decorate({
      subject: 'Overall',
      total: validSessions.length,
      present: presentSessions.length
    }),
    subjects: Array.from(bySubjectMap.values()).map(decorate).sort((a, b) => a.subject.localeCompare(b.subject)),
    validSessions
  };
}

function calculateCanMiss(present, total, thresholdPct) {
  const threshold = thresholdPct / 100;
  if (total === 0 || present / total < threshold) return 0;
  let misses = 0;
  while (present / (total + misses + 1) >= threshold) {
    misses += 1;
  }
  return misses;
}

function calculateNeedAttend(present, total, thresholdPct) {
  const threshold = thresholdPct / 100;
  if (total === 0 || present / total >= threshold) return 0;
  let needed = 0;
  while ((present + needed) / (total + needed) < threshold) {
    needed += 1;
    if (needed > 500) break;
  }
  return needed;
}

function App() {
  const [state, setState] = usePersistentState('college-attendance-state', seedState);
  const [activeTab, setActiveTab] = useState('today');
  const [selectedDate, setSelectedDate] = useState(todayISO());

  const sessions = useMemo(
    () => generateSessions(state.slots, state.calendar, state.holidays, state.overrides),
    [state.slots, state.calendar, state.holidays, state.overrides]
  );
  const analytics = useMemo(
    () => calculateAttendance(sessions, state.attendance, Number(state.profile.thresholdPct) || 75),
    [sessions, state.attendance, state.profile.thresholdPct]
  );

  const updateState = (patcher) => setState((current) => patcher(current));

  const markAttendance = (sessionId, status) => {
    updateState((current) => ({
      ...current,
      attendance: { ...current.attendance, [sessionId]: status }
    }));
  };

  const cancelSession = (session) => {
    updateState((current) => ({
      ...current,
      overrides: [
        ...current.overrides.filter((override) => override.sessionId !== session.id),
        {
          id: crypto.randomUUID(),
          type: 'cancelled',
          sessionId: session.id,
          reason: 'Cancelled by user'
        }
      ],
      attendance: { ...current.attendance, [session.id]: 'unmarked' }
    }));
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon"><ClipboardList size={22} /></div>
          <div>
            <strong>Attendance</strong>
            <span>Lecture-wise tracker</span>
          </div>
        </div>
        <nav>
          <TabButton icon={Home} label="Today" active={activeTab === 'today'} onClick={() => setActiveTab('today')} />
          <TabButton icon={Gauge} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <TabButton icon={CalendarDays} label="Week" active={activeTab === 'week'} onClick={() => setActiveTab('week')} />
          <TabButton icon={Edit3} label="Timetable" active={activeTab === 'timetable'} onClick={() => setActiveTab('timetable')} />
          <TabButton icon={Search} label="Setup" active={activeTab === 'setup'} onClick={() => setActiveTab('setup')} />
        </nav>
      </aside>

      <main className="main">
        {activeTab === 'today' && (
          <TodayView
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            sessions={sessions}
            attendance={state.attendance}
            markAttendance={markAttendance}
            cancelSession={cancelSession}
          />
        )}
        {activeTab === 'dashboard' && <Dashboard analytics={analytics} threshold={state.profile.thresholdPct} sessions={sessions} attendance={state.attendance} />}
        {activeTab === 'week' && (
          <WeekView
            sessions={sessions}
            attendance={state.attendance}
            markAttendance={markAttendance}
            cancelSession={cancelSession}
          />
        )}
        {activeTab === 'timetable' && (
          <TimetableView
            state={state}
            updateState={updateState}
            sessions={sessions}
          />
        )}
        {activeTab === 'setup' && <SetupView state={state} updateState={updateState} setActiveTab={setActiveTab} />}
      </main>
    </div>
  );
}

function TabButton({ icon: Icon, label, active, onClick }) {
  return (
    <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>
      <Icon size={19} />
      <span>{label}</span>
    </button>
  );
}

function TodayView({ selectedDate, setSelectedDate, sessions, attendance, markAttendance, cancelSession }) {
  const daySessions = sessions.filter((session) => session.date === selectedDate);
  const markAllPresent = () => {
    daySessions
      .filter((session) => ['scheduled', 'extra', 'rescheduled'].includes(session.status))
      .forEach((session) => markAttendance(session.id, 'present'));
  };

  return (
    <section className="screen">
      <ScreenHeader
        eyebrow="Daily attendance"
        title="Today"
        subtitle="Only real lecture slots generated from your timetable appear here."
        action={<input className="date-input" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />}
      />

      <div className="toolbar">
        <button className="primary-button" onClick={markAllPresent}><Check size={18} /> Mark all present</button>
        <span className="muted">{format(parseISO(selectedDate), 'EEEE, MMM d')}</span>
      </div>

      <LectureList
        sessions={daySessions}
        attendance={attendance}
        markAttendance={markAttendance}
        cancelSession={cancelSession}
      />
    </section>
  );
}

function Dashboard({ analytics, threshold, sessions, attendance }) {
  const todaysMarked = sessions.filter((session) => session.date === todayISO() && attendance[session.id] && attendance[session.id] !== 'unmarked').length;
  const todaysTotal = sessions.filter((session) => session.date === todayISO()).length;

  return (
    <section className="screen">
      <ScreenHeader
        eyebrow="Attendance insights"
        title="Dashboard"
        subtitle={`Threshold is set to ${threshold}%. Counts use valid lecture sessions till date.`}
      />

      <div className="metric-grid">
        <Metric label="Overall attendance" value={`${analytics.overall.pct.toFixed(1)}%`} tone={analytics.overall.status} />
        <Metric label="Attended / valid" value={`${analytics.overall.present}/${analytics.overall.total}`} />
        <Metric label="Can miss" value={analytics.overall.canMiss} />
        <Metric label="Marked today" value={`${todaysMarked}/${todaysTotal}`} />
      </div>

      <div className="panel">
        <div className="panel-title">
          <h2>Subject-wise</h2>
          <span>{analytics.subjects.length} subjects</span>
        </div>
        <div className="subject-list">
          {analytics.subjects.length === 0 && <EmptyState text="No valid lecture sessions yet." />}
          {analytics.subjects.map((subject) => (
            <div className="subject-row" key={subject.subject}>
              <div>
                <strong>{subject.subject}</strong>
                <span>{subject.present}/{subject.total} attended</span>
              </div>
              <div className="progress-wrap">
                <div className="progress-track"><div className={`progress-fill ${subject.status}`} style={{ width: `${Math.min(subject.pct, 100)}%` }} /></div>
                <small>{subject.pct.toFixed(1)}%</small>
              </div>
              <div className={`status-pill ${subject.status}`}>
                {subject.status === 'danger' ? `${subject.needAttend} needed` : `${subject.canMiss} can miss`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WeekView({ sessions, attendance, markAttendance, cancelSession }) {
  const start = new Date();
  const nextSeven = Array.from({ length: 7 }, (_, index) => format(addDays(start, index), 'yyyy-MM-dd'));

  return (
    <section className="screen">
      <ScreenHeader
        eyebrow="Calendar view"
        title="Upcoming week"
        subtitle="Backfill missed marking and review holidays, cancellations, and extra classes."
      />
      <div className="week-stack">
        {nextSeven.map((date) => (
          <div className="panel" key={date}>
            <div className="panel-title">
              <h2>{format(parseISO(date), 'EEE, MMM d')}</h2>
              <span>{sessions.filter((session) => session.date === date).length} lectures</span>
            </div>
            <LectureList
              compact
              sessions={sessions.filter((session) => session.date === date)}
              attendance={attendance}
              markAttendance={markAttendance}
              cancelSession={cancelSession}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function TimetableView({ state, updateState, sessions }) {
  const [draftSlot, setDraftSlot] = useState({
    weekday: 'Monday',
    startTime: '09:00',
    endTime: '10:00',
    subject: '',
    faculty: '',
    room: '',
    slotType: 'lecture',
    activeFrom: state.calendar.semesterStart,
    activeTo: ''
  });
  const [holidayDraft, setHolidayDraft] = useState({ date: todayISO(), reason: '' });
  const [extraDraft, setExtraDraft] = useState({ date: todayISO(), startTime: '09:00', endTime: '10:00', subject: '', slotType: 'lecture' });

  const addSlot = () => {
    if (!draftSlot.subject.trim()) return;
    updateState((current) => ({
      ...current,
      slots: [...current.slots, { ...draftSlot, id: crypto.randomUUID(), subject: draftSlot.subject.trim() }]
    }));
    setDraftSlot({ ...draftSlot, subject: '', faculty: '', room: '' });
  };

  const removeSlot = (id) => {
    updateState((current) => ({
      ...current,
      slots: current.slots.filter((slot) => slot.id !== id)
    }));
  };

  const addHoliday = () => {
    if (!holidayDraft.date) return;
    updateState((current) => ({
      ...current,
      holidays: [
        ...current.holidays.filter((holiday) => holiday.date !== holidayDraft.date),
        { id: crypto.randomUUID(), date: holidayDraft.date, reason: holidayDraft.reason || 'No class' }
      ]
    }));
    setHolidayDraft({ date: todayISO(), reason: '' });
  };

  const addExtra = () => {
    if (!extraDraft.subject.trim()) return;
    updateState((current) => ({
      ...current,
      overrides: [
        ...current.overrides,
        {
          ...extraDraft,
          id: crypto.randomUUID(),
          type: 'extra',
          subject: extraDraft.subject.trim()
        }
      ]
    }));
    setExtraDraft({ ...extraDraft, subject: '' });
  };

  return (
    <section className="screen">
      <ScreenHeader
        eyebrow="Source of truth"
        title="Timetable & exceptions"
        subtitle={`${sessions.length} lecture sessions generated from weekly slots and semester dates.`}
      />

      <div className="two-column">
        <div className="panel">
          <div className="panel-title"><h2>Semester calendar</h2><CalendarDays size={18} /></div>
          <div className="form-grid">
            <label>Start date<input type="date" value={state.calendar.semesterStart} onChange={(event) => updateState((current) => ({ ...current, calendar: { ...current.calendar, semesterStart: event.target.value } }))} /></label>
            <label>End date<input type="date" value={state.calendar.semesterEnd} onChange={(event) => updateState((current) => ({ ...current, calendar: { ...current.calendar, semesterEnd: event.target.value } }))} /></label>
          </div>
          <div className="inline-form">
            <input type="date" value={holidayDraft.date} onChange={(event) => setHolidayDraft({ ...holidayDraft, date: event.target.value })} />
            <input placeholder="Holiday reason" value={holidayDraft.reason} onChange={(event) => setHolidayDraft({ ...holidayDraft, reason: event.target.value })} />
            <button className="icon-button" onClick={addHoliday} aria-label="Add holiday"><Plus size={18} /></button>
          </div>
          <div className="chip-list">
            {state.holidays.map((holiday) => (
              <span className="chip" key={holiday.id}>{holiday.date} - {holiday.reason}</span>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title"><h2>Extra class</h2><Plus size={18} /></div>
          <div className="form-grid">
            <label>Date<input type="date" value={extraDraft.date} onChange={(event) => setExtraDraft({ ...extraDraft, date: event.target.value })} /></label>
            <label>Subject<input value={extraDraft.subject} onChange={(event) => setExtraDraft({ ...extraDraft, subject: event.target.value })} placeholder="Subject" /></label>
            <label>Start<input type="time" value={extraDraft.startTime} onChange={(event) => setExtraDraft({ ...extraDraft, startTime: event.target.value })} /></label>
            <label>End<input type="time" value={extraDraft.endTime} onChange={(event) => setExtraDraft({ ...extraDraft, endTime: event.target.value })} /></label>
          </div>
          <button className="secondary-button" onClick={addExtra}><Plus size={17} /> Add extra lecture</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title"><h2>Add weekly slot</h2><Clock size={18} /></div>
        <div className="slot-editor">
          <select value={draftSlot.weekday} onChange={(event) => setDraftSlot({ ...draftSlot, weekday: event.target.value })}>
            {WEEKDAYS.map((day) => <option key={day}>{day}</option>)}
          </select>
          <input type="time" value={draftSlot.startTime} onChange={(event) => setDraftSlot({ ...draftSlot, startTime: event.target.value })} />
          <input type="time" value={draftSlot.endTime} onChange={(event) => setDraftSlot({ ...draftSlot, endTime: event.target.value })} />
          <input placeholder="Subject" value={draftSlot.subject} onChange={(event) => setDraftSlot({ ...draftSlot, subject: event.target.value })} />
          <select value={draftSlot.slotType} onChange={(event) => setDraftSlot({ ...draftSlot, slotType: event.target.value })}>
            {SLOT_TYPES.map((type) => <option key={type}>{type}</option>)}
          </select>
          <button className="primary-button" onClick={addSlot}><Plus size={18} /> Add</button>
        </div>
      </div>

      <div className="timetable-grid">
        {WEEKDAYS.map((day) => (
          <div className="day-column" key={day}>
            <h3>{day}</h3>
            {state.slots.filter((slot) => slot.weekday === day).map((slot) => (
              <div className="slot-card" key={slot.id}>
                <div><strong>{slot.subject}</strong><span>{slot.startTime}-{slot.endTime}</span></div>
                <button className="icon-button quiet" onClick={() => removeSlot(slot.id)} aria-label="Delete slot"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

async function runExtraction(profile) {
  if (isStaticDemo) {
    const start = format(addDays(new Date(), 12), 'yyyy-MM-dd');
    const end = format(addDays(new Date(), 112), 'yyyy-MM-dd');
    const branch = profile.branch || 'Department';
    const semester = profile.semester || 'Current semester';
    const section = profile.section ? `Section ${profile.section}` : 'Selected section';

    return {
      discoveredSources: [
        {
          id: 'demo-official',
          label: `${profile.collegeName} official website`,
          detail: `${branch} ${semester} timetable source`,
          confidence: 91,
          url: 'Static demo source'
        },
        {
          id: 'demo-department',
          label: `${branch} department notice board`,
          detail: 'Department timetable notice',
          confidence: 87,
          url: 'Static demo source'
        },
        {
          id: 'demo-calendar',
          label: `${profile.collegeName} academic calendar`,
          detail: 'Semester dates and holidays',
          confidence: 84,
          url: 'Static demo source'
        }
      ],
      rankedCandidates: [
        {
          type: 'Timetable',
          title: `${branch} ${semester} ${section} timetable`,
          source: 'Static demo source',
          confidence: 89
        },
        {
          type: 'Calendar',
          title: `${semester} academic calendar`,
          source: 'Static demo source',
          confidence: 84
        }
      ],
      candidate: {
        confidence: 86,
        sources: [
          {
            type: 'Timetable',
            title: `${branch} ${semester} ${section} timetable`,
            source: 'Static demo source',
            confidence: 89
          },
          {
            type: 'Calendar',
            title: `${semester} academic calendar`,
            source: 'Static demo source',
            confidence: 84
          }
        ],
        calendar: {
          semesterStart: start,
          semesterEnd: end
        },
        holidays: [
          { id: crypto.randomUUID(), date: format(addDays(new Date(), 28), 'yyyy-MM-dd'), reason: 'Academic holiday' },
          { id: crypto.randomUUID(), date: format(addDays(new Date(), 49), 'yyyy-MM-dd'), reason: 'Festival break' }
        ],
        slots: [
          {
            id: crypto.randomUUID(),
            weekday: 'Monday',
            startTime: '09:00',
            endTime: '10:00',
            subject: `${branch} Mathematics`,
            faculty: '',
            room: 'A-204',
            slotType: 'lecture',
            activeFrom: start,
            activeTo: ''
          },
          {
            id: crypto.randomUUID(),
            weekday: 'Monday',
            startTime: '10:00',
            endTime: '11:00',
            subject: `${branch} Core`,
            faculty: '',
            room: 'B-112',
            slotType: 'lecture',
            activeFrom: start,
            activeTo: ''
          },
          {
            id: crypto.randomUUID(),
            weekday: 'Wednesday',
            startTime: '14:00',
            endTime: '16:00',
            subject: `${branch} Lab`,
            faculty: '',
            room: 'Lab 2',
            slotType: 'lab',
            activeFrom: start,
            activeTo: ''
          }
        ]
      }
    };
  }

  const response = await fetch('http://localhost:4174/api/extract', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ profile })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Extraction failed.');
  }

  return payload;
}

function SetupView({ state, updateState, setActiveTab }) {
  const [modeMessage, setModeMessage] = useState('');
  const [candidate, setCandidate] = useState(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [sourceCandidates, setSourceCandidates] = useState([]);
  const [rankedCandidates, setRankedCandidates] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);
  const [activeStepKey, setActiveStepKey] = useState('');
  const [runId, setRunId] = useState(0);
  const profile = state.profile;
  const requiredFields = ['collegeName', 'course', 'branch', 'semester'];
  const missingFields = requiredFields.filter((field) => !String(profile[field] || '').trim());

  const updateProfile = (field, value) => {
    updateState((current) => ({
      ...current,
      profile: { ...current.profile, [field]: value }
    }));
  };

  const startExtraction = () => {
    if (missingFields.length > 0) {
      setModeMessage('Enter college, course, branch, and semester before starting web extraction.');
      return;
    }

    setCandidate(null);
    setIsExtracting(true);
    setActiveStepKey('discover');
    setCompletedSteps([]);
    setSourceCandidates([]);
    setRankedCandidates([]);
    setActivityFeed([`Started extraction for ${profile.collegeName}, ${profile.branch}, ${profile.semester}.`]);
    setModeMessage(
      isStaticDemo
        ? 'Running static demo extraction for GitHub Pages. Review stays fully interactive.'
        : 'Searching live sources now. The app will fetch real pages and stop at review before generating lectures.'
    );
    setRunId((current) => current + 1);
  };

  const acceptCandidate = () => {
    if (!candidate) return;
    updateState((current) => ({
      ...current,
      calendar: candidate.calendar,
      holidays: candidate.holidays,
      slots: candidate.slots,
      overrides: [],
      attendance: {}
    }));
    setCompletedSteps(extractionSteps.map((step) => step.key));
    setActiveStepKey('');
    setIsExtracting(false);
    setModeMessage('Imported timetable and calendar. Lecture sessions were regenerated from the extracted structure.');
    setActiveTab('timetable');
  };

  useEffect(() => {
    if (!isExtracting || !runId) {
      return undefined;
    }

    let cancelled = false;

    const execute = async () => {
      try {
        const payload = await runExtraction(profile);
        if (cancelled) return;

        setActiveStepKey('rank');
        setSourceCandidates(payload.discoveredSources || []);
        setCompletedSteps(['discover']);
        setActivityFeed((current) => [
          ...current,
          `Found ${(payload.discoveredSources || []).length} live sources with likely timetable and calendar data.`
        ]);

        await new Promise((resolve) => window.setTimeout(resolve, 250));
        if (cancelled) return;

        setActiveStepKey('extract');
        setRankedCandidates(payload.rankedCandidates || []);
        setCompletedSteps(['discover', 'rank']);
        setActivityFeed((current) => [
          ...current,
          `Ranked ${(payload.rankedCandidates || []).length} fetched sources and selected the strongest matches.`
        ]);

        await new Promise((resolve) => window.setTimeout(resolve, 250));
        if (cancelled) return;

        setActiveStepKey('review');
        setCandidate(payload.candidate);
        setCompletedSteps(['discover', 'rank', 'extract']);
        setActivityFeed((current) => [
          ...current,
          `Extracted ${(payload.candidate?.slots || []).length} weekly slots and ${(payload.candidate?.holidays || []).length} holiday dates from fetched content.`
        ]);

        await new Promise((resolve) => window.setTimeout(resolve, 250));
        if (cancelled) return;

        setCompletedSteps(extractionSteps.map((step) => step.key));
        setActivityFeed((current) => [
          ...current,
          'Review is ready. Confirm the extracted timetable and semester calendar before generating lecture sessions.'
        ]);
        setModeMessage(
          isStaticDemo
            ? 'Static demo extraction finished. Review the demo result before generating lecture sessions.'
            : 'Live extraction finished. Review the fetched result before the app generates your lecture sessions.'
        );
        setIsExtracting(false);
        setActiveStepKey('');
      } catch (error) {
        if (cancelled) return;
        setIsExtracting(false);
        setActiveStepKey('');
        setModeMessage(error instanceof Error ? error.message : 'Extraction failed.');
        setActivityFeed((current) => [
          ...current,
          'Live extraction failed. You can try again, upload files, or use manual setup.'
        ]);
      }
    };

    execute();

    return () => {
      cancelled = true;
    };
  }, [isExtracting, profile, runId]);

  const rejectCandidate = () => {
    setCandidate(null);
    setCompletedSteps([]);
    setActiveStepKey('');
    setIsExtracting(false);
    setSourceCandidates([]);
    setRankedCandidates([]);
    setActivityFeed([]);
    setModeMessage('Candidate rejected. You can rerun extraction or switch to manual setup.');
  };

  const getStepState = (stepKey, index) => {
    if (completedSteps.includes(stepKey)) return 'done';
    if (isExtracting && activeStepKey === stepKey) return 'running';
    if (candidate && stepKey === 'review') return 'done';
    return 'pending';
  };

  return (
    <section className="screen">
      <ScreenHeader
        eyebrow="Initial setup"
        title="Find your class structure"
        subtitle={
          isStaticDemo
            ? 'This public GitHub Pages build runs a static demo flow so anyone can open and try the tracker.'
            : 'The app can run the full extraction flow on its own, then stop for review before any lectures are generated.'
        }
      />

      <div className="two-column">
        <div className="panel">
          <div className="panel-title"><h2>Tell us your class details</h2><Save size={18} /></div>
          <div className="form-grid">
            <label>College<input value={profile.collegeName} onChange={(event) => updateProfile('collegeName', event.target.value)} placeholder="College name" /></label>
            <label>Course<input value={profile.course} onChange={(event) => updateProfile('course', event.target.value)} placeholder="B.Tech / B.Sc / B.Com" /></label>
            <label>Branch<input value={profile.branch} onChange={(event) => updateProfile('branch', event.target.value)} placeholder="CSE / Physics / Commerce" /></label>
            <label>Semester<input value={profile.semester} onChange={(event) => updateProfile('semester', event.target.value)} placeholder="Semester 3" /></label>
            <label>Section<input value={profile.section} onChange={(event) => updateProfile('section', event.target.value)} placeholder="A / B1" /></label>
            <label>Threshold %<input type="number" min="1" max="100" value={profile.thresholdPct} onChange={(event) => updateProfile('thresholdPct', event.target.value)} /></label>
          </div>
          {missingFields.length > 0 && (
            <div className="field-warning">
              <AlertTriangle size={17} />
              Add {missingFields.map((field) => field.replace('Name', '').toLowerCase()).join(', ')} for better source matching.
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title"><h2>Extraction flow</h2><Upload size={18} /></div>
          <div className="step-list live">
            {extractionSteps.map((step, index) => {
              const stepState = getStepState(step.key, index);
              const copy = stepState === 'done' ? step.done : stepState === 'running' ? step.running : step.pending;

              return (
                <div className={`step-item ${stepState}`} key={step.key}>
                  <span>{stepState === 'done' ? 'OK' : index + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{copy}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {(isExtracting || activityFeed.length > 0) && (
            <div className="extraction-console">
              <div className="console-head">
                <strong>{isExtracting ? 'Extraction running' : 'Extraction summary'}</strong>
                <span>{completedSteps.length}/{extractionSteps.length} stages complete</span>
              </div>
              <div className="progress-track extraction-progress">
                <div
                  className="progress-fill"
                  style={{ width: `${(completedSteps.length / extractionSteps.length) * 100}%` }}
                />
              </div>
              <div className="activity-list">
                {activityFeed.map((item) => (
                  <div className="activity-row" key={item}>{item}</div>
                ))}
              </div>
            </div>
          )}
          <div className="mode-list">
            <button onClick={startExtraction}>
              <Globe size={19} />
              <span><strong>{isExtracting ? 'Running extraction...' : 'Start web extraction'}</strong><small>Timetable, semester dates, holidays</small></span>
            </button>
            <button onClick={() => setModeMessage('Upload extraction will parse timetable/calendar PDFs or images, then open an editable review screen.')}>
              <FileUp size={19} />
              <span><strong>Upload timetable</strong><small>PDF, screenshot, or calendar document</small></span>
            </button>
            <button onClick={() => setActiveTab('timetable')}>
              <Edit3 size={19} />
              <span><strong>Manual setup</strong><small>Reliable fallback for MVP</small></span>
            </button>
          </div>
          {modeMessage && <div className="notice"><AlertTriangle size={18} /> {modeMessage}</div>}
        </div>
      </div>

      {(sourceCandidates.length > 0 || rankedCandidates.length > 0) && (
        <div className="two-column">
          {sourceCandidates.length > 0 && (
            <div className="panel">
              <div className="panel-title"><h2>Official sources found</h2><Globe size={18} /></div>
              <div className="source-list">
                {sourceCandidates.map((source) => (
                  <div className="source-card" key={source.id}>
                    <strong>{source.label}</strong>
                    <span>{source.detail}</span>
                    <small>{source.confidence}% source confidence</small>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rankedCandidates.length > 0 && (
            <div className="panel">
              <div className="panel-title"><h2>Ranked candidates</h2><ListChecks size={18} /></div>
              <div className="source-list">
                {rankedCandidates.map((source, index) => (
                  <div className="source-card ranked" key={`${source.type}-${source.title}`}>
                    <strong>#{index + 1} {source.type}</strong>
                    <span>{source.title}</span>
                    <small>{source.source} - {source.confidence}% match</small>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {candidate && (
        <div className="panel extraction-review">
          <div className="panel-title">
            <h2>Review extracted candidate</h2>
            <span>{candidate.confidence}% confidence</span>
          </div>

          <div className="candidate-grid">
            {candidate.sources.map((source) => (
              <div className="candidate-card" key={`${source.type}-${source.title}`}>
                <div className="candidate-icon">{source.type === 'Calendar' ? <CalendarDays size={18} /> : <BookOpen size={18} />}</div>
                <div>
                  <strong>{source.type}</strong>
                  <span>{source.title}</span>
                  <small>{source.source} - {source.confidence}% match</small>
                </div>
              </div>
            ))}
          </div>

          <div className="review-grid">
            <div>
              <h3>Weekly timetable</h3>
              <div className="review-table">
                {candidate.slots.map((slot) => (
                  <div className="review-row" key={slot.id}>
                    <span>{slot.weekday}</span>
                    <strong>{slot.startTime}-{slot.endTime}</strong>
                    <span>{slot.subject}</span>
                    <small>{slot.slotType}</small>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3>Semester calendar</h3>
              <div className="calendar-summary">
                <div><CalendarDays size={18} /><span>{candidate.calendar.semesterStart} to {candidate.calendar.semesterEnd}</span></div>
                <div><ListChecks size={18} /><span>{candidate.holidays.length} holiday/no-class dates found</span></div>
              </div>
              <div className="chip-list">
                {candidate.holidays.map((holiday) => (
                  <span className="chip" key={holiday.id}>{holiday.date} - {holiday.reason}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="review-actions">
            <button className="primary-button" onClick={acceptCandidate}><Check size={18} /> Accept and generate lectures</button>
            <button className="secondary-button" onClick={() => setActiveTab('timetable')}><Edit3 size={17} /> Edit manually</button>
            <button className="secondary-button" onClick={rejectCandidate}><X size={17} /> Reject result</button>
          </div>
        </div>
      )}
    </section>
  );
}

function LectureList({ sessions, attendance, markAttendance, cancelSession, compact = false }) {
  if (sessions.length === 0) {
    return <EmptyState text="No lecture sessions for this date." />;
  }

  return (
    <div className={`lecture-list ${compact ? 'compact' : ''}`}>
      {sessions.map((session) => (
        <article className={`lecture-card ${session.status}`} key={session.id}>
          <div className="lecture-time">
            <Clock size={17} />
            <span>{session.startTime}-{session.endTime}</span>
          </div>
          <div className="lecture-main">
            <strong>{session.subject}</strong>
            <span>{session.slotType} {session.room ? `- ${session.room}` : ''}</span>
            {session.note && <small>{session.note}</small>}
          </div>
          <div className="attendance-actions">
            {session.status === 'holiday' || session.status === 'cancelled' ? (
              <span className={`status-pill ${session.status}`}>{session.status}</span>
            ) : (
              <>
                <button className={attendance[session.id] === 'present' ? 'selected present' : ''} onClick={() => markAttendance(session.id, 'present')}><Check size={16} /> {ATTENDANCE_STATUS.present}</button>
                <button className={attendance[session.id] === 'absent' ? 'selected absent' : ''} onClick={() => markAttendance(session.id, 'absent')}><X size={16} /> {ATTENDANCE_STATUS.absent}</button>
                <button onClick={() => cancelSession(session)}><RotateCcw size={16} /> Cancel</button>
              </>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function ScreenHeader({ eyebrow, title, subtitle, action }) {
  return (
    <header className="screen-header">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

function Metric({ label, value, tone = '' }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

createRoot(document.getElementById('root')).render(<App />);
