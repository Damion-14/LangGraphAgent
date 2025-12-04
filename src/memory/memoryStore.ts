/**
 * Storage backend for memory management using SQLite.
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/**
 * Represents a single memory entry.
 */
export interface Memory {
  id: number | null;
  content: string;
  timestamp: string;
  importanceScore: number;
  memoryType: 'interaction' | 'fact' | 'preference';
  isArchived: boolean;
  metadata: Record<string, any>;
}

/**
 * SQLite-based memory storage with semantic search capabilities.
 */
export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initDatabase();
  }

  /**
   * Initialize database schema.
   */
  private initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        importance_score REAL NOT NULL,
        memory_type TEXT NOT NULL,
        is_archived INTEGER NOT NULL,
        metadata TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_timestamp
      ON memories(timestamp)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_archived
      ON memories(is_archived)
    `);
  }

  /**
   * Add a new memory.
   */
  addMemory(memory: Omit<Memory, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO memories
      (content, timestamp, importance_score, memory_type, is_archived, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      memory.content,
      memory.timestamp,
      memory.importanceScore,
      memory.memoryType,
      memory.isArchived ? 1 : 0,
      JSON.stringify(memory.metadata)
    );

    return info.lastInsertRowid as number;
  }

  /**
   * Retrieve active (non-archived) memories.
   */
  getActiveMemories(limit?: number): Memory[] {
    let query = `
      SELECT id, content, timestamp, importance_score, memory_type, is_archived, metadata
      FROM memories
      WHERE is_archived = 0
      ORDER BY timestamp DESC
    `;

    if (limit !== undefined) {
      query += ` LIMIT ${limit}`;
    }

    const rows = this.db.prepare(query).all() as any[];
    return rows.map(this.rowToMemory);
  }

  /**
   * Retrieve archived memories.
   */
  getArchivedMemories(limit?: number): Memory[] {
    let query = `
      SELECT id, content, timestamp, importance_score, memory_type, is_archived, metadata
      FROM memories
      WHERE is_archived = 1
      ORDER BY timestamp DESC
    `;

    if (limit !== undefined) {
      query += ` LIMIT ${limit}`;
    }

    const rows = this.db.prepare(query).all() as any[];
    return rows.map(this.rowToMemory);
  }

  /**
   * Archive memories by their IDs.
   */
  archiveMemories(memoryIds: number[]): void {
    if (memoryIds.length === 0) return;

    const placeholders = memoryIds.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `UPDATE memories SET is_archived = 1 WHERE id IN (${placeholders})`
    );

    stmt.run(...memoryIds);
  }

  /**
   * Update importance score of a memory.
   */
  updateImportanceScore(memoryId: number, newScore: number): void {
    const stmt = this.db.prepare(
      'UPDATE memories SET importance_score = ? WHERE id = ?'
    );

    stmt.run(newScore, memoryId);
  }

  /**
   * Simple text-based search through memories.
   */
  searchMemories(
    query: string,
    isArchived?: boolean,
    limit: number = 5
  ): Memory[] {
    let sql = `
      SELECT id, content, timestamp, importance_score, memory_type, is_archived, metadata
      FROM memories
      WHERE content LIKE ?
    `;

    const params: any[] = [`%${query}%`];

    if (isArchived !== undefined) {
      sql += ' AND is_archived = ?';
      params.push(isArchived ? 1 : 0);
    }

    sql += ' ORDER BY importance_score DESC, timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.rowToMemory);
  }

  /**
   * Get count of memories.
   */
  getMemoryCount(isArchived?: boolean): number {
    let query: string;
    let params: any[] = [];

    if (isArchived === undefined) {
      query = 'SELECT COUNT(*) as count FROM memories';
    } else {
      query = 'SELECT COUNT(*) as count FROM memories WHERE is_archived = ?';
      params = [isArchived ? 1 : 0];
    }

    const result = this.db.prepare(query).get(...params) as { count: number };
    return result.count;
  }

  /**
   * Clear all memories from the store.
   */
  clearAllMemories(): void {
    this.db.prepare('DELETE FROM memories').run();
  }

  /**
   * Convert database row to Memory object.
   */
  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      content: row.content,
      timestamp: row.timestamp,
      importanceScore: row.importance_score,
      memoryType: row.memory_type,
      isArchived: Boolean(row.is_archived),
      metadata: JSON.parse(row.metadata),
    };
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
