import { describe, expect, it } from 'vitest';
import {
  ALMOST_THRESHOLD,
  CONSECUTIVE_CORRECT_TO_GRADUATE,
  createInitialReview,
  judgeAnswer,
  levenshteinDistance,
  REVIEW_INTERVALS_DAYS,
  similarity,
  updateReviewAfterAnswer,
} from './review';
import { JUDGMENT } from './types';
import { normalize } from './utils';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('normalize', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalize('Hello, World!')).toBe('hello world');
  });
});

describe('levenshteinDistance', () => {
  it('computes edit distance', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
  });
});

describe('similarity / judgeAnswer', () => {
  it('marks exact normalized match as correct', () => {
    const result = judgeAnswer('Hello, world!', 'hello world');
    expect(result.judgment).toBe(JUDGMENT.Correct);
    expect(result.score).toBe(1);
  });

  it('marks high similarity as almost', () => {
    const result = judgeAnswer(
      'This is a sample sentence',
      'This is a sample sentance',
    );
    expect(result.score).toBeGreaterThanOrEqual(ALMOST_THRESHOLD);
    expect(result.judgment).toBe(JUDGMENT.Almost);
  });

  it('marks low similarity as wrong', () => {
    const result = judgeAnswer('cat', 'completely different text');
    expect(result.judgment).toBe(JUDGMENT.Wrong);
    expect(similarity('cat', 'completely different text')).toBeLessThan(
      ALMOST_THRESHOLD,
    );
  });
});

describe('updateReviewAfterAnswer', () => {
  const now = 1_700_000_000_000;

  it('keeps sentence due until 3 consecutive corrects', () => {
    let review = createInitialReview(now);
    for (let step = 1; step < CONSECUTIVE_CORRECT_TO_GRADUATE; step += 1) {
      const result = updateReviewAfterAnswer(review, JUDGMENT.Correct, now);
      expect(result.graduated).toBe(false);
      expect(result.shouldDelete).toBe(false);
      expect(result.review.nextReviewAt).toBe(now);
      expect(result.review.consecutiveCorrect).toBe(step);
      review = result.review;
    }
  });

  it('graduates after 3 consecutive corrects with 3-day interval', () => {
    let review = createInitialReview(now);
    let result = updateReviewAfterAnswer(review, JUDGMENT.Correct, now);
    review = result.review;
    result = updateReviewAfterAnswer(review, JUDGMENT.Correct, now);
    review = result.review;
    result = updateReviewAfterAnswer(review, JUDGMENT.Correct, now);

    expect(result.graduated).toBe(true);
    expect(result.shouldDelete).toBe(false);
    expect(result.review.consecutiveCorrect).toBe(0);
    expect(result.review.intervalLevel).toBe(1);
    expect(result.review.nextReviewAt).toBe(
      now + REVIEW_INTERVALS_DAYS[0] * MS_PER_DAY,
    );
  });

  it('resets streak on wrong but keeps sentence due', () => {
    const result = updateReviewAfterAnswer(
      {
        times: 2,
        correct: 2,
        consecutiveCorrect: 2,
        nextReviewAt: now,
        intervalLevel: 1,
      },
      JUDGMENT.Wrong,
      now,
    );
    expect(result.graduated).toBe(false);
    expect(result.review.consecutiveCorrect).toBe(0);
    expect(result.review.intervalLevel).toBe(1);
    expect(result.review.nextReviewAt).toBe(now);
  });

  it('deletes after finishing all intervals and 3 more consecutive corrects', () => {
    let review = {
      times: 0,
      correct: 0,
      consecutiveCorrect: 0,
      nextReviewAt: now,
      intervalLevel: REVIEW_INTERVALS_DAYS.length,
    };
    review = updateReviewAfterAnswer(review, JUDGMENT.Correct, now).review;
    review = updateReviewAfterAnswer(review, JUDGMENT.Correct, now).review;
    const result = updateReviewAfterAnswer(review, JUDGMENT.Correct, now);
    expect(result.shouldDelete).toBe(true);
    expect(result.graduated).toBe(true);
  });
});
