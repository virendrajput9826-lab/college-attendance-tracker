async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

export async function runVisionExtract(file) {
  const imageBase64 = await fileToBase64(file);
  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      method: 'vision',
      imageBase64,
      mediaType: file.type || 'image/png'
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Vision extraction failed.');
  }

  return payload;
}
