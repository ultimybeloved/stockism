import * as Sentry from '@sentry/react';
import { achievementAlertFunction, syncPortfolioFunction } from '../firebase';

// Achievement side-effects for a completed trade. Split out of
// useTradeManagement.js, which was past the 200-line hook limit.

// Server-side achievement check via syncPortfolio (these fields are blocked
// from client writes by security rules).
export const checkAndAwardAchievements = async () => {
  try {
    const result = await syncPortfolioFunction();
    return result.data?.newAchievements || [];
  } catch (error) {
    console.error('[ACHIEVEMENT CHECK ERROR]', error);
    return [];
  }
};

export const sendAchievementAlert = (id, achievement) => {
  try {
    achievementAlertFunction({ achievementId: id, achievementName: achievement.name, achievementDescription: achievement.description }).catch((e) => Sentry.captureException(e));
  } catch (e) {
    Sentry.captureException(e);
  }
};
