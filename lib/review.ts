import { JUDGMENT, type Judgment, type ReviewState, type SavedSentence } from './types';
import { normalize } from './utils';

/** 连对 3 次后依次休息的天数，全部完成后再连对 3 次则删除 */
export const REVIEW_INTERVALS_DAYS = [3, 6, 9, 15, 30] as const;
export const CONSECUTIVE_CORRECT_TO_GRADUATE = 3;
export const ALMOST_THRESHOLD = 0.9;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ReviewUpdateResult = {
  review: ReviewState;
  /** 已从今日复习中「消失」（进入间隔等待） */
  graduated: boolean;
  /** 完成全部间隔后再次连对，应删除句子 */
  shouldDelete: boolean;
};

export function levenshteinDistance(left: string, right: string): number {
  const leftLength = left.length;
  const rightLength = right.length;
  if (leftLength === 0) return rightLength;
  if (rightLength === 0) return leftLength;

  const previous = new Array<number>(rightLength + 1);
  const current = new Array<number>(rightLength + 1);

  for (let column = 0; column <= rightLength; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= leftLength; row += 1) {
    current[0] = row;
    for (let column = 1; column <= rightLength; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + substitutionCost,
      );
    }
    for (let column = 0; column <= rightLength; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[rightLength];
}

export function similarity(left: string, right: string): number {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft && !normalizedRight) return 1;
  if (!normalizedLeft || !normalizedRight) return 0;
  const distance = levenshteinDistance(normalizedLeft, normalizedRight);
  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  return 1 - distance / maxLength;
}

export function judgeAnswer(input: string, answer: string): {
  judgment: Judgment;
  score: number;
} {
  const score = similarity(input, answer);
  if (normalize(input) === normalize(answer)) {
    return { judgment: JUDGMENT.Correct, score: 1 };
  }
  if (score >= ALMOST_THRESHOLD) {
    return { judgment: JUDGMENT.Almost, score };
  }
  return { judgment: JUDGMENT.Wrong, score };
}

export function createInitialReview(now = Date.now()): ReviewState {
  return {
    times: 0,
    correct: 0,
    consecutiveCorrect: 0,
    nextReviewAt: now,
    intervalLevel: 0,
  };
}

export function normalizeReviewState(review: ReviewState): ReviewState {
  return {
    ...review,
    consecutiveCorrect: review.consecutiveCorrect ?? 0,
    intervalLevel: review.intervalLevel ?? 0,
  };
}

export function updateReviewAfterAnswer(
  review: ReviewState,
  judgment: Judgment,
  now = Date.now(),
): ReviewUpdateResult {
  const current = normalizeReviewState(review);
  const isCorrect =
    judgment === JUDGMENT.Correct || judgment === JUDGMENT.Almost;

  if (!isCorrect) {
    return {
      graduated: false,
      shouldDelete: false,
      review: {
        ...current,
        times: current.times + 1,
        consecutiveCorrect: 0,
        lastReviewedAt: now,
        nextReviewAt: now,
      },
    };
  }

  const consecutiveCorrect = current.consecutiveCorrect + 1;
  const withCorrect: ReviewState = {
    ...current,
    times: current.times + 1,
    correct: current.correct + 1,
    consecutiveCorrect,
    lastReviewedAt: now,
    nextReviewAt: now,
  };

  if (consecutiveCorrect < CONSECUTIVE_CORRECT_TO_GRADUATE) {
    return {
      graduated: false,
      shouldDelete: false,
      review: withCorrect,
    };
  }

  if (current.intervalLevel >= REVIEW_INTERVALS_DAYS.length) {
    return {
      graduated: true,
      shouldDelete: true,
      review: {
        ...withCorrect,
        consecutiveCorrect: 0,
      },
    };
  }

  const intervalDays = REVIEW_INTERVALS_DAYS[current.intervalLevel];
  return {
    graduated: true,
    shouldDelete: false,
    review: {
      ...withCorrect,
      consecutiveCorrect: 0,
      intervalLevel: current.intervalLevel + 1,
      nextReviewAt: now + intervalDays * MS_PER_DAY,
    },
  };
}

export function getDueSentences(
  sentences: SavedSentence[],
  now = Date.now(),
  limit?: number,
): SavedSentence[] {
  const due = sentences
    .filter((sentence) => sentence.review.nextReviewAt <= now)
    .sort((left, right) => left.review.nextReviewAt - right.review.nextReviewAt);

  if (typeof limit === 'number' && limit > 0) {
    return due.slice(0, limit);
  }
  return due;
}

export type DiffPart = {
  type: 'equal' | 'insert' | 'delete';
  text: string;
};

/** 简单词级 diff，用于高亮差异 */
export function diffWords(expected: string, actual: string): DiffPart[] {
  const expectedWords = expected.trim().split(/\s+/).filter(Boolean);
  const actualWords = actual.trim().split(/\s+/).filter(Boolean);
  const leftLength = expectedWords.length;
  const rightLength = actualWords.length;
  const table: number[][] = Array.from({ length: leftLength + 1 }, () =>
    Array.from({ length: rightLength + 1 }, () => 0),
  );

  for (let row = leftLength - 1; row >= 0; row -= 1) {
    for (let column = rightLength - 1; column >= 0; column -= 1) {
      if (normalize(expectedWords[row]) === normalize(actualWords[column])) {
        table[row][column] = table[row + 1][column + 1] + 1;
      } else {
        table[row][column] = Math.max(table[row + 1][column], table[row][column + 1]);
      }
    }
  }

  const parts: DiffPart[] = [];
  let row = 0;
  let column = 0;
  while (row < leftLength && column < rightLength) {
    if (normalize(expectedWords[row]) === normalize(actualWords[column])) {
      parts.push({ type: 'equal', text: expectedWords[row] });
      row += 1;
      column += 1;
    } else if (table[row + 1][column] >= table[row][column + 1]) {
      parts.push({ type: 'delete', text: expectedWords[row] });
      row += 1;
    } else {
      parts.push({ type: 'insert', text: actualWords[column] });
      column += 1;
    }
  }
  while (row < leftLength) {
    parts.push({ type: 'delete', text: expectedWords[row] });
    row += 1;
  }
  while (column < rightLength) {
    parts.push({ type: 'insert', text: actualWords[column] });
    column += 1;
  }
  return parts;
}
