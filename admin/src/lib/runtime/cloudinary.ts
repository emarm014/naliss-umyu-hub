import { uploadToCloudinary } from '../cloudinary';
import { diagnosticsManager } from './diagnostics';

class CloudinaryCoordinator {
  private uploadQueue: (() => Promise<any>)[] = [];
  private activeUploads = 0;
  private maxConcurrentUploads = 3; // Limit to 3 parallel uploads to prevent browser choking

  public async upload(file: File, folder = 'admin_uploads'): Promise<{ secure_url: string; original_filename: string }> {
    diagnosticsManager.startTimer(`cloudinary_upload_${file.name}`);
    
    return new Promise((resolve, reject) => {
      const task = async () => {
        try {
          this.activeUploads++;
          const result = await uploadToCloudinary(file, folder);
          resolve(result);
        } catch (err) {
          diagnosticsManager.logTelemetry('cloudinary', `Upload failed for ${file.name}`, { error: (err as Error).message });
          reject(err);
        } finally {
          this.activeUploads--;
          diagnosticsManager.endTimer(`cloudinary_upload_${file.name}`, 'cloudinary');
          this.processQueue();
        }
      };

      this.uploadQueue.push(task);
      this.processQueue();
    });
  }

  private processQueue() {
    if (this.activeUploads >= this.maxConcurrentUploads || this.uploadQueue.length === 0) return;
    const nextTask = this.uploadQueue.shift();
    if (nextTask) {
      nextTask();
    }
  }
}

export const cloudinaryCoordinator = new CloudinaryCoordinator();
