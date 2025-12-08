/**
 * RAG (Retrieval-Augmented Generation) module exports.
 *
 * This module provides document loading, vector storage, and intelligent
 * change detection for efficient knowledge base management.
 */

// Main manager - use this for most cases
export { VectorStoreManager, type VectorStoreSetupOptions } from './vectorStoreManager.js';

// Core components
export { VectorStore } from './vectorStore.js';
export { DocumentLoader } from './documentLoader.js';

// Change tracking
export { FileChangeTracker, type FileMetadata, type ChangeResult } from './fileChangeTracker.js';

// Utilities
export { FileScanner } from './fileScanner.js';
