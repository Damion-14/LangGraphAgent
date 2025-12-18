/**
 * LangGraph agent graph construction.
 */
import { StateGraph, END } from '@langchain/langgraph';
import { MemoryManager } from '../memory/memoryManager.js';
import { VectorStore } from '../rag/vectorStore.js';
import { AgentState } from './state.js';
import { AgentNodes } from './nodes.js';

/**
 * Create the agent graph with all nodes and edges.
 */
export function createAgentGraph(
  memoryManager: MemoryManager,
  vectorStore: VectorStore,
  llmModel: string = 'gpt-4o-mini'
) {
  // Initialize nodes
  const nodes = new AgentNodes(memoryManager, vectorStore, llmModel);

  // Create graph with conditional routing for ticket triaging
  const workflow = new StateGraph(AgentState)
    // Add all nodes
    .addNode('queryProcessor', (state) => nodes.queryProcessor(state))
    .addNode('memoryRetrieval', (state) => nodes.memoryRetrieval(state))
    .addNode('conversationNode', (state) => nodes.conversationNode(state))
    .addNode('extractionNode', (state) => nodes.extractionNode(state))
    .addNode('categorizationNode', (state) => nodes.categorizationNode(state))
    .addNode('routingDecision', (state) => nodes.routingDecision(state))
    .addNode('ticketGenerator', (state) => nodes.ticketGenerator(state))
    .addNode('memoryUpdate', (state) => nodes.memoryUpdate(state))

    // Linear processing flow
    .addEdge('__start__', 'queryProcessor')
    .addEdge('queryProcessor', 'memoryRetrieval')
    .addEdge('memoryRetrieval', 'conversationNode')
    .addEdge('conversationNode', 'extractionNode')
    .addEdge('extractionNode', 'categorizationNode')
    .addEdge('categorizationNode', 'routingDecision')

    // Conditional routing based on conversation phase
    .addConditionalEdges(
      'routingDecision',
      (state) => {
        const phase = state.conversationPhase;
        if (phase === 'generating_ticket') {
          return 'generate';
        } else if (phase === 'complete') {
          return 'finish';
        } else {
          return 'continue';
        }
      },
      {
        generate: 'ticketGenerator',
        continue: 'memoryUpdate',
        finish: 'memoryUpdate'
      }
    )

    // Ticket generation flows to memoryUpdate
    .addEdge('ticketGenerator', 'memoryUpdate')

    // End
    .addEdge('memoryUpdate', END);

  // Compile graph
  return workflow.compile();
}
