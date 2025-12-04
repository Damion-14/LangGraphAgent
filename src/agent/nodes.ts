/**
 * Agent node implementations.
 */
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { MemoryManager } from '../memory/memoryManager.js';
import { VectorStore } from '../rag/vectorStore.js';
import { AgentStateType } from './state.js';

/**
 * Node implementations for the agent graph.
 */
export class AgentNodes {
  private memoryManager: MemoryManager;
  private vectorStore: VectorStore;
  private llm: ChatOpenAI;

  constructor(
    memoryManager: MemoryManager,
    vectorStore: VectorStore,
    llmModel: string = 'gpt-4o-mini'
  ) {
    this.memoryManager = memoryManager;
    this.vectorStore = vectorStore;
    this.llm = new ChatOpenAI({ modelName: llmModel, temperature: 0.7 });
  }

  /**
   * Process and analyze the user query.
   */
  async queryProcessor(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const userQuery = state.userQuery;

    // For now, simple passthrough
    // Could be enhanced with query expansion, intent detection, etc.
    const processedQuery = userQuery.trim();

    return {
      processedQuery,
      iterationCount: (state.iterationCount || 0) + 1,
    };
  }

  /**
   * Retrieve relevant memories from active context and archive.
   */
  async memoryRetrieval(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const processedQuery = state.processedQuery;

    // Retrieve relevant memories
    const [activeMemories, recalledMemories] =
      await this.memoryManager.getRelevantContext(processedQuery, 5);

    // Get memory statistics
    const memoryStats = this.memoryManager.getMemoryStats();

    return {
      activeMemories,
      recalledMemories,
      memoryStats,
    };
  }

  /**
   * Retrieve relevant documents from knowledge base.
   */
  async ragRetrieval(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const processedQuery = state.processedQuery;

    // Retrieve relevant documents
    const ragDocuments = await this.vectorStore.similaritySearch(processedQuery, 3);

    return {
      ragDocuments,
    };
  }

  /**
   * Generate response using LLM with all context.
   */
  async llmResponse(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const userQuery = state.userQuery;
    const activeMemories = state.activeMemories || [];
    const recalledMemories = state.recalledMemories || [];
    const ragDocuments = state.ragDocuments || [];

    // Build context
    const contextParts: string[] = [];

    // Add recalled memories
    if (recalledMemories.length > 0) {
      contextParts.push('=== What You Know About the User (From Past) ===');
      for (const memory of recalledMemories) {
        contextParts.push(`- ${memory.content}`);
      }
      contextParts.push('');
    }

    // Add recent conversation
    if (activeMemories.length > 0) {
      contextParts.push('=== What You Know About the User (Recent) ===');
      for (const memory of [...activeMemories].reverse()) {
        // Chronological order
        contextParts.push(`- ${memory.content}`);
      }
      contextParts.push('');
    }

    // Add knowledge base documents
    if (ragDocuments.length > 0) {
      contextParts.push('=== Knowledge Base ===');
      for (const doc of ragDocuments) {
        const source = doc.metadata.source_file || 'unknown';
        contextParts.push(`[Source: ${source}]\n${doc.pageContent}\n`);
      }
    }

    const context = contextParts.join('\n');

    // Create prompt
    const systemPrompt = `You are a helpful AI assistant with access to:
1. A knowledge base of documents for answering questions
2. Personal information the user has shared with you (stored in memory)

Guidelines:
- Answer questions using the knowledge base when available
- Naturally incorporate what you know about the user when relevant
- Don't list out everything you remember unless asked
- Keep your responses focused and conversational
- Only the user's personal information is stored in memory (not our full conversations)

The memory helps you personalize responses, not to repeat what was said before.`;

    const messages = [new SystemMessage(systemPrompt)];

    if (context) {
      messages.push(new SystemMessage(`CONTEXT:\n${context}`));
    }

    messages.push(new HumanMessage(userQuery));

    // Generate response
    const response = await this.llm.invoke(messages);
    const agentResponse = response.content.toString();

    return {
      agentResponse,
    };
  }

  /**
   * Update memory with the new interaction.
   */
  async memoryUpdate(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const userQuery = state.userQuery;
    const agentResponse = state.agentResponse;

    // Add interaction to memory (only if it contains personal info)
    const memory = await this.memoryManager.addInteraction(userQuery, agentResponse, {
      iteration: state.iterationCount || 0,
    });

    // Log when memory is stored
    if (memory) {
      console.log(`\n[Memory Stored] ${memory.content}`);
    }

    // Get updated stats
    const memoryStats = this.memoryManager.getMemoryStats();

    return {
      memoryStats,
    };
  }
}
