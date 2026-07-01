import * as Sentry from '@sentry/react-native';
import { 
  captureDatabaseError, 
  trackSqlTransaction, 
  trackOfflineSync, 
  trackCloudinary,
  normalizeError
} from './sentry';

/**
 * Automated test triggers for Sentry Observability.
 * Call these functions programmatically to test unhandled and handled telemetry channels.
 */
export const ObservabilityVerification = {
  /**
   * Simulates an unhandled JavaScript exception inside React rendering or event handlers.
   * This should trigger Sentry to record a fatal event with stack trace and breadcrumbs.
   */
  triggerJsCrash: () => {
    console.log('[Observability] Triggering unhandled JS Exception...');
    throw new Error('NALISS Observability Verification: Simulated JavaScript unhandled crash.');
  },

  /**
   * Simulates a handled database error, such as a constraint violation or transaction rollback.
   */
  triggerDbError: () => {
    console.log('[Observability] Triggering SQLite handled error...');
    const err = new Error('Constraint failed: UNIQUE constraint failed: users.email');
    trackSqlTransaction('INSERT', 'INSERT INTO users (id, email) VALUES (?, ?)', 45, err);
    captureDatabaseError('INSERT', err, {
      userId: 'test-user-id',
      query: 'INSERT INTO users (id, email) VALUES (?, ?)',
      params: ['test-user-id', 'test@umyu.edu.ng'],
    });
  },

  /**
   * Simulates a Cloudinary upload network timeout or signature mismatch.
   */
  triggerCloudinaryError: () => {
    console.log('[Observability] Triggering Cloudinary handled error...');
    const err = new Error('Cloudinary Upload Timeout (408): Request failed after 15000ms');
    trackCloudinary('upload', 'avatar_test_public_id', 15000, err);
    Sentry.captureException(normalizeError(err), {
      tags: { service: 'Cloudinary', operation: 'upload', location: 'cloudinary.upload' },
      extra: { publicId: 'avatar_test_public_id', timeoutMs: 15000 },
    });
  },

  /**
   * Simulates an offline delta synchronization checksum validation failure.
   */
  triggerSyncError: () => {
    console.log('[Observability] Triggering Sync validation mismatch...');
    const err = new Error('Sync Engine Error: Hash verification failed for material file asset_manifest.json');
    trackOfflineSync('verification', 'failed', 320, {
      expectedHash: 'sha256:d7a8f7...',
      computedHash: 'sha256:e3b0c4...',
      filePath: 'file:///documentDirectory/assets/asset_manifest.json'
    });
    Sentry.captureException(normalizeError(err), {
      tags: { service: 'SyncEngine', stage: 'integrity_check', location: 'sync.verification' },
      extra: { expected: 'd7a8f7...', computed: 'e3b0c4...' }
    });
  }
};
