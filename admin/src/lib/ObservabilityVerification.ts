import * as Sentry from '@sentry/react';
import { trackCloudinary } from './sentry';

/**
 * Verification module to trigger mock errors and traces on the admin panel to test Sentry's dashboard logs.
 */
export const ObservabilityVerification = {
  triggerJsCrash: () => {
    console.log('[Observability] Triggering unhandled React exception...');
    throw new Error('NALISS Admin Observability: Simulated unhandled React exception.');
  },

  triggerCloudinaryError: () => {
    console.log('[Observability] Triggering Cloudinary mock error...');
    const err = new Error('Cloudinary Upload Timeout (408): Mock Admin upload failed.');
    trackCloudinary('upload', 'mock_admin_public_id', 4500, err);
    Sentry.captureException(err, {
      tags: { service: 'Cloudinary', operation: 'upload', location: 'cloudinary.upload' },
      extra: { fileName: 'mock_test.jpg', isSigned: true }
    });
  },

  triggerSupabaseError: () => {
    console.log('[Observability] Triggering Supabase mock error...');
    const err = new Error('PostgrestError (409): Unique constraint violation on department_code');
    Sentry.captureException(err, {
      tags: { service: 'Supabase', operation: 'insert', location: 'supabase.fetchWithRetry' },
      extra: { path: '/rest/v1/departments', method: 'POST', attempt: 1 }
    });
  }
};
