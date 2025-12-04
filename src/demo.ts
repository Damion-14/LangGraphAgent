/**
 * Demo script for the LangGraph RAG Agent with Memory Management.
 */
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render } from 'ink';
import { DocumentLoader } from './rag/documentLoader.js';
import { VectorStore } from './rag/vectorStore.js';
import { MemoryStore } from './memory/memoryStore.js';
import { MemoryManager } from './memory/memoryManager.js';
import { createAgentGraph } from './agent/graph.js';
import { AgentStateType } from './agent/state.js';
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

function printMemoryStats(memoryManager: MemoryManager): void {
  const stats = memoryManager.getMemoryStats();
  console.log('\n' + '-'.repeat(60));
  console.log('Memory Statistics:');
  console.log(`  Active memories: ${stats.activeMemories}`);
  console.log(`  Archived memories: ${stats.archivedMemories}`);
  console.log(`  Total memories: ${stats.totalMemories}`);
  console.log(`  Context tokens: ${stats.activeContextTokens}`);
  console.log(`  Context utilization: ${(stats.contextUtilization * 100).toFixed(1)}%`);
  console.log('-'.repeat(60));
}

async function runInteractiveDemo(agent: any, memoryManager: MemoryManager): Promise<void> {
  // Clear the console and render the Ink UI
  console.clear();

  render(React.createElement(InteractiveChat, { agent, memoryManager }));
}

async function runExampleConversation(agent: any, memoryManager: MemoryManager): Promise<void> {
  console.log('\nExample Conversation');
  console.log('='.repeat(60));
  console.log('Running a demo conversation to show memory and RAG capabilities...');
  console.log();

  const exampleQueries = [
    'What is machine learning?',
    'Can you explain the three types of machine learning you mentioned?',
    "What's LangGraph and how does it work?",
    "My name is Alex and I'm particularly interested in reinforcement learning.",
    'What are vector databases used for?',
    'Tell me more about FAISS, which you mentioned earlier.',
    'Based on what I told you earlier, which machine learning type should I focus on?',
    "What's the relationship between what I'm interested in and vector databases?",
  ];

  for (let i = 0; i < exampleQueries.length; i++) {
    const query = exampleQueries[i];
    console.log(`\n[Query ${i + 1}] You: ${query}`);

    const initialState: Partial<AgentStateType> = {
      userQuery: query,
      processedQuery: '',
      activeMemories: [],
      recalledMemories: [],
      ragDocuments: [],
      agentResponse: '',
      memoryStats: {},
      iterationCount: 0,
    };

    const result = await agent.invoke(initialState);
    console.log(`\nAgent: ${result.agentResponse}`);

    // Show when memory archival happens
    if ((i + 1) % 4 === 0) {
      printMemoryStats(memoryManager);
    }

    console.log('\n' + '-'.repeat(60));
  }

  console.log('\n' + '='.repeat(60));
  console.log('Example conversation completed!');
  console.log('Notice how the agent:');
  console.log('  - Retrieved information from the knowledge base');
  console.log('  - Remembered your name and interests');
  console.log('  - Connected information across the conversation');
  console.log('  - Managed memory by archiving older interactions');
  console.log('='.repeat(60));
}

async function main() {
  // Setup system
  const result = await setupSystem();
  if (result === null) {
    return;
  }

  const { agent, memoryManager } = result;

  // Choose mode
  console.log('\nChoose a mode:');
  console.log('  1. Run example conversation (automated demo)');
  console.log('  2. Interactive mode (chat with the agent)');
  console.log();

  // Wrap readline.question in a Promise
  const choice = await new Promise<string>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('Enter choice (1 or 2): ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (choice === '1') {
    await runExampleConversation(agent, memoryManager);
    // Final stats for example conversation
    console.log('\n\nFinal Memory Statistics:');
    printMemoryStats(memoryManager);
    process.exit(0);
  } else if (choice === '2') {
    // Interactive mode - let it control its own lifecycle
    await runInteractiveDemo(agent, memoryManager);
    // runInteractiveDemo will call process.exit when done
  } else {
    console.log('Invalid choice. Running example conversation...');
    await runExampleConversation(agent, memoryManager);
    // Final stats
    console.log('\n\nFinal Memory Statistics:');
    printMemoryStats(memoryManager);
    process.exit(0);
  }
}

main().catch(console.error);
