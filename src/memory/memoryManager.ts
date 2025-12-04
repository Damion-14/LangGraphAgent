/**
 * Memory manager with consolidation and importance scoring.
 */
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { get_encoding } from 'tiktoken';
import { Memory, MemoryStore } from './memoryStore.js';

export interface MemoryStats {
  activeMemories: number;
  archivedMemories: number;
  totalMemories: number;
  activeContextTokens: number;
  contextUtilization: number;
}

/**
 * Manages memory lifecycle: importance scoring, consolidation, and recall.
 */
export class MemoryManager {
  private store: MemoryStore;
  private maxActiveMemories: number;
  private importanceThreshold: number;
  private maxContextLength: number;
  private consolidationTrigger: number;
  private llm: ChatOpenAI;
  private embeddings: OpenAIEmbeddings;
  private tokenizer: any;
  private archiveVectorStore: MemoryVectorStore | null = null;

  constructor(
    memoryStore: MemoryStore,
    maxActiveMemories: number = 10,
    importanceThreshold: number = 5.0,
    maxContextLength: number = 4000,
    consolidationTrigger: number = 0.8,
    llmModel: string = 'gpt-4o-mini'
  ) {
    this.store = memoryStore;
    this.maxActiveMemories = maxActiveMemories;
    this.importanceThreshold = importanceThreshold;
    this.maxContextLength = maxContextLength;
    this.consolidationTrigger = consolidationTrigger;
    this.llm = new ChatOpenAI({ modelName: llmModel, temperature: 0 });
    this.embeddings = new OpenAIEmbeddings({ modelName: 'text-embedding-3-small' });
    this.tokenizer = get_encoding('cl100k_base');

    // Initialize archive index
    this.rebuildArchiveIndex();
  }

  /**
   * Add a new interaction to memory.
   * Only stores personal information shared by the user in summarized form.
   */
  async addInteraction(
    userMessage: string,
    _agentResponse: string,
    metadata?: Record<string, any>
  ): Promise<Memory | null> {
    // Extract personal information from the interaction
    const personalInfo = await this.extractPersonalInformation(userMessage);

    // If no personal information found, don't store the interaction
    if (!personalInfo) {
      return null;
    }

    // Score importance of the personal information
    const importance = await this.scoreImportance(personalInfo);

    const memory: Omit<Memory, 'id'> = {
      content: personalInfo,
      timestamp: new Date().toISOString(),
      importanceScore: importance,
      memoryType: 'preference',
      isArchived: false,
      metadata: metadata || {},
    };

    const memoryId = this.store.addMemory(memory);

    // Check if consolidation is needed
    await this.checkAndConsolidate();

    return {
      ...memory,
      id: memoryId,
    };
  }

  /**
   * Retrieve relevant context from active and archived memories.
   */
  async getRelevantContext(
    query: string,
    maxMemories: number = 5
  ): Promise<[Memory[], Memory[]]> {
    // Get recent active memories
    const activeMemories = this.store.getActiveMemories(maxMemories);

    // Semantic search in archived memories
    const archivedMemories = await this.recallFromArchive(query, Math.floor(maxMemories / 2));

    return [activeMemories, archivedMemories];
  }

  /**
   * Extract personal information from user message.
   * Returns a summarized version of personal info, or null if none found.
   */
  private async extractPersonalInformation(userMessage: string): Promise<string | null> {
    const prompt = `Analyze the following user message and extract ONLY personal information that should be remembered long-term.

Personal information includes:
- User's name, age, location, occupation
- User's preferences, interests, goals
- User's experiences, background, skills
- Important facts the user shares about themselves
- User's opinions or values

DO NOT extract:
- Questions the user is asking
- Generic statements that aren't about the user
- Information about topics they're learning about

User message: "${userMessage}"

If there is personal information, respond with a brief summary (1-2 sentences) starting with "User:"
If there is NO personal information, respond with exactly: "NONE"

Examples:
- "My name is Sarah and I work in healthcare" → "User: Name is Sarah, works in healthcare"
- "I prefer Python over JavaScript" → "User: Prefers Python programming language over JavaScript"
- "What is machine learning?" → "NONE"
- "Can you explain neural networks?" → "NONE"
- "I'm interested in reinforcement learning for my robotics project" → "User: Interested in reinforcement learning, working on a robotics project"`;

    try {
      const response = await this.llm.invoke(prompt);
      const result = response.content.toString().trim();

      if (result === 'NONE' || result.toLowerCase().includes('no personal information')) {
        return null;
      }

      return result;
    } catch (error) {
      console.error('Error extracting personal information:', error);
      return null;
    }
  }

  /**
   * Score the importance of a memory using LLM.
   */
  private async scoreImportance(content: string): Promise<number> {
    const prompt = `Rate the importance of remembering the following personal information on a scale of 1-10.

Consider:
- How unique and specific is this information?
- Will this likely be relevant in future conversations?
- Does it reveal important preferences or context about the user?

Information:
${content}

Respond with ONLY a number between 1 and 10.`;

    try {
      const response = await this.llm.invoke(prompt);
      const score = parseFloat(response.content.toString().trim());
      return Math.max(1.0, Math.min(10.0, score)); // Clamp between 1 and 10
    } catch {
      return 7.0; // Default to important since we only store personal info
    }
  }

  /**
   * Check if consolidation is needed and perform it.
   */
  private async checkAndConsolidate(): Promise<void> {
    const activeMemories = this.store.getActiveMemories();

    // Check count-based trigger
    if (activeMemories.length > this.maxActiveMemories) {
      await this.consolidateMemories();
      return;
    }

    // Check token-based trigger
    const totalTokens = activeMemories.reduce(
      (sum, m) => sum + this.tokenizer.encode(m.content).length,
      0
    );

    if (totalTokens > this.maxContextLength * this.consolidationTrigger) {
      await this.consolidateMemories();
    }
  }

  /**
   * Consolidate old/low-importance memories.
   * Archives memories that are old or have low importance scores.
   */
  private async consolidateMemories(): Promise<void> {
    const activeMemories = this.store.getActiveMemories();

    if (activeMemories.length === 0) {
      return;
    }

    const memoriesToArchive: Memory[] = [];

    // Strategy 1: Archive low-importance memories
    const lowImportance = activeMemories.filter(
      (m) => m.importanceScore < this.importanceThreshold
    );
    memoriesToArchive.push(...lowImportance);

    // Strategy 2: If still over limit, archive oldest memories
    const remaining = activeMemories.filter(
      (m) => !memoriesToArchive.includes(m)
    );

    if (remaining.length > this.maxActiveMemories) {
      // Sort by timestamp and archive oldest
      const remainingSorted = [...remaining].sort(
        (a, b) => a.timestamp.localeCompare(b.timestamp)
      );
      const numToArchive = remaining.length - this.maxActiveMemories;
      memoriesToArchive.push(...remainingSorted.slice(0, numToArchive));
    }

    // Perform archival
    if (memoriesToArchive.length > 0) {
      const memoryIds = memoriesToArchive
        .map((m) => m.id)
        .filter((id): id is number => id !== null);

      this.store.archiveMemories(memoryIds);
      await this.rebuildArchiveIndex();
      console.log(`Archived ${memoryIds.length} memories`);
    }
  }

  /**
   * Semantic search through archived memories.
   */
  private async recallFromArchive(query: string, k: number = 3): Promise<Memory[]> {
    if (this.archiveVectorStore === null) {
      return [];
    }

    try {
      // Semantic search
      const results = await this.archiveVectorStore.similaritySearch(query, k);

      // Convert back to Memory objects
      const archivedMemories = this.store.getArchivedMemories();
      const memoryMap = new Map(archivedMemories.map((m) => [m.content, m]));

      const recalled: Memory[] = [];
      for (const doc of results) {
        const memory = memoryMap.get(doc.pageContent);
        if (memory) {
          recalled.push(memory);
        }
      }

      return recalled;
    } catch {
      return [];
    }
  }

  /**
   * Rebuild vector index for archived memories.
   */
  private async rebuildArchiveIndex(): Promise<void> {
    const archivedMemories = this.store.getArchivedMemories();

    if (archivedMemories.length === 0) {
      this.archiveVectorStore = null;
      return;
    }

    // Create documents for vector store
    const documents = archivedMemories.map(
      (memory) =>
        new Document({
          pageContent: memory.content,
          metadata: { memoryId: memory.id, ...memory.metadata },
        })
    );

    try {
      this.archiveVectorStore = await MemoryVectorStore.fromDocuments(
        documents,
        this.embeddings
      );
    } catch {
      this.archiveVectorStore = null;
    }
  }

  /**
   * Get statistics about memory usage.
   */
  getMemoryStats(): MemoryStats {
    const activeCount = this.store.getMemoryCount(false);
    const archivedCount = this.store.getMemoryCount(true);
    const activeMemories = this.store.getActiveMemories();

    const totalTokens = activeMemories.reduce(
      (sum, m) => sum + this.tokenizer.encode(m.content).length,
      0
    );

    return {
      activeMemories: activeCount,
      archivedMemories: archivedCount,
      totalMemories: activeCount + archivedCount,
      activeContextTokens: totalTokens,
      contextUtilization: totalTokens / this.maxContextLength,
    };
  }

  /**
   * Format memories into a string for LLM prompt.
   */
  formatMemoriesForPrompt(
    activeMemories: Memory[],
    archivedMemories: Memory[]
  ): string {
    const contextParts: string[] = [];

    if (archivedMemories.length > 0) {
      contextParts.push('=== Recalled Past Context ===');
      for (const memory of archivedMemories) {
        contextParts.push(`[Recalled] ${memory.content}\n`);
      }
    }

    if (activeMemories.length > 0) {
      contextParts.push('=== Recent Conversation ===');
      for (const memory of [...activeMemories].reverse()) {
        // Chronological order
        contextParts.push(`${memory.content}\n`);
      }
    }

    return contextParts.join('\n');
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.tokenizer.free();
  }
}
