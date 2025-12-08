/**
 * Utility for scanning and finding supported files in a directory.
 */
import fs from 'fs';
import path from 'path';

const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.pdf'];

/**
 * Recursively scans a directory for supported document files.
 */
export class FileScanner {
  /**
   * Get all supported files from a directory recursively.
   */
  static getSupportedFiles(directory: string): string[] {
    if (!fs.existsSync(directory)) {
      return [];
    }

    return this.scanDirectory(directory);
  }

  /**
   * Recursively scan a directory for files.
   */
  private static scanDirectory(dir: string): string[] {
    const files: string[] = [];
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...this.scanDirectory(fullPath));
      } else if (stat.isFile() && this.isSupportedFile(fullPath)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Check if a file has a supported extension.
   */
  private static isSupportedFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext);
  }

  /**
   * Get list of supported file extensions.
   */
  static getSupportedExtensions(): string[] {
    return [...SUPPORTED_EXTENSIONS];
  }
}
