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

  // Create graph
  const workflow = new StateGraph(AgentState)
    // Add nodes
    .addNode('queryProcessor', (state) => nodes.queryProcessor(state))
    .addNode('memoryRetrieval', (state) => nodes.memoryRetrieval(state))
    .addNode('ragRetrieval', (state) => nodes.ragRetrieval(state))
    .addNode('llmResponse', (state) => nodes.llmResponse(state))
    .addNode('memoryUpdate', (state) => nodes.memoryUpdate(state))
    // Define edges (execution flow)
    .addEdge('__start__', 'queryProcessor')
    .addEdge('queryProcessor', 'memoryRetrieval')
    .addEdge('memoryRetrieval', 'ragRetrieval')
    .addEdge('ragRetrieval', 'llmResponse')
    .addEdge('llmResponse', 'memoryUpdate')
    .addEdge('memoryUpdate', END);

  // Compile graph
  return workflow.compile();
}
