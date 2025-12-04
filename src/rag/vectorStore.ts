/**
 * Vector store for semantic search.
 */
import { Document } from '@langchain/core/documents';
import { OpenAIEmbeddings } from '@langchain/openai';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';

/**
 * Vector store wrapper for semantic search.
 * Designed to be easily swappable with other vector stores.
 */
export class VectorStore {
  private embeddings: OpenAIEmbeddings;
  private vectorStore: MemoryVectorStore | null = null;

  constructor(embeddingModel: string = 'text-embedding-3-small') {
    this.embeddings = new OpenAIEmbeddings({ modelName: embeddingModel });
  }

  /**
   * Create vector store from documents.
   */
  async createFromDocuments(documents: Document[]): Promise<void> {
    if (documents.length === 0) {
      throw new Error('Cannot create vector store from empty document list');
    }

    this.vectorStore = await MemoryVectorStore.fromDocuments(documents, this.embeddings);
    console.log(`Vector store created with ${documents.length} documents`);
  }

  /**
   * Add documents to existing vector store.
   */
  async addDocuments(documents: Document[]): Promise<void> {
    if (this.vectorStore === null) {
      await this.createFromDocuments(documents);
    } else {
      await this.vectorStore.addDocuments(documents);
      console.log(`Added ${documents.length} documents to vector store`);
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
   * Save vector store to disk.
   * Note: MemoryVectorStore doesn't support file persistence
   */
  async save(_pathDir: string): Promise<void> {
    console.warn('MemoryVectorStore does not support saving to disk');
  }

  /**
   * Load vector store from disk.
   * Note: MemoryVectorStore doesn't support file persistence
   */
  async load(_pathDir: string): Promise<void> {
    console.warn('MemoryVectorStore does not support loading from disk');
  }
}
