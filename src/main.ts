/**
 * Main entry point for the LangGraph RAG Agent with Memory Management.
 */
import React from 'react';
import { render } from 'ink';
import { VectorStoreManager } from './rag/index.js';
import { MemoryStore } from './memory/memoryStore.js';
import { MemoryManager } from './memory/memoryManager.js';
import { createAgentGraph } from './agent/graph.js';
import { InteractiveChat } from './ui/InteractiveChat.js';
import * as config from './config.js';

async function setupSystem() {
  console.log('='.repeat(60));
  console.log('LangGraph RAG Agent with Memory Management');
  console.log('='.repeat(60));
  console.log();

  // Check for API key
  if (!config.OPENAI_API_KEY) {
    console.log('ERROR: OPENAI_API_KEY not found!');
    console.log('Please create a .env file with your OpenAI API key.');
    console.log('See .env.example for the format.');
    return null;
  }

  console.log('Step 1: Setting up vector store...');
  console.log('-'.repeat(60));

  // Initialize vector store manager
  const vectorStoreManager = new VectorStoreManager({
    knowledgeBaseDir: config.KNOWLEDGE_BASE_DIR,
    embeddingModel: config.EMBEDDING_MODEL,
    chunkSize: config.CHUNK_SIZE,
    chunkOverlap: config.CHUNK_OVERLAP,
    vectorStorePath: config.VECTOR_STORE_PATH,
    fileMetadataPath: config.FILE_METADATA_PATH,
  });

  try {
    await vectorStoreManager.initialize();
    const vectorStore = vectorStoreManager.getVectorStore();

    // Initialize memory system
    console.log('\nStep 2: Initializing memory system...');
    console.log('-'.repeat(60));
    const memoryStore = new MemoryStore(config.MEMORY_DB_PATH);
    const memoryManager = new MemoryManager(
      memoryStore,
      config.MAX_ACTIVE_MEMORIES,
      config.MEMORY_IMPORTANCE_THRESHOLD,
      config.MAX_CONTEXT_LENGTH,
      config.CONSOLIDATION_TRIGGER,
      config.LLM_MODEL
    );
    console.log('Memory system initialized');

    // Create agent graph
    console.log('\nStep 3: Building agent graph...');
    console.log('-'.repeat(60));
    const agent = createAgentGraph(memoryManager, vectorStore, config.LLM_MODEL);
    console.log('Agent graph compiled successfully');

    console.log('\n' + '='.repeat(60));
    console.log('System ready!');
    console.log('='.repeat(60));
    console.log('\n'.repeat(100));

    return { agent, memoryManager, vectorStore };
  } catch (error) {
    console.log(`Error loading documents: ${error}`);
    return null;
  }
}

async function runInteractive(agent: any, memoryManager: MemoryManager, vectorStore: any): Promise<void> {
  console.clear();
  render(React.createElement(InteractiveChat, { agent, memoryManager, vectorStore }));
}

async function main() {
  const result = await setupSystem();
  if (result === null) {
    return;
  }

  const { agent, memoryManager, vectorStore } = result;
  await runInteractive(agent, memoryManager, vectorStore);
}

main().catch(console.error);
