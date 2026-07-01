import db from '../db/db';

export async function generateSessions(semesterId) {
  const sem = await db.semester.get(semesterId);
  if (!sem) return [];

  const holidays = (await db.holidays.toArray()).map((holiday) => holiday.date);
  const slots = await db.timetableSlots.toArray();

  await db.lectureSessions.clear();

  let date = new Date(sem.startDate);
  const end = new Date(sem.endDate);
  const sessions = [];

  while (date <= end) {
    const dayIndex = (date.getDay() + 6) % 7;
    const dateStr = date.toISOString().slice(0, 10);
    const isHoliday = holidays.includes(dateStr);

    slots
      .filter((slot) => slot.dayOfWeek === dayIndex)
      .forEach((slot) => {
        sessions.push({
          subjectId: slot.subjectId,
          slotId: slot.id,
          date: dateStr,
          status: isHoliday ? 'holiday' : 'scheduled',
          attendance: 'unmarked'
        });
      });

    date.setDate(date.getDate() + 1);
  }

  if (sessions.length > 0) {
    await db.lectureSessions.bulkAdd(sessions);
  }

  return sessions;
}
