import db from '../db/db';

export async function getStats(subjectId) {
  const rows = await db.lectureSessions.where({ subjectId, status: 'scheduled' }).toArray();
  const counted = rows.filter((row) => row.attendance !== 'unmarked');
  const present = counted.filter((row) => row.attendance === 'present').length;
  const total = counted.length;
  const pct = total > 0 ? (present / total) * 100 : null;

  const sem = await db.semester.toCollection().first();
  const minPct = (sem?.minAttendancePct || 75) / 100;

  const canMiss =
    pct !== null && pct >= minPct * 100 ? Math.floor((present - minPct * total) / minPct) : null;
  const needToAttend =
    pct !== null && pct < minPct * 100 ? Math.ceil((minPct * total - present) / (1 - minPct)) : null;

  return { present, total, pct, canMiss, needToAttend };
}

export async function getDashboardStats() {
  const [subjects, sessions] = await Promise.all([db.subjects.toArray(), db.lectureSessions.toArray()]);

  const subjectStats = await Promise.all(
    subjects.map(async (subject) => ({
      subject,
      stats: await getStats(subject.id)
    }))
  );

  const counted = sessions.filter((session) => session.status === 'scheduled' && session.attendance !== 'unmarked');
  const present = counted.filter((session) => session.attendance === 'present').length;
  const total = counted.length;

  return {
    overall: {
      present,
      total,
      pct: total > 0 ? (present / total) * 100 : null
    },
    subjects: subjectStats
  };
}
