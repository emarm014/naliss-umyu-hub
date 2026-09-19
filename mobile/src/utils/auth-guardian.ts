import { mmkvStorage } from '../stores/mmkv.storage';

/**
 * AuthGuardian - Local Rate Limiting and Security Utility
 * 
 * Protects against brute-force format errors and excessive login attempts
 * using device-local storage.
 */

const BAN_DURATION_MINUTES = 30;
const MAX_ATTEMPTS = 5;
const MAX_DAILY_RESETS = 10;
const RESET_WINDOW_HOURS = 24;

export const AuthGuardian = {
  /**
   * Checks if an email is currently blocked on this device.
   * Returns remaining minutes if banned, null otherwise.
   */
  async checkBanStatus(email: string): Promise<number | null> {
    try {
      const banTime = await mmkvStorage.getItem(`ban_${email}`);
      if (!banTime) return null;

      const now = Date.now();
      const expires = parseInt(banTime, 10);
      
      if (now < expires) {
        const diffMs = expires - now;
        // Return rounded up minutes
        return Math.max(1, Math.ceil(diffMs / (1000 * 60)));
      } else {
        // Ban expired, clean up
        await mmkvStorage.removeItem(`ban_${email}`);
        await mmkvStorage.removeItem(`fail_${email}`);
        return null;
      }
    } catch {
      return null;
    }
  },

  async recordFailure(email: string): Promise<number> {
    try {
      const currentFailuresStr = await mmkvStorage.getItem(`fail_${email}`);
      const currentFailures = currentFailuresStr ? parseInt(currentFailuresStr, 10) : 0;
      const nextFailures = currentFailures + 1;
      await mmkvStorage.setItem(`fail_${email}`, nextFailures.toString());
      if (nextFailures >= MAX_ATTEMPTS) {
        const banExpires = Date.now() + (BAN_DURATION_MINUTES * 60 * 1000);
        await mmkvStorage.setItem(`ban_${email}`, banExpires.toString());
      }
      return nextFailures;
    } catch {
      return 0;
    }
  },

  async clearFailures(email: string): Promise<void> {
    try {
      await mmkvStorage.removeItem(`fail_${email}`);
      await mmkvStorage.removeItem(`ban_${email}`);
    } catch {
      // silent
    }
  },

  async recordResetAttempt(email: string): Promise<void> {
    try {
      const key = `reset_count_${email}`;
      const timeKey = `reset_first_time_${email}`;
      const countStr = await mmkvStorage.getItem(key);
      const firstTimeStr = await mmkvStorage.getItem(timeKey);
      const now = Date.now();
      const count = countStr ? parseInt(countStr, 10) : 0;
      const firstTime = firstTimeStr ? parseInt(firstTimeStr, 10) : now;
      if (now - firstTime > RESET_WINDOW_HOURS * 60 * 60 * 1000) {
        await mmkvStorage.setItem(key, "1");
        await mmkvStorage.setItem(timeKey, now.toString());
      } else {
        await mmkvStorage.setItem(key, (count + 1).toString());
        if (!firstTimeStr) await mmkvStorage.setItem(timeKey, now.toString());
      }
    } catch {
      // silent
    }
  },

  async checkResetLimit(email: string): Promise<number | null> {
    try {
      const key = `reset_count_${email}`;
      const timeKey = `reset_first_time_${email}`;
      const countStr = await mmkvStorage.getItem(key);
      const firstTimeStr = await mmkvStorage.getItem(timeKey);
      if (!countStr || !firstTimeStr) return null;
      const count = parseInt(countStr, 10);
      const firstTime = parseInt(firstTimeStr, 10);
      const now = Date.now();
      if (now - firstTime < RESET_WINDOW_HOURS * 60 * 60 * 1000) {
        if (count >= MAX_DAILY_RESETS) {
          const expires = firstTime + (RESET_WINDOW_HOURS * 60 * 60 * 1000);
          return Math.ceil((expires - now) / (1000 * 60 * 60));
        }
      } else {
        await mmkvStorage.removeItem(key);
        await mmkvStorage.removeItem(timeKey);
      }
      return null;
    } catch {
      return null;
    }
  }
};
