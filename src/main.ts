/**
 * Main entry point for the LangGraph RAG Agent with Memory Management.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render } from 'ink';
import { DocumentLoader } from './rag/documentLoader.js';
import { VectorStore } from './rag/vectorStore.js';
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

  console.log('Step 1: Loading knowledge base...');
  console.log('-'.repeat(60));

  // Load documents
  const docLoader = new DocumentLoader(config.CHUNK_SIZE, config.CHUNK_OVERLAP);

  try {
    const documents = await docLoader.loadDirectory(config.KNOWLEDGE_BASE_DIR);
    if (documents.length === 0) {
      console.log('Warning: No documents found in knowledge base!');
      console.log(
        `Please add .txt, .md, or .pdf files to: ${config.KNOWLEDGE_BASE_DIR}`
      );
    }

    // Create vector store
    console.log('\nStep 2: Creating vector store...');
    console.log('-'.repeat(60));
    const vectorStore = new VectorStore(config.EMBEDDING_MODEL);
    await vectorStore.createFromDocuments(documents);

    // Initialize memory system
    console.log('\nStep 3: Initializing memory system...');
    console.log('-'.repeat(60));
    const dir = path.dirname(config.MEMORY_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
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
    console.log('\nStep 4: Building agent graph...');
    console.log('-'.repeat(60));
    const agent = createAgentGraph(memoryManager, vectorStore, config.LLM_MODEL);
    console.log('Agent graph compiled successfully');

    console.log('\n' + '='.repeat(60));
    console.log('System ready!');
    console.log('='.repeat(60));
    console.log();

    return { agent, memoryManager };
  } catch (error) {
    console.log(`Error loading documents: ${error}`);
    return null;
  }
}

async function runInteractive(agent: any, memoryManager: MemoryManager): Promise<void> {
  console.clear();
  render(React.createElement(InteractiveChat, { agent, memoryManager }));
}

async function main() {
  const result = await setupSystem();
  if (result === null) {
    return;
  }

  const { agent, memoryManager } = result;
  await runInteractive(agent, memoryManager);
}

main().catch(console.error);
