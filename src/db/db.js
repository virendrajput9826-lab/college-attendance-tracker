import Dexie from 'dexie';

const db = new Dexie('AttendanceTracker');

db.version(1).stores({
  subjects: '++id, name, code, color',
  timetableSlots: '++id, subjectId, dayOfWeek, startTime, endTime, room, type',
  semester: '++id, startDate, endDate, minAttendancePct',
  holidays: '++id, date, reason',
  lectureSessions: '++id, subjectId, slotId, date, status, attendance',
  settings: 'key, value'
});

export const defaultProfile = {
  collegeName: '',
  course: '',
  branch: '',
  semester: '',
  section: '',
  thresholdPct: 75
};

export async function loadProfile() {
  const profile = await db.settings.get('profile');
  return profile?.value || defaultProfile;
}

export async function saveProfile(profile) {
  await db.settings.put({ key: 'profile', value: profile });
}

export async function loadStructuredData() {
  const [subjects, timetableSlots, semesterRows, holidays, lectureSessions] = await Promise.all([
    db.subjects.toArray(),
    db.timetableSlots.toArray(),
    db.semester.toArray(),
    db.holidays.toArray(),
    db.lectureSessions.toArray()
  ]);

  return {
    subjects,
    timetableSlots,
    semester: semesterRows[0] || null,
    holidays,
    lectureSessions
  };
}

export default db;
