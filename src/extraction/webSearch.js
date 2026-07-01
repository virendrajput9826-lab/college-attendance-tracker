export async function runWebSearchExtract({ collegeName, course, branch, semester, section }) {
  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      method: 'web',
      query: {
        collegeName,
        course,
        branch,
        semester,
        section
      }
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Web extraction failed.');
  }

  return payload;
}
