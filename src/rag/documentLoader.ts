/**
 * Document loading and processing for RAG.
 */
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import fs from 'fs';
import path from 'path';

/**
 * Loads and chunks documents from various file formats.
 */
export class DocumentLoader {
  private static readonly SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.pdf']);
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor(chunkSize: number = 1000, chunkOverlap: number = 200) {
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      lengthFunction: (text: string) => text.length,
    });
  }

  /**
   * Load a single document.
   */
  async loadDocument(filePath: string): Promise<Document[]> {
    const extension = path.extname(filePath).toLowerCase();

    if (!DocumentLoader.SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error(
        `Unsupported file type: ${extension}. ` +
          `Supported types: ${Array.from(DocumentLoader.SUPPORTED_EXTENSIONS).join(', ')}`
      );
    }

    // Select appropriate loader
    let loader;
    if (extension === '.txt' || extension === '.md') {
      loader = new TextLoader(filePath);
    } else if (extension === '.pdf') {
      loader = new PDFLoader(filePath);
    } else {
      throw new Error(`No loader available for extension: ${extension}`);
    }

    // Load and split documents
    const documents = await loader.load();
    const chunks = await this.textSplitter.splitDocuments(documents);

    // Add metadata
    const fileName = path.basename(filePath);
    for (const chunk of chunks) {
      chunk.metadata.source_file = fileName;
      chunk.metadata.file_type = extension;
    }

    return chunks;
  }

  /**
   * Load all supported documents from a directory.
   */
  async loadDirectory(directoryPath: string): Promise<Document[]> {
    if (!fs.existsSync(directoryPath)) {
      throw new Error(`Directory not found: ${directoryPath}`);
    }

    const allChunks: Document[] = [];

    // Process all supported files
    const files = this.getFilesRecursively(directoryPath);

    for (const filePath of files) {
      const extension = path.extname(filePath).toLowerCase();
      if (DocumentLoader.SUPPORTED_EXTENSIONS.has(extension)) {
        try {
          const chunks = await this.loadDocument(filePath);
          allChunks.push(...chunks);
          console.log(`Loaded ${chunks.length} chunks from ${path.basename(filePath)}`);
        } catch (error) {
          console.log(`Error loading ${path.basename(filePath)}: ${error}`);
        }
      }
    }

    console.log(`Total chunks loaded: ${allChunks.length}`);
    return allChunks;
  }

  /**
   * Recursively get all files in a directory.
   */
  private getFilesRecursively(dir: string): string[] {
    const files: string[] = [];
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...this.getFilesRecursively(fullPath));
      } else if (stat.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }
}
