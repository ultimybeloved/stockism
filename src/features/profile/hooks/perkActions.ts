// The shop's perk purchases (streak saver, Mission Autopilot) and the autopilot
// switch. Split out of usePinShop, which calls this for those three actions.
import { playSound } from '../../../utils/sounds';
import { purchasePinFunction } from '../../../api/callables';
import { afterShopPayment } from '../../../rules/shop';
import type { ActionHookDeps } from '../../../shared/hooks/types';

export type PerkAction = 'buyStreakSaver' | 'buyAutopilot' | 'setAutopilot';

export const isPerkAction = (action: string): action is PerkAction =>
  action === 'buyStreakSaver' || action === 'buyAutopilot' || action === 'setAutopilot';

/** payload: a streak saver plan (buyStreakSaver) or the new on/off state (setAutopilot). */
export async function runPerkAction(
  action: PerkAction,
  payload: unknown,
  cost: number,
  { setUserData, showNotification }: Pick<ActionHookDeps, 'setUserData' | 'showNotification'>,
) {
  if (action === 'buyStreakSaver') {
    const res = await purchasePinFunction({ action: 'buyStreakSaver', plan: payload as string });
    const until = (res.data as { until?: number | null }).until;
    setUserData((prev) =>
      prev
        ? {
            ...prev,
            ...(until ? { streakSaverUntil: until } : { streakSaverPermanent: true }),
            ...afterShopPayment(prev, cost),
          }
        : prev,
    );
    playSound('purchase');
    showNotification('success', 'Streak saver on. Every check-in pays the top reward.');
  } else if (action === 'buyAutopilot') {
    await purchasePinFunction({ action: 'buyAutopilot' });
    setUserData((prev) => (prev ? { ...prev, missionAutopilot: true, ...afterShopPayment(prev, cost) } : prev));
    playSound('purchase');
    showNotification('success', 'Mission Autopilot on. Your missions are claimed for you from now on.');
  } else {
    const on = payload === true;
    await purchasePinFunction({ action: 'setAutopilot', on });
    setUserData((prev) => (prev ? { ...prev, missionAutopilotOff: !on } : prev));
    showNotification(
      'success',
      on
        ? 'Mission Autopilot on. It starts with the next daily missions.'
        : 'Mission Autopilot off. Your missions are yours to finish and claim.',
    );
  }
}
