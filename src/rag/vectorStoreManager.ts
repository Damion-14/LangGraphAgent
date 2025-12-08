/**
 * Manages vector store lifecycle with incremental updates based on file changes.
 */
import { VectorStore } from './vectorStore.js';
import { DocumentLoader } from './documentLoader.js';
import { ChangeResult, FileChangeTracker } from './fileChangeTracker.js';
import { FileScanner } from './fileScanner.js';
import path from 'path';

export interface VectorStoreSetupOptions {
  knowledgeBaseDir: string;
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
  vectorStorePath?: string;
  fileMetadataPath?: string;
}

/**
 * Handles vector store initialization with smart change detection.
 */
export class VectorStoreManager {
  private readonly vectorStore: VectorStore;
  private readonly docLoader: DocumentLoader;
  private readonly fileTracker: FileChangeTracker;
  private readonly knowledgeBaseDir: string;

  constructor(options: VectorStoreSetupOptions) {
    this.knowledgeBaseDir = options.knowledgeBaseDir;
    this.vectorStore = new VectorStore(
      options.embeddingModel,
      options.vectorStorePath
    );
    this.docLoader = new DocumentLoader(
      options.chunkSize,
      options.chunkOverlap
    );
    this.fileTracker = new FileChangeTracker(options.fileMetadataPath);
  }

  /**
   * Initialize vector store with smart change detection.
   * Only processes files that have changed since last run.
   */
  async initialize(): Promise<void> {
    const currentFiles = FileScanner.getSupportedFiles(this.knowledgeBaseDir);
    if (currentFiles.length === 0) {
      console.log('Warning: No documents found in knowledge base!');
      console.log(`Please add .txt, .md, or .pdf files to: ${this.knowledgeBaseDir}`);
      return;
    }

    const changes = this.fileTracker.detectChanges(currentFiles);
    console.log(
      `Found: ${changes.added.length} new, ${changes.modified.length} modified, ` +
      `${changes.removed.length} removed, ${changes.unchanged.length} unchanged`
    );

    const cacheLoaded = await this.tryLoadCache(changes);

    if (this.shouldProcessChanges(changes, cacheLoaded)) {
      await this.processChanges(changes, cacheLoaded);
    }

    console.log(`Vector store ready: ${this.vectorStore.getDocumentCount()} total documents`);
  }

  /**
   * Attempt to load vector store from cache.
   * Returns true if cache was successfully loaded.
   */
  private async tryLoadCache(changes: ChangeResult): Promise<boolean> {
    if (changes.unchanged.length === 0) {
      return false;
    }

    console.log('Loading cached vector store...');
    const loaded = await this.vectorStore.loadFromDisk();

    if (loaded) {
      console.log(`Vector store loaded from cache (${this.vectorStore.getDocumentCount()} documents)`);
    }

    return loaded;
  }

  /**
   * Determine if we need to process changes.
   */
  private shouldProcessChanges(changes: ChangeResult, cacheLoaded: boolean): boolean {
    const hasChanges = changes.added.length > 0 ||
      changes.modified.length > 0 ||
      changes.removed.length > 0;
    const needsRebuild = !cacheLoaded;

    return hasChanges || needsRebuild;
  }

  /**
   * Process file changes and update vector store.
   */
  private async processChanges(changes: ChangeResult, cacheLoaded: boolean): Promise<void> {
    console.log('Processing document changes...');

    await this.handleRemovedFiles(changes.removed);
    await this.handleModifiedFiles(changes.modified);
    await this.handleAddedFiles(changes.added, changes.modified);
    await this.handleMissingCache(changes, cacheLoaded);

    this.updateFileMetadata(changes);
  }

  /**
   * Remove documents from deleted files.
   */
  private async handleRemovedFiles(removedFiles: string[]): Promise<void> {
    if (removedFiles.length === 0) return;

    if (this.vectorStore.hasDocuments()) {
      await this.vectorStore.removeDocumentsBySource(removedFiles);
    }
    this.fileTracker.removeMetadata(removedFiles);
  }

  /**
   * Remove documents from modified files (they'll be re-added).
   */
  private async handleModifiedFiles(modifiedFiles: string[]): Promise<void> {
    if (modifiedFiles.length === 0) return;

    if (this.vectorStore.hasDocuments()) {
      await this.vectorStore.removeDocumentsBySource(modifiedFiles);
    }
  }

  /**
   * Process and add new/modified documents to vector store.
   */
  private async handleAddedFiles(addedFiles: string[], modifiedFiles: string[]): Promise<void> {
    const filesToProcess = [...addedFiles, ...modifiedFiles];
    if (filesToProcess.length === 0) return;

    const documents = await this.loadDocuments(filesToProcess);

    if (documents.length > 0) {
      await this.addDocumentsToStore(documents);
    }
  }

  /**
   * Load documents from file paths.
   */
  private async loadDocuments(filePaths: string[]) {
    const documents = [];

    for (const filePath of filePaths) {
      try {
        const docs = await this.docLoader.loadDocument(filePath);
        documents.push(...docs);
        console.log(`Processed ${path.basename(filePath)}: ${docs.length} chunks`);
      } catch (error) {
        console.log(`Error loading ${path.basename(filePath)}: ${error}`);
      }
    }

    return documents;
  }

  /**
   * Add documents to vector store (creates or appends based on state).
   */
  private async addDocumentsToStore(documents: any[]): Promise<void> {
    if (this.vectorStore.hasDocuments()) {
      // Append to existing store
      await this.vectorStore.addDocuments(documents);
    } else {
      // Create new store
      await this.vectorStore.createFromDocuments(documents);
    }
  }

  /**
   * Handle case where cache is missing but unchanged files exist.
   */
  private async handleMissingCache(changes: ChangeResult, cacheLoaded: boolean): Promise<void> {
    const cacheMissing = !cacheLoaded;
    const hasUnchangedFiles = changes.unchanged.length > 0;
    const storeEmpty = !this.vectorStore.hasDocuments();

    if (cacheMissing && hasUnchangedFiles && storeEmpty) {
      console.log('Cache missing - rebuilding vector store from all files...');
      const documents = await this.docLoader.loadDirectory(this.knowledgeBaseDir);
      await this.vectorStore.createFromDocuments(documents);
    }
  }

  /**
   * Update file tracking metadata.
   */
  private updateFileMetadata(changes: ChangeResult): void {
    this.fileTracker.updateMetadata([
      ...changes.added,
      ...changes.modified,
      ...changes.unchanged,
    ]);
  }

  /**
   * Get the managed vector store instance.
   */
  getVectorStore(): VectorStore {
    return this.vectorStore;
  }

  /**
   * Force rebuild of the entire vector store (ignores cache).
   */
  async forceRebuild(): Promise<void> {
    console.log('Force rebuilding vector store...');

    this.fileTracker.clearMetadata();
    const currentFiles = FileScanner.getSupportedFiles(this.knowledgeBaseDir);
    const documents = await this.docLoader.loadDirectory(this.knowledgeBaseDir);

    await this.vectorStore.createFromDocuments(documents);
    this.fileTracker.updateMetadata(currentFiles);

    console.log(`Vector store rebuilt: ${this.vectorStore.getDocumentCount()} documents`);
  }
}
