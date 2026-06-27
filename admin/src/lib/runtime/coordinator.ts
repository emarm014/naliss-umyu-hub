import { realtimeCoordinator } from './realtime';
import { entitySyncEngine } from './sync';
import { networkManager } from './network';
import { memoryManager } from './memory';
import { diagnosticsManager } from './diagnostics';

class RuntimeCoordinator {
  private isInitialized = false;

  public initialize() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    diagnosticsManager.logTelemetry('runtime', 'Initializing RuntimeCoordinator...');
    
    // 1. Boot performance monitoring systems
    memoryManager.startMonitoring();
    networkManager.measureLatency();

    // 2. Coalesce real-time listener events to entitySyncEngine
    realtimeCoordinator.subscribe((payload) => {
      entitySyncEngine.handlePayload(payload);
    });

    diagnosticsManager.logTelemetry('runtime', 'RuntimeCoordinator successfully booted all subsystems');
  }

  public shutdown() {
    if (!this.isInitialized) return;
    this.isInitialized = false;

    diagnosticsManager.logTelemetry('runtime', 'Shutting down RuntimeCoordinator...');
    memoryManager.stopMonitoring();
    realtimeCoordinator.unsubscribe(entitySyncEngine.handlePayload);
  }
}

export const runtimeCoordinator = new RuntimeCoordinator();
