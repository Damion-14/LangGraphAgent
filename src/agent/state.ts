/**
 * Agent state definition.
 */
import { Annotation } from '@langchain/langgraph';
import { Document } from '@langchain/core/documents';
import { Memory } from '../memory/memoryStore.js';

/**
 * Ticket field structure for helpdesk triaging.
 */
export interface TicketFields {
  title?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  priority?: 'Low' | 'Medium' | 'High' | 'Critical';
  urgency?: 'Low' | 'Medium' | 'High';
  userDetails?: {
    name?: string;
    email?: string;
    department?: string;
    location?: string;
  };
  impactDetails?: string;
  technicalDetails?: string;
}

/**
 * Category suggestion from RAG analysis.
 */
export interface CategorySuggestion {
  category: string;
  subcategory: string;
  confidence: number;
  reasoning: string;
}

/**
 * Conversation phases for ticket triaging.
 */
export type ConversationPhase =
  | 'initial_assessment'
  | 'gathering_details'
  | 'generating_ticket'
  | 'complete';

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

  // Helpdesk ticket triager fields
  conversationPhase: Annotation<ConversationPhase>,
  ticketFields: Annotation<TicketFields>,
  questionsAsked: Annotation<string[]>,
  questionCount: Annotation<number>,
  suggestedCategories: Annotation<CategorySuggestion[]>,
  formattedTicket: Annotation<string>,
  conversationHistory: Annotation<Array<{ role: 'user' | 'assistant'; content: string }>>,
});

export type AgentStateType = typeof AgentState.State;
