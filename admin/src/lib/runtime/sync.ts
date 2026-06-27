import { useAdminDataStore } from '../../store/adminData.store';
import { diagnosticsManager } from './diagnostics';

class EntitySyncEngine {
  public async handlePayload(payload: {
    table: string;
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    newRecord: any;
    oldRecord: any;
  }) {
    diagnosticsManager.startTimer(`entity_sync_${payload.table}`);
    
    try {
      const store = useAdminDataStore.getState();
      await store.handleRealtimeEvent(payload);
      
      diagnosticsManager.logTelemetry('sync', `EntitySyncEngine synchronized entity in "${payload.table}"`, {
        id: payload.newRecord?.id || payload.oldRecord?.id,
        type: payload.eventType,
      });
    } catch (err) {
      diagnosticsManager.logTelemetry('sync', `EntitySyncEngine synchronization failed for "${payload.table}"`, {
        error: (err as Error).message,
      });
    } finally {
      diagnosticsManager.endTimer(`entity_sync_${payload.table}`, 'sync');
    }
  }
}

export const entitySyncEngine = new EntitySyncEngine();
