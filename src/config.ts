/**
 * Configuration settings for the RAG agent.
 */
import dotenv from 'dotenv';

dotenv.config();

// OpenAI Configuration
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Model Configuration
export const LLM_MODEL = "gpt-5-nano";
export const EMBEDDING_MODEL = "text-embedding-3-small";

// RAG Configuration
export const KNOWLEDGE_BASE_DIR = "./knowledge_base";
export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 200;
export const TOP_K_DOCUMENTS = 3;
export const VECTOR_STORE_PATH = "./data/vector_documents.json";
export const FILE_METADATA_PATH = "./data/file_metadata.json";

// Memory Configuration
export const MAX_ACTIVE_MEMORIES = 10; // Maximum memories in active context
export const MEMORY_IMPORTANCE_THRESHOLD = 5; // Memories below this score get archived faster
export const MEMORY_DB_PATH = "./data/memory_store.db";
export const MEMORY_ARCHIVE_PATH = "./data/memory_archive";

// Agent Configuration
export const MAX_CONTEXT_LENGTH = 4000; // Tokens
export const CONSOLIDATION_TRIGGER = 0.8; // Trigger consolidation at 80% context capacity

// Helpdesk Ticket Triager Configuration
export const MIN_QUESTIONS_BEFORE_TICKET = 3;
export const MAX_QUESTIONS_BEFORE_FORCED_TICKET = 5;
export const MIN_DESCRIPTION_LENGTH = 100;
export const CATEGORY_SEARCH_TOP_K = 10;  // Increased for better categorization

// Priority Keywords
export const CRITICAL_KEYWORDS = [
  'down', 'outage', 'production', 'security', 'breach', 'data loss',
  'all users', 'multiple users', 'critical', 'emergency'
];

export const HIGH_URGENCY_KEYWORDS = [
  'urgent', 'asap', 'immediately', 'deadline', 'today', 'tomorrow',
  'blocked', 'cannot work', 'stuck'
];
