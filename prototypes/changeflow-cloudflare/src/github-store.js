import { DomainError, validateTaskDocument } from './domain.js';

// The Contents endpoint returns base64 `content` for files up to 1 MiB.
// Keep a safety margin for API representation changes and base64 transport.
export const MAX_GITHUB_DOCUMENT_BYTES = 900_000;
const API_VERSION = '2022-11-28';

export class GitHubStorageError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'GitHubStorageError';
    this.status = status;
  }
}

/**
 * TaskStore implementation that stores one JSON file per Task:
 *   tasks/<taskId>.json
 *
 * GitHub's file blob SHA is an adapter-private concurrency token. The Task
 * JSON schema and callers remain identical to D1TaskStore/Azure Blob stores.
 */
export class GitHubContentsTaskStore {
  constructor({ owner, repo, branch = 'main', token, fetchImpl = fetch, apiUrl = 'https://api.github.com' }) {
    if (!owner || !repo || !branch || !token) throw new Error('GitHub storage requires owner, repo, branch, and token.');
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.apiUrl = apiUrl.replace(/\/$/, '');
  }

  async get(taskId) {
    const file = await this.readFile(taskId);
    return file?.document ?? null;
  }

  /** Verify that the configured GitHub credential can reach the private data repo and branch. */
  async checkConnection() {
    const repository = await this.requestJson(`${this.apiUrl}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`, 'GitHub repository check failed');
    if (repository.private !== true || !Number.isSafeInteger(repository.id) || typeof repository.full_name !== 'string') {
      throw new GitHubStorageError('The configured Changeflow data repository must be private.', 400);
    }
    const branch = await this.requestJson(`${this.apiUrl}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/branches/${encodeURIComponent(this.branch)}`, 'GitHub branch check failed');
    if (branch.name !== this.branch) throw new GitHubStorageError('GitHub returned a different branch than the configured data branch.', 502);
    return {
      driver: 'github',
      connected: true,
      repository: { id: repository.id, fullName: repository.full_name, private: repository.private },
      branch: branch.name,
    };
  }

  async create(document) {
    validateGithubDocument(document);
    const existing = await this.readFile(document.taskId);
    if (existing) return false;
    try {
      const response = await this.writeFile(document.taskId, document, null);
      return response.status === 201;
    } catch (error) {
      if (error instanceof GitHubStorageError && [409, 422].includes(error.status)) {
        // Concurrent creates may race. Report duplicate only if the path now exists.
        if (await this.readFile(document.taskId)) return false;
      }
      throw error;
    }
  }

  async compareAndSwap(taskId, expectedRevision, nextDocument) {
    validateGithubDocument(nextDocument);
    if (nextDocument.taskId !== taskId || nextDocument.revision !== expectedRevision + 1) throw new Error('Invalid task CAS write.');
    const current = await this.readFile(taskId);
    if (!current || current.document.revision !== expectedRevision) return false;
    try {
      await this.writeFile(taskId, nextDocument, current.blobSha);
      return true;
    } catch (error) {
      if (error instanceof GitHubStorageError && [409, 422].includes(error.status)) {
        // A stale file SHA is a failed CAS. If the Task is still at the expected
        // revision, preserve the API error instead of misreporting a stale write.
        const latest = await this.readFile(taskId);
        if (!latest || latest.document.revision !== expectedRevision) return false;
      }
      throw error;
    }
  }

  async readFile(taskId) {
    const response = await this.fetchImpl(this.fileUrl(taskId), { method: 'GET', headers: this.headers() });
    if (response.status === 404) return null;
    if (!response.ok) throw await this.responseError('GitHub file read failed', response);
    const file = await response.json();
    if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' || typeof file.sha !== 'string') {
      throw new GitHubStorageError('GitHub returned an unsupported Task file representation.', 502);
    }
    let document;
    try {
      document = JSON.parse(decodeBase64(file.content));
      validateGithubDocument(document);
    } catch (error) {
      throw new GitHubStorageError(`Stored Task JSON is invalid: ${error.message}`, 502);
    }
    if (document.taskId !== taskId) throw new GitHubStorageError('Stored Task ID does not match its file path.', 502);
    return { document, blobSha: file.sha };
  }

  async writeFile(taskId, document, blobSha) {
    const response = await this.fetchImpl(this.fileUrl(taskId), {
      method: 'PUT',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({
        message: `Changeflow: update ${taskId} to revision ${document.revision}`,
        content: encodeBase64(JSON.stringify(document)),
        ...(blobSha ? { sha: blobSha } : {}),
        branch: this.branch,
      }),
    });
    if (response.status !== 200 && response.status !== 201) throw await this.responseError('GitHub file write failed', response);
    return response;
  }

  fileUrl(taskId) {
    const path = `tasks/${encodeURIComponent(taskId)}.json`;
    return `${this.apiUrl}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${path}?ref=${encodeURIComponent(this.branch)}`;
  }

  headers() {
    return {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${this.token}`,
      'x-github-api-version': API_VERSION,
      'user-agent': 'changeflow-prototype',
    };
  }

  async responseError(context, response) {
    // Do not include response bodies, which may echo repository details.
    return new GitHubStorageError(`${context} (HTTP ${response.status}).`, response.status);
  }

  async requestJson(url, context) {
    const response = await this.fetchImpl(url, { method: 'GET', headers: this.headers() });
    if (!response.ok) throw await this.responseError(context, response);
    try {
      return await response.json();
    } catch {
      throw new GitHubStorageError(`${context} (invalid JSON response).`, 502);
    }
  }
}

function validateGithubDocument(document) {
  const size = validateTaskDocument(document);
  if (size > MAX_GITHUB_DOCUMENT_BYTES) {
    throw new DomainError(`Task JSON exceeds the GitHub storage cap of ${MAX_GITHUB_DOCUMENT_BYTES} bytes.`, 413, 'document_too_large');
  }
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
