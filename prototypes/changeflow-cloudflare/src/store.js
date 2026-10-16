import { validateTaskDocument } from './domain.js';

/**
 * TaskStore port implemented by every persistence adapter.
 *
 * get(taskId) -> TaskDocument | null
 * create(document) -> boolean (false only when taskId already exists)
 * compareAndSwap(taskId, expectedRevision, nextDocument) -> boolean
 *   The write succeeds only when the stored revision is expectedRevision and
 *   nextDocument.revision is expectedRevision + 1. No partial writes are allowed.
 *
 * Keep this contract expressed only in Changeflow concepts. Backend-specific
 * tokens (D1 rows, GitHub blob SHAs, Azure ETags) stay inside adapters.
 */
export class D1TaskStore {
  constructor(db) {
    if (!db) throw new Error('Missing D1 binding: DB.');
    this.db = db;
  }

  async get(taskId) {
    const row = await this.db.prepare('SELECT document_json FROM task_blobs WHERE task_id = ?')
      .bind(taskId).first();
    if (!row) return null;
    return JSON.parse(row.document_json);
  }

  async checkConnection() {
    await this.db.prepare('SELECT 1 AS ok').first();
    return { driver: 'd1', connected: true };
  }

  async create(document) {
    validateTaskDocument(document);
    try {
      const result = await this.db.prepare('INSERT INTO task_blobs (task_id, document_json) VALUES (?, ?)')
        .bind(document.taskId, JSON.stringify(document)).run();
      return result.meta.changes === 1;
    } catch (error) {
      if (/UNIQUE constraint failed|PRIMARY KEY/i.test(String(error?.message))) return false;
      throw error;
    }
  }

  async compareAndSwap(taskId, expectedRevision, nextDocument) {
    validateTaskDocument(nextDocument);
    if (nextDocument.taskId !== taskId || nextDocument.revision !== expectedRevision + 1) throw new Error('Invalid task CAS write.');
    const result = await this.db.prepare(`
      UPDATE task_blobs
      SET document_json = ?
      WHERE task_id = ? AND json_extract(document_json, '$.revision') = ?
    `).bind(JSON.stringify(nextDocument), taskId, expectedRevision).run();
    return result.meta.changes === 1;
  }
}

export class MemoryTaskStore {
  constructor() { this.documents = new Map(); }
  async checkConnection() { return { driver: 'memory', connected: true }; }
  async get(taskId) { const document = this.documents.get(taskId); return document ? structuredClone(document) : null; }
  async create(document) { validateTaskDocument(document); if (this.documents.has(document.taskId)) return false; this.documents.set(document.taskId, structuredClone(document)); return true; }
  async compareAndSwap(taskId, expectedRevision, nextDocument) {
    validateTaskDocument(nextDocument);
    const current = this.documents.get(taskId);
    if (!current || current.revision !== expectedRevision) return false;
    if (nextDocument.taskId !== taskId || nextDocument.revision !== expectedRevision + 1) throw new Error('Invalid task CAS write.');
    this.documents.set(taskId, structuredClone(nextDocument)); return true;
  }
}
