/**
 * Agent node implementations.
 */
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { MemoryManager } from '../memory/memoryManager.js';
import { VectorStore } from '../rag/vectorStore.js';
import { AgentStateType } from './state.js';
import { EventEmitter } from 'events';

// Increase max listeners to prevent memory leak warnings
EventEmitter.defaultMaxListeners = 20;

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
    this.llm = new ChatOpenAI({
      modelName: llmModel,
      maxRetries: 2,
    });
  }

  /**
   * Process and analyze the user query.
   */
  async queryProcessor(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const userQuery = state.userQuery;
    const processedQuery = userQuery.trim();

    // Initialize conversation phase on first turn
    const conversationPhase = state.conversationPhase || 'initial_assessment';

    // Initialize ticket fields if not present
    const ticketFields = state.ticketFields || { userDetails: {} };

    // Initialize conversation history if not present
    const conversationHistory = state.conversationHistory || [];

    return {
      processedQuery,
      conversationPhase,
      ticketFields,
      conversationHistory,
      iterationCount: (state.iterationCount || 0) + 1,
      questionsAsked: state.questionsAsked || [],
      questionCount: state.questionCount || 0,
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

    // Extract user details from memories
    const userDetails = this.extractUserDetailsFromMemories([
      ...activeMemories,
      ...recalledMemories,
    ]);

    return {
      activeMemories,
      recalledMemories,
      memoryStats,
      ticketFields: {
        ...state.ticketFields,
        userDetails: {
          ...state.ticketFields?.userDetails,
          ...userDetails,
        },
      },
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
   * Generate phase-aware conversation response.
   */
  async conversationNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const phase = state.conversationPhase || 'initial_assessment';

    // Build context sections
    const contextParts: string[] = [];

    // Memory context
    if (state.recalledMemories?.length || state.activeMemories?.length) {
      contextParts.push(this.buildMemoryContext(state));
    }

    // Current ticket fields
    if (state.ticketFields && Object.keys(state.ticketFields).length > 0) {
      contextParts.push(`\n=== Ticket Information Collected ===\n${JSON.stringify(state.ticketFields, null, 2)}`);
    }

    // Category suggestions
    if (state.suggestedCategories?.length > 0) {
      contextParts.push(`\n=== Suggested Categories ===\n${state.suggestedCategories.slice(0, 3).map((c, i) =>
        `${i+1}. ${c.category} → ${c.subcategory} (${(c.confidence * 100).toFixed(0)}% confidence)`
      ).join('\n')}`);
    }

    // Build phase-specific system prompt
    const systemPrompt = this.buildSystemPrompt(phase, state);
    const context = contextParts.join('\n');

    // Build messages with full conversation history
    const messages = [
      new SystemMessage(systemPrompt),
      new SystemMessage(`CONTEXT:\n${context}`)
    ];

    // Add conversation history
    const history = state.conversationHistory || [];
    for (const msg of history) {
      if (msg.role === 'user') {
        messages.push(new HumanMessage(msg.content));
      } else {
        messages.push(new SystemMessage(`Assistant: ${msg.content}`));
      }
    }

    // Add current user query
    messages.push(new HumanMessage(state.userQuery));

    // Debug logging
    console.log('\n=== LLM Messages (conversationNode) ===');
    console.log(`Total messages: ${messages.length}`);
    console.log(`History turns: ${history.length / 2}`);
    messages.forEach((msg, idx) => {
      const role = msg instanceof HumanMessage ? 'USER' : 'SYSTEM';
      const preview = msg.content.toString().substring(0, 100);
      console.log(`[${idx}] ${role}: ${preview}${msg.content.toString().length > 100 ? '...' : ''}`);
    });
    console.log('=== End LLM Messages ===\n');

    const response = await this.llm.invoke(messages);
    return { agentResponse: response.content.toString() };
  }

  /**
   * Extract ticket fields from user responses.
   */
  async extractionNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    // Build conversation context for extraction
    const conversationContext = (state.conversationHistory || [])
      .filter(msg => msg.role === 'user')
      .map(msg => msg.content)
      .join('\n');

    const extractionPrompt = `Extract ticket information from the conversation.

Full conversation (user messages):
${conversationContext}

Current message: "${state.userQuery}"
Previous ticket fields: ${JSON.stringify(state.ticketFields, null, 2)}

Extract and return JSON with these fields (only include fields you can identify from ALL user messages):
{
  "title": "Brief issue summary",
  "description": "Detailed description combining all information from user",
  "userDetails": { "name": "...", "email": "...", "department": "...", "location": "..." },
  "impactDetails": "How many users affected, business impact",
  "technicalDetails": "Error messages, system details, URLs, specific systems mentioned"
}

Return valid JSON only.`;

    try {
      const response = await this.llm.invoke([
        new SystemMessage("You extract structured data. Return JSON only."),
        new HumanMessage(extractionPrompt)
      ]);

      const extracted = JSON.parse(response.content.toString());
      const updatedTicketFields = this.deepMerge(state.ticketFields, extracted);

      // Track questions
      const questionsAsked = [...(state.questionsAsked || [])];
      if (this.isQuestion(state.agentResponse)) {
        questionsAsked.push(state.agentResponse);
      }

      return {
        ticketFields: updatedTicketFields,
        questionsAsked,
        questionCount: questionsAsked.length
      };
    } catch (error) {
      // If extraction fails, return unchanged state
      console.warn('Extraction failed:', error);
      return {};
    }
  }

  /**
   * Categorize issue using RAG.
   */
  async categorizationNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const queryText = [
      state.ticketFields?.title,
      state.ticketFields?.description,
      state.ticketFields?.technicalDetails
    ].filter(Boolean).join(' ');

    if (!queryText) {
      return { suggestedCategories: [] };
    }

    // Retrieve more documents for better categorization
    const ragDocuments = await this.vectorStore.similaritySearch(queryText, 10);

    const categorizationPrompt = `Based on the helpdesk issue and knowledge base excerpts, suggest the top 3 most appropriate categories.

ISSUE:
${queryText}

KNOWLEDGE BASE EXCERPTS:
${ragDocuments.map((doc, i) => `[${i+1}] ${doc.pageContent}\nSource: ${doc.metadata.source_file}`).join('\n\n')}

Return JSON array:
[
  {
    "category": "Category from knowledge base",
    "subcategory": "Subcategory",
    "confidence": 0.95,
    "reasoning": "Why this fits"
  }
]`;

    try {
      const response = await this.llm.invoke([
        new SystemMessage("You categorize helpdesk tickets. Return JSON only."),
        new HumanMessage(categorizationPrompt)
      ]);

      const suggestedCategories = JSON.parse(response.content.toString());
      return { suggestedCategories, ragDocuments };
    } catch (error) {
      console.warn('Categorization failed:', error);
      return { suggestedCategories: [], ragDocuments };
    }
  }

  /**
   * Decide next conversation phase.
   */
  async routingDecision(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const phase = state.conversationPhase || 'initial_assessment';
    const fields = state.ticketFields || {};
    const questionCount = state.questionCount || 0;

    let nextPhase = phase;

    if (phase === 'initial_assessment') {
      nextPhase = 'gathering_details';
    }
    else if (phase === 'gathering_details') {
      // Check for minimum required fields
      const hasRequired =
        fields.title &&
        fields.description &&
        fields.userDetails?.name &&
        fields.userDetails?.email;

      const hasEnoughInfo = questionCount >= 3 || (fields.description?.length || 0) > 100;
      const maxQuestionsReached = questionCount >= 5;

      if (hasRequired && (hasEnoughInfo || maxQuestionsReached)) {
        nextPhase = 'generating_ticket';
      }
    }
    else if (phase === 'generating_ticket') {
      nextPhase = 'complete';
    }

    return { conversationPhase: nextPhase };
  }

  /**
   * Generate formatted ticket.
   */
  async ticketGenerator(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const fields = state.ticketFields!;
    const topCategory = state.suggestedCategories?.[0];

    // Assess priority/urgency with LLM
    const priorityPrompt = `Analyze this ticket and assign Priority and Urgency.

Description: ${fields.description}
Impact: ${fields.impactDetails || 'Not specified'}

Priority: Critical/High/Medium/Low (see guidelines)
Urgency: High/Medium/Low (see guidelines)

Return JSON: {"priority": "High", "urgency": "Medium", "reasoning": "..."}`;

    try {
      const priorityResponse = await this.llm.invoke([
        new SystemMessage("You assess ticket priority. Return JSON only."),
        new HumanMessage(priorityPrompt)
      ]);

      const { priority, urgency, reasoning } = JSON.parse(priorityResponse.content.toString());

      // Format ticket
      const formattedTicket = `# Helpdesk Ticket

## Summary
**Title:** ${fields.title}
**Category:** ${topCategory?.category || 'General'} → ${topCategory?.subcategory || 'Not Sure'}
**Priority:** ${priority} | **Urgency:** ${urgency}

## Description
${fields.description}

## User Details
- **Name:** ${fields.userDetails?.name || 'Not provided'}
- **Email:** ${fields.userDetails?.email || 'Not provided'}
- **Department:** ${fields.userDetails?.department || 'N/A'}
- **Location:** ${fields.userDetails?.location || 'N/A'}

## Impact & Technical Details
${fields.impactDetails ? `**Impact:** ${fields.impactDetails}\n` : ''}${fields.technicalDetails ? `**Technical Details:** ${fields.technicalDetails}\n` : ''}

## Categorization
**Selected:** ${topCategory?.category} → ${topCategory?.subcategory} (${(topCategory?.confidence * 100).toFixed(0)}%)
**Reasoning:** ${topCategory?.reasoning}

**Alternatives:**
${state.suggestedCategories?.slice(1, 3).map((c, i) =>
  `${i+2}. ${c.category} → ${c.subcategory} (${(c.confidence * 100).toFixed(0)}%)`).join('\n') || 'None'}

## Priority Assessment
${reasoning}

---
*Generated by AI Helpdesk Triager*`;

      const agentResponse = `I've created your helpdesk ticket:\n\n${formattedTicket}\n\nDoes this look correct?`;

      return {
        formattedTicket,
        ticketFields: { ...fields, category: topCategory?.category, subcategory: topCategory?.subcategory, priority, urgency },
        agentResponse,
        conversationPhase: 'complete'
      };
    } catch (error) {
      console.error('Ticket generation failed:', error);
      return {
        agentResponse: 'I encountered an error generating your ticket. Let me try again.',
        conversationPhase: 'gathering_details'
      };
    }
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

    // Store ticket summary if complete
    if (state.conversationPhase === 'complete' && state.ticketFields?.title) {
      const ticketSummary = `Created ticket: ${state.ticketFields.title} (${state.ticketFields.category || 'General'})`;
      await this.memoryManager.addInteraction(
        ticketSummary,
        'Ticket created',
        { type: 'ticket', iteration: state.iterationCount || 0 }
      );
    }

    // Store user details if newly collected
    if (state.ticketFields?.userDetails) {
      const details = state.ticketFields.userDetails;
      const detailsStr = Object.entries(details)
        .filter(([_, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');

      if (detailsStr) {
        await this.memoryManager.addInteraction(
          detailsStr,
          'User details collected',
          { type: 'user_details', iteration: state.iterationCount || 0 }
        );
      }
    }

    // Update conversation history
    const conversationHistory = [...(state.conversationHistory || [])];
    conversationHistory.push({ role: 'user', content: userQuery });
    conversationHistory.push({ role: 'assistant', content: agentResponse });

    // Get updated stats
    const memoryStats = this.memoryManager.getMemoryStats();

    return {
      memoryStats,
      conversationHistory,
    };
  }

  /**
   * Helper: Build system prompt based on conversation phase.
   */
  private buildSystemPrompt(phase: string, state: AgentStateType): string {
    const conversationTurns = (state.conversationHistory?.length || 0) / 2;
    const isFirstMessage = conversationTurns === 0;

    const basePrompt = `You are a professional IT helpdesk ticket triager. Your role is to guide users through creating comprehensive support tickets.

## Your Responsibilities:
1. Initial Assessment: Understand the user's issue
2. Information Gathering: Ask 3-5 targeted questions to collect details
3. Auto-Categorization: Match issues to knowledge base categories
4. Ticket Generation: Create formatted, ready-to-submit tickets

## Guidelines:
- Be professional, empathetic, and efficient
- Ask ONE clear question at a time
- Don't ask for information already in memory or already provided in the conversation
- Acknowledge user frustration when expressed
- ${isFirstMessage ? 'This is the first message - greet the user warmly' : 'This is an ongoing conversation - DO NOT greet again, just continue naturally'}
- If the user provides new information, acknowledge it briefly and ask your next question
- Keep responses concise and focused on gathering ticket information

## Information Priorities:
CRITICAL: Issue description, user name/contact, category
IMPORTANT: Impact, urgency, technical details, timeline
NICE TO HAVE: Department, location, device details

## Priority Levels:
- Critical: System down, multiple users, production outage, security incident
- High: Single user blocked, deadline risk, degraded service
- Medium: Inconvenience with workarounds, feature requests
- Low: Questions, minor enhancements, cosmetic issues

## Urgency Levels:
- High: Immediate action (hours), deadline today/tomorrow
- Medium: Needed within 1-3 days
- Low: No specific timeline

## Current Phase: ${phase}`;

    const phaseInstructions: Record<string, string> = {
      initial_assessment: isFirstMessage
        ? "\n\nGreet the user warmly and ask them to describe their issue in their own words."
        : "\n\nContinue the conversation naturally. Ask them to elaborate on their issue.",
      gathering_details: `\n\nYou've asked ${state.questionCount || 0} questions so far. Continue gathering missing critical information. Ask your next most important question WITHOUT greeting the user again.`,
      generating_ticket: "\n\nYou have enough information. Proceed to generate the complete ticket now.",
      complete: "\n\nThe ticket has been generated. Answer any follow-up questions the user may have."
    };

    return basePrompt + (phaseInstructions[phase] || '');
  }

  /**
   * Helper: Build memory context string.
   */
  private buildMemoryContext(state: AgentStateType): string {
    const parts = [];
    if (state.recalledMemories?.length > 0) {
      parts.push('=== User Info (Past) ===');
      state.recalledMemories.forEach(m => parts.push(`- ${m.content}`));
    }
    if (state.activeMemories?.length > 0) {
      parts.push('\n=== User Info (Recent) ===');
      state.activeMemories.forEach(m => parts.push(`- ${m.content}`));
    }
    return parts.join('\n');
  }

  /**
   * Helper: Extract user details from memories.
   */
  private extractUserDetailsFromMemories(memories: any[]): Partial<any> {
    const userDetails: any = {};

    for (const memory of memories) {
      const content = memory.content || '';

      // Look for name patterns
      const nameMatch = content.match(/(?:name is|I'm|I am) (\w+)/i);
      if (nameMatch && !userDetails.name) {
        userDetails.name = nameMatch[1];
      }

      // Look for email patterns
      const emailMatch = content.match(/email[:\s]+([^\s,]+@[^\s,]+)/i);
      if (emailMatch && !userDetails.email) {
        userDetails.email = emailMatch[1];
      }

      // Look for department patterns
      const deptMatch = content.match(/department[:\s]+([^,.\n]+)/i);
      if (deptMatch && !userDetails.department) {
        userDetails.department = deptMatch[1].trim();
      }

      // Look for location patterns
      const locationMatch = content.match(/location[:\s]+([^,.\n]+)/i);
      if (locationMatch && !userDetails.location) {
        userDetails.location = locationMatch[1].trim();
      }
    }

    return userDetails;
  }

  /**
   * Helper: Deep merge two objects.
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
        result[key] = source[key];
      }
    }
    return result;
  }

  /**
   * Helper: Check if text is a question.
   */
  private isQuestion(text: string | undefined): boolean {
    if (!text) return false;
    return text.includes('?') || /^(what|when|where|who|how|can you|could you|please|tell me)/i.test(text);
  }
}
