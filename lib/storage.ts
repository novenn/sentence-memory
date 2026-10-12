import { DAILY_PROGRESS_KEY } from './daily-progress';
import { createInitialReview } from './review';
import {
  DEFAULT_SETTINGS,
  STORAGE_VERSION,
  type ExportPayload,
  type SavedSentence,
  type Settings,
  type StorageSchema,
} from './types';
import { createId } from './utils';

const SENTENCES_KEY = 'sentences';
const SETTINGS_KEY = 'settings';
const VERSION_KEY = 'version';

async function readStorage<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

export async function getSettings(): Promise<Settings> {
  return readStorage(SETTINGS_KEY, DEFAULT_SETTINGS);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getSentences(): Promise<SavedSentence[]> {
  return readStorage<SavedSentence[]>(SENTENCES_KEY, []);
}

export async function saveSentences(sentences: SavedSentence[]): Promise<void> {
  await chrome.storage.local.set({
    [SENTENCES_KEY]: sentences,
    [VERSION_KEY]: STORAGE_VERSION,
  });
}

export async function ensureStorageInitialized(): Promise<void> {
  const result = await chrome.storage.local.get([
    SENTENCES_KEY,
    SETTINGS_KEY,
    VERSION_KEY,
  ]);
  const patch: Partial<StorageSchema> = {};
  if (!result[SENTENCES_KEY]) patch.sentences = [];
  if (!result[SETTINGS_KEY]) patch.settings = DEFAULT_SETTINGS;
  if (!result[VERSION_KEY]) patch.version = STORAGE_VERSION;
  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
}

export type SaveSentenceInput = {
  en: string;
  zh: string;
  url: string;
  pageTitle: string;
  tags?: string[];
};

export type SaveSentenceResult =
  | { status: 'created'; sentence: SavedSentence }
  | { status: 'updated'; sentence: SavedSentence }
  | { status: 'exists'; sentence: SavedSentence };

export async function saveSentence(
  input: SaveSentenceInput,
): Promise<SaveSentenceResult> {
  const sentences = await getSentences();
  const now = Date.now();
  const existingIndex = sentences.findIndex(
    (item) => item.url === input.url && item.en === input.en,
  );

  if (existingIndex >= 0) {
    const existing = sentences[existingIndex];
    const zhChanged = existing.zh !== input.zh;
    if (!zhChanged) {
      return { status: 'exists', sentence: existing };
    }
    const updated: SavedSentence = {
      ...existing,
      zh: input.zh,
      updatedAt: now,
    };
    sentences[existingIndex] = updated;
    await saveSentences(sentences);
    return { status: 'updated', sentence: updated };
  }

  const sentence: SavedSentence = {
    id: createId(),
    en: input.en,
    zh: input.zh,
    url: input.url,
    pageTitle: input.pageTitle,
    createdAt: now,
    updatedAt: now,
    tags: input.tags,
    review: createInitialReview(now),
  };
  sentences.unshift(sentence);
  await saveSentences(sentences);
  return { status: 'created', sentence };
}

export async function updateSentence(
  sentenceId: string,
  updater: (sentence: SavedSentence) => SavedSentence,
): Promise<SavedSentence | null> {
  const sentences = await getSentences();
  const index = sentences.findIndex((item) => item.id === sentenceId);
  if (index < 0) return null;
  const updated = updater(sentences[index]);
  sentences[index] = { ...updated, updatedAt: Date.now() };
  await saveSentences(sentences);
  return sentences[index];
}

export async function deleteSentence(sentenceId: string): Promise<boolean> {
  const sentences = await getSentences();
  const next = sentences.filter((item) => item.id !== sentenceId);
  if (next.length === sentences.length) return false;
  await saveSentences(next);
  return true;
}

export async function clearAllData(): Promise<void> {
  await chrome.storage.local.set({
    [SENTENCES_KEY]: [],
    [SETTINGS_KEY]: DEFAULT_SETTINGS,
    [VERSION_KEY]: STORAGE_VERSION,
  });
  await chrome.storage.local.remove(DAILY_PROGRESS_KEY);
}

export async function exportData(): Promise<ExportPayload> {
  const [sentences, settings] = await Promise.all([getSentences(), getSettings()]);
  return {
    sentences,
    settings,
    version: STORAGE_VERSION,
  };
}

export async function importData(payload: ExportPayload): Promise<{
  imported: number;
  skipped: number;
}> {
  if (!payload || !Array.isArray(payload.sentences)) {
    throw new Error('无效的导入文件');
  }

  const existing = await getSentences();
  const byId = new Map(existing.map((item) => [item.id, item]));
  const byKey = new Map(existing.map((item) => [`${item.url}::${item.en}`, item]));

  let imported = 0;
  let skipped = 0;

  for (const incoming of payload.sentences) {
    if (!incoming?.en || !incoming?.zh) {
      skipped += 1;
      continue;
    }
    const key = `${incoming.url ?? ''}::${incoming.en}`;
    if (incoming.id && byId.has(incoming.id)) {
      const current = byId.get(incoming.id)!;
      const merged = mergeSentence(current, incoming);
      byId.set(merged.id, merged);
      byKey.set(`${merged.url}::${merged.en}`, merged);
      imported += 1;
      continue;
    }
    if (byKey.has(key)) {
      const current = byKey.get(key)!;
      const merged = mergeSentence(current, incoming);
      byId.set(merged.id, merged);
      byKey.set(key, merged);
      imported += 1;
      continue;
    }
    const created: SavedSentence = {
      ...incoming,
      id: incoming.id || createId(),
      url: incoming.url ?? '',
      pageTitle: incoming.pageTitle ?? '',
      createdAt: incoming.createdAt ?? Date.now(),
      updatedAt: incoming.updatedAt ?? Date.now(),
      review: incoming.review ?? createInitialReview(),
    };
    byId.set(created.id, created);
    byKey.set(`${created.url}::${created.en}`, created);
    imported += 1;
  }

  await saveSentences(Array.from(byId.values()));
  if (payload.settings) {
    await saveSettings({ ...DEFAULT_SETTINGS, ...payload.settings });
  }
  return { imported, skipped };
}

function mergeSentence(
  current: SavedSentence,
  incoming: SavedSentence,
): SavedSentence {
  const preferIncoming = (incoming.updatedAt ?? 0) >= (current.updatedAt ?? 0);
  return preferIncoming
    ? {
        ...current,
        ...incoming,
        id: current.id,
        review: incoming.review ?? current.review,
      }
    : current;
}
