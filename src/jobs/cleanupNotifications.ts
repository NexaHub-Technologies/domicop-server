/**
 * Notification Cleanup Job
 *
 * Scheduled job that removes old notification logs (older than 60 days).
 * Can be run manually or scheduled via cron.
 *
 * @module jobs/cleanupNotifications
 * @requires supabase
 *
 * @example
 * ```typescript
 * // Manual execution
 * import { cleanupOldNotifications } from './jobs/cleanupNotifications';
 * await cleanupOldNotifications();
 * ```
 */

import { supabase } from "../lib/supabase";

/**
 * Clean up notification logs older than 60 days
 *
 * @returns {Promise<{success: boolean, deletedCount: number, error?: string}>}
 *
 * @example
 * ```typescript
 * const result = await cleanupOldNotifications();
 * if (result.success) {
 *   console.log(`Deleted ${result.deletedCount} old notifications`);
 * }
 * ```
 */
export async function cleanupOldNotifications(): Promise<{
  success: boolean;
  deletedCount: number;
  error?: string;
}> {
  try {
    console.log("[Cleanup] Starting notification cleanup job...");

    // Call the database function
    const { data, error } = await supabase.rpc("cleanup_old_notifications");

    if (error) {
      console.error("[Cleanup] Error:", error);
      return {
        success: false,
        deletedCount: 0,
        error: error.message,
      };
    }

    console.log(`[Cleanup] Deleted ${data} old notifications`);

    return {
      success: true,
      deletedCount: data || 0,
    };
  } catch (error: any) {
    console.error("[Cleanup] Unexpected error:", error);
    return {
      success: false,
      deletedCount: 0,
      error: error.message,
    };
  }
}

/**
 * Schedule the cleanup job to run daily
 *
 * In production, use a proper scheduler like node-cron or system cron
 *
 * @example
 * ```typescript
 * // Run every day at 2 AM
 * import { scheduleCleanupJob } from './jobs/cleanupNotifications';
 * scheduleCleanupJob('0 2 * * *');
 * ```
 */
export function scheduleCleanupJob(cronExpression: string = "0 2 * * *"): void {
  console.log(`[Cleanup] Scheduled to run with expression: ${cronExpression}`);

  // Note: In production, use node-cron or system cron
  // This is just a placeholder for the scheduling logic

  // Example with node-cron (would need to install):
  // import cron from 'node-cron';
  // cron.schedule(cronExpression, async () => {
  //   await cleanupOldNotifications();
  // });
}

// If this file is run directly
if (require.main === module) {
  cleanupOldNotifications().then((result) => {
    if (result.success) {
      console.log(
        `[Cleanup] Job completed. Deleted ${result.deletedCount} notifications.`,
      );
      process.exit(0);
    } else {
      console.error("[Cleanup] Job failed:", result.error);
      process.exit(1);
    }
  });
}
