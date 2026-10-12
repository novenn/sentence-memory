export const DAILY_PROGRESS_KEY = 'dailyReviewProgress';

export const ProgressSlotState = {
  Pending: 'pending',
  Completed: 'completed',
  Skipped: 'skipped',
} as const;

export type ProgressSlotStateId =
  (typeof ProgressSlotState)[keyof typeof ProgressSlotState];

export type DailyReviewProgress = {
  dateKey: string;
  /** 当日第几轮（未毕业的句子会进入下一轮） */
  round: number;
  /** 本轮进度槽顺序，与本轮句子顺序一致 */
  slotOrder: string[];
  completedIds: string[];
  skippedIds: string[];
};

export type ProgressSlot = {
  sentenceId: string;
  state: ProgressSlotStateId;
};

function todayKey(now = Date.now()): string {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function emptyProgress(
  dateKey: string,
  slotOrder: string[],
  round = 1,
): DailyReviewProgress {
  return {
    dateKey,
    round,
    slotOrder: uniqueIds(slotOrder),
    completedIds: [],
    skippedIds: [],
  };
}

function normalizeStored(
  stored: Partial<DailyReviewProgress> | null | undefined,
): DailyReviewProgress | null {
  if (!stored || typeof stored.dateKey !== 'string') return null;

  const completedIds = Array.isArray(stored.completedIds)
    ? stored.completedIds
    : [];
  const skippedIds = Array.isArray(stored.skippedIds) ? stored.skippedIds : [];
  const slotOrder = Array.isArray(stored.slotOrder)
    ? stored.slotOrder
    : uniqueIds([...completedIds, ...skippedIds]);

  return {
    dateKey: stored.dateKey,
    round: Math.max(1, Number(stored.round) || 1),
    slotOrder: uniqueIds(slotOrder),
    completedIds: uniqueIds(completedIds),
    skippedIds: uniqueIds(skippedIds),
  };
}

async function readProgress(): Promise<DailyReviewProgress | null> {
  const result = await chrome.storage.local.get(DAILY_PROGRESS_KEY);
  return normalizeStored(
    result[DAILY_PROGRESS_KEY] as Partial<DailyReviewProgress> | undefined,
  );
}

async function writeProgress(progress: DailyReviewProgress): Promise<void> {
  await chrome.storage.local.set({ [DAILY_PROGRESS_KEY]: progress });
}

function mergeSlotOrder(existing: string[], dueIds: string[]): string[] {
  const merged = [...existing];
  for (const id of dueIds) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged;
}

export function isRoundComplete(progress: DailyReviewProgress): boolean {
  if (progress.slotOrder.length === 0) return false;
  const completed = new Set(progress.completedIds);
  const skipped = new Set(progress.skippedIds);
  return progress.slotOrder.every(
    (sentenceId) => completed.has(sentenceId) || skipped.has(sentenceId),
  );
}

export async function loadDailyReviewProgress(
  dueIds: string[],
  now = Date.now(),
): Promise<DailyReviewProgress> {
  const dateKey = todayKey(now);
  const stored = await readProgress();

  if (!stored || stored.dateKey !== dateKey) {
    const fresh = emptyProgress(dateKey, dueIds, 1);
    await writeProgress(fresh);
    return fresh;
  }

  // 本轮已完成：等待用户手动开始下一轮，不自动混入
  if (isRoundComplete(stored)) {
    return stored;
  }

  const slotOrder = mergeSlotOrder(stored.slotOrder, dueIds);
  if (
    slotOrder.length === stored.slotOrder.length &&
    slotOrder.every((id, index) => id === stored.slotOrder[index])
  ) {
    return stored;
  }

  const next = { ...stored, slotOrder };
  await writeProgress(next);
  return next;
}

async function readTodayProgress(): Promise<DailyReviewProgress> {
  const dateKey = todayKey();
  const stored = await readProgress();
  if (!stored || stored.dateKey !== dateKey) {
    return emptyProgress(dateKey, []);
  }
  return stored;
}

function ensureSlot(
  progress: DailyReviewProgress,
  sentenceId: string,
): DailyReviewProgress {
  if (progress.slotOrder.includes(sentenceId)) return progress;
  return {
    ...progress,
    slotOrder: [...progress.slotOrder, sentenceId],
  };
}

export async function markDailyCompleted(
  sentenceId: string,
): Promise<DailyReviewProgress> {
  const progress = ensureSlot(await readTodayProgress(), sentenceId);
  const next: DailyReviewProgress = {
    ...progress,
    completedIds: uniqueIds([...progress.completedIds, sentenceId]),
    skippedIds: progress.skippedIds.filter((id) => id !== sentenceId),
  };
  await writeProgress(next);
  return next;
}

export async function markDailySkipped(
  sentenceId: string,
): Promise<DailyReviewProgress> {
  const progress = ensureSlot(await readTodayProgress(), sentenceId);
  if (progress.completedIds.includes(sentenceId)) {
    return progress;
  }
  const next: DailyReviewProgress = {
    ...progress,
    skippedIds: uniqueIds([...progress.skippedIds, sentenceId]),
  };
  await writeProgress(next);
  return next;
}

/** 用户确认后再开启下一轮进度 */
export async function startNextRound(
  remainingQueueIds: string[],
): Promise<DailyReviewProgress> {
  const progress = await readTodayProgress();
  const nextIds = uniqueIds(remainingQueueIds);
  if (nextIds.length === 0) return progress;

  const nextRound = emptyProgress(
    progress.dateKey,
    nextIds,
    progress.round + 1,
  );
  await writeProgress(nextRound);
  return nextRound;
}

export function buildProgressSlots(
  progress: DailyReviewProgress,
): ProgressSlot[] {
  const completed = new Set(progress.completedIds);
  const skipped = new Set(progress.skippedIds);
  return progress.slotOrder.map((sentenceId) => {
    if (completed.has(sentenceId)) {
      return { sentenceId, state: ProgressSlotState.Completed };
    }
    if (skipped.has(sentenceId)) {
      return { sentenceId, state: ProgressSlotState.Skipped };
    }
    return { sentenceId, state: ProgressSlotState.Pending };
  });
}

export function progressSummary(progress: DailyReviewProgress): {
  completedCount: number;
  skippedCount: number;
  totalCount: number;
  percent: number;
  round: number;
} {
  const totalCount = progress.slotOrder.length;
  const completedCount = progress.completedIds.filter((id) =>
    progress.slotOrder.includes(id),
  ).length;
  const skippedCount = progress.skippedIds.filter((id) =>
    progress.slotOrder.includes(id),
  ).length;
  const percent =
    totalCount === 0
      ? 0
      : Math.min(
          100,
          Math.round(((completedCount + skippedCount) / totalCount) * 100),
        );
  return {
    completedCount,
    skippedCount,
    totalCount,
    percent,
    round: progress.round,
  };
}
