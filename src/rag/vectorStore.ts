/**
 * Vector store for semantic search.
 */
import { Document } from '@langchain/core/documents';
import { OpenAIEmbeddings } from '@langchain/openai';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import fs from 'fs';
import path from 'path';

/**
 * Vector store wrapper for semantic search.
 * Designed to be easily swappable with other vector stores.
 */
export class VectorStore {
  private embeddings: OpenAIEmbeddings;
  private vectorStore: MemoryVectorStore | null = null;
  private documents: Document[] = [];
  private persistencePath: string;

  constructor(
    embeddingModel: string = 'text-embedding-3-small',
    persistencePath: string = './data/vector_documents.json'
  ) {
    this.embeddings = new OpenAIEmbeddings({ modelName: embeddingModel });
    this.persistencePath = persistencePath;
  }

  /**
   * Create vector store from documents.
   */
  async createFromDocuments(documents: Document[]): Promise<void> {
    if (documents.length === 0) {
      throw new Error('Cannot create vector store from empty document list');
    }

    this.documents = documents;
    this.vectorStore = await MemoryVectorStore.fromDocuments(documents, this.embeddings);
    await this.saveDocuments();
    console.log(`Vector store created with ${documents.length} documents`);
  }

  /**
   * Add documents to existing vector store.
   */
  async addDocuments(documents: Document[]): Promise<void> {
    if (this.vectorStore === null) {
      await this.createFromDocuments(documents);
    } else {
      this.documents.push(...documents);
      await this.vectorStore.addDocuments(documents);
      await this.saveDocuments();
      console.log(`Added ${documents.length} documents to vector store`);
    }
  }

  /**
   * Remove documents by source file.
   */
  async removeDocumentsBySource(sourceFiles: string[]): Promise<void> {
    const sourceFileSet = new Set(sourceFiles.map(f => path.basename(f)));

    // Filter out documents from removed files
    this.documents = this.documents.filter(
      doc => !sourceFileSet.has(doc.metadata.source_file)
    );

    // Rebuild vector store
    if (this.documents.length > 0) {
      this.vectorStore = await MemoryVectorStore.fromDocuments(this.documents, this.embeddings);
      await this.saveDocuments();
      console.log(`Removed documents from ${sourceFiles.length} files. ${this.documents.length} documents remaining.`);
    } else {
      this.vectorStore = null;
      console.log('All documents removed. Vector store is empty.');
    }
  }

  /**
   * Search for similar documents.
   */
  async similaritySearch(
    query: string,
    k: number = 3
  ): Promise<Document[]> {
    if (this.vectorStore === null) {
      return [];
    }

    const results = await this.vectorStore.similaritySearch(query, k);
    return results;
  }

  /**
   * Search for similar documents with relevance scores.
   */
  async similaritySearchWithScore(
    query: string,
    k: number = 3
  ): Promise<[Document, number][]> {
    if (this.vectorStore === null) {
      return [];
    }

    const results = await this.vectorStore.similaritySearchWithScore(query, k);
    return results;
  }

  /**
   * Save documents to disk for persistence.
   */
  private async saveDocuments(): Promise<void> {
    try {
      const dir = path.dirname(this.persistencePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Convert documents to serializable format
      const serializable = this.documents.map(doc => ({
        pageContent: doc.pageContent,
        metadata: doc.metadata,
      }));

      fs.writeFileSync(this.persistencePath, JSON.stringify(serializable, null, 2));
    } catch (error) {
      console.log(`Warning: Could not save documents: ${error}`);
    }
  }

  /**
   * Load documents from disk and rebuild vector store.
   */
  async loadFromDisk(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.persistencePath)) {
        return false;
      }

      const data = fs.readFileSync(this.persistencePath, 'utf-8');
      const serialized = JSON.parse(data);

      this.documents = serialized.map((item: any) => new Document({
        pageContent: item.pageContent,
        metadata: item.metadata,
      }));

      if (this.documents.length > 0) {
        this.vectorStore = await MemoryVectorStore.fromDocuments(this.documents, this.embeddings);
        console.log(`Loaded ${this.documents.length} documents from cache`);
        return true;
      }

      return false;
    } catch (error) {
      console.log(`Warning: Could not load documents: ${error}`);
      return false;
    }
  }

  /**
   * Check if vector store has any documents.
   */
  hasDocuments(): boolean {
    return this.documents.length > 0;
  }

  /**
   * Get count of documents in the store.
   */
  getDocumentCount(): number {
    return this.documents.length;
  }

  /**
   * Get statistics about the vector store.
   */
  getStats(): {
    totalChunks: number;
    sourceFiles: number;
    topFiles: Array<{ name: string; chunks: number }>;
  } {
    const fileChunks = new Map<string, number>();

    // Count chunks per file
    for (const doc of this.documents) {
      const sourceFile = doc.metadata.source_file || 'unknown';
      fileChunks.set(sourceFile, (fileChunks.get(sourceFile) || 0) + 1);
    }

    // Sort by chunk count and get top 10
    const topFiles = Array.from(fileChunks.entries())
      .map(([name, chunks]) => ({ name, chunks }))
      .sort((a, b) => b.chunks - a.chunks)
      .slice(0, 10);

    return {
      totalChunks: this.documents.length,
      sourceFiles: fileChunks.size,
      topFiles,
    };
  }
}
