/**
 * Agent state definition.
 */
import { Annotation } from '@langchain/langgraph';
import { Document } from '@langchain/core/documents';
import { Memory } from '../memory/memoryStore.js';

/**
 * State that flows through the agent graph.
 */
export const AgentState = Annotation.Root({
  // User input
  userQuery: Annotation<string>,

  // Processed query
  processedQuery: Annotation<string>,

  // Retrieved context
  activeMemories: Annotation<Memory[]>,
  recalledMemories: Annotation<Memory[]>,
  ragDocuments: Annotation<Document[]>,

  // LLM response
  agentResponse: Annotation<string>,

  // Metadata
  memoryStats: Annotation<Record<string, any>>,
  iterationCount: Annotation<number>,
});

export type AgentStateType = typeof AgentState.State;
