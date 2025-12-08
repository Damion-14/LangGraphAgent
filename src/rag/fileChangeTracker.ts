/**
 * Tracks file changes to avoid unnecessary re-processing of documents.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface FileMetadata {
  filePath: string;
  lastModified: number;
  size: number;
  hash: string;
}

export interface ChangeResult {
  added: string[];
  modified: string[];
  removed: string[];
  unchanged: string[];
}

/**
 * Tracks file changes using modification time and file hash.
 */
export class FileChangeTracker {
  private metadataPath: string;
  private fileMetadata: Map<string, FileMetadata>;

  constructor(metadataPath: string = './data/file_metadata.json') {
    this.metadataPath = metadataPath;
    this.fileMetadata = new Map();
    this.loadMetadata();
  }

  /**
   * Load stored metadata from disk.
   */
  private loadMetadata(): void {
    try {
      if (fs.existsSync(this.metadataPath)) {
        const data = fs.readFileSync(this.metadataPath, 'utf-8');
        const entries: [string, FileMetadata][] = JSON.parse(data);
        this.fileMetadata = new Map(entries);
      }
    } catch (error) {
      console.log(`Warning: Could not load file metadata: ${error}`);
      this.fileMetadata = new Map();
    }
  }

  /**
   * Save metadata to disk.
   */
  private saveMetadata(): void {
    try {
      const dir = path.dirname(this.metadataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const entries = Array.from(this.fileMetadata.entries());
      fs.writeFileSync(this.metadataPath, JSON.stringify(entries, null, 2));
    } catch (error) {
      console.log(`Warning: Could not save file metadata: ${error}`);
    }
  }

  /**
   * Calculate file hash for change detection.
   */
  private calculateFileHash(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get current metadata for a file.
   */
  private getCurrentFileMetadata(filePath: string): FileMetadata {
    const stats = fs.statSync(filePath);
    const hash = this.calculateFileHash(filePath);

    return {
      filePath,
      lastModified: stats.mtimeMs,
      size: stats.size,
      hash,
    };
  }

  /**
   * Detect changes in a list of files compared to stored metadata.
   */
  detectChanges(currentFiles: string[]): ChangeResult {
    const result: ChangeResult = {
      added: [],
      modified: [],
      removed: [],
      unchanged: [],
    };

    const currentFileSet = new Set(currentFiles);
    const previousFileSet = new Set(this.fileMetadata.keys());

    // Check each current file
    for (const filePath of currentFiles) {
      if (!previousFileSet.has(filePath)) {
        // New file
        result.added.push(filePath);
      } else {
        // Existing file - check if modified
        const currentMetadata = this.getCurrentFileMetadata(filePath);
        const previousMetadata = this.fileMetadata.get(filePath)!;

        // Compare hash for accurate change detection
        if (currentMetadata.hash !== previousMetadata.hash) {
          result.modified.push(filePath);
        } else {
          result.unchanged.push(filePath);
        }
      }
    }

    // Check for removed files
    for (const filePath of previousFileSet) {
      if (!currentFileSet.has(filePath)) {
        result.removed.push(filePath);
      }
    }

    return result;
  }

  /**
   * Update metadata for processed files.
   */
  updateMetadata(files: string[]): void {
    for (const filePath of files) {
      if (fs.existsSync(filePath)) {
        const metadata = this.getCurrentFileMetadata(filePath);
        this.fileMetadata.set(filePath, metadata);
      }
    }
    this.saveMetadata();
  }

  /**
   * Remove metadata for specific files.
   */
  removeMetadata(files: string[]): void {
    for (const filePath of files) {
      this.fileMetadata.delete(filePath);
    }
    this.saveMetadata();
  }

  /**
   * Clear all stored metadata.
   */
  clearMetadata(): void {
    this.fileMetadata.clear();
    this.saveMetadata();
  }

  /**
   * Get all tracked files.
   */
  getTrackedFiles(): string[] {
    return Array.from(this.fileMetadata.keys());
  }
}
