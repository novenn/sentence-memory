const ENGLISH_LETTER_PATTERN = /[A-Za-z]/;
const MIN_ENGLISH_RATIO = 0.4;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isLikelyEnglish(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || !ENGLISH_LETTER_PATTERN.test(trimmed)) {
    return false;
  }
  const letters = trimmed.replace(/[^A-Za-z\u4e00-\u9fff]/g, '');
  if (!letters) {
    return false;
  }
  const englishCount = (letters.match(/[A-Za-z]/g) ?? []).length;
  return englishCount / letters.length >= MIN_ENGLISH_RATIO;
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
