import fs from "fs";
import path from "path";
import crypto from "crypto";
import { BlobServiceClient, RestError } from "@azure/storage-blob";

export const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

// Every attachment (project or task) goes through this single abstraction rather than
// touching the filesystem or a cloud SDK directly — the two upload routes and the three
// attachment read/delete routes only ever see this interface, so swapping backends never
// means hunting through the codebase for fs.* calls.
export interface FileStorage {
  // Persists a freshly-uploaded file and returns the opaque key to store on the
  // Attachment row (a local filename today; a blob name if Azure is configured).
  save(buffer: Buffer, originalName: string, mimeType: string): Promise<string>;
  // A readable stream of the file's bytes, for piping straight into an Express response.
  // Rejects if the key doesn't exist.
  getStream(key: string): Promise<NodeJS.ReadableStream>;
  delete(key: string): Promise<void>;
}

function randomKey(originalName: string): string {
  return `${crypto.randomBytes(16).toString("hex")}${path.extname(originalName)}`;
}

class LocalDiskStorage implements FileStorage {
  constructor() {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  async save(buffer: Buffer, originalName: string): Promise<string> {
    const key = randomKey(originalName);
    await fs.promises.writeFile(path.join(UPLOAD_DIR, key), buffer);
    return key;
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    const filePath = path.join(UPLOAD_DIR, key);
    await fs.promises.access(filePath);
    return fs.createReadStream(filePath);
  }

  async delete(key: string): Promise<void> {
    await fs.promises.unlink(path.join(UPLOAD_DIR, key)).catch(() => null);
  }
}

// Local disk is fine for a single-instance dev setup, but doesn't survive a redeploy or
// scale-out on most cloud hosts (Render's free tier included) — set
// AZURE_STORAGE_CONNECTION_STRING to move attachments to durable Blob Storage instead.
// Nothing else in the app needs to change: the container is created on first use, and
// existing Attachment rows keep working since `storedFilename` is just an opaque key either way.
class AzureBlobStorage implements FileStorage {
  private client: BlobServiceClient;
  private containerName: string;
  private containerReady: Promise<void> | null = null;

  constructor(connectionString: string, containerName: string) {
    this.client = BlobServiceClient.fromConnectionString(connectionString);
    this.containerName = containerName;
  }

  private async ensureContainer() {
    if (!this.containerReady) {
      this.containerReady = this.client.getContainerClient(this.containerName).createIfNotExists().then(() => undefined);
    }
    await this.containerReady;
  }

  async save(buffer: Buffer, originalName: string, mimeType: string): Promise<string> {
    await this.ensureContainer();
    const key = randomKey(originalName);
    const blockBlobClient = this.client.getContainerClient(this.containerName).getBlockBlobClient(key);
    await blockBlobClient.upload(buffer, buffer.length, { blobHTTPHeaders: { blobContentType: mimeType } });
    return key;
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    await this.ensureContainer();
    const blockBlobClient = this.client.getContainerClient(this.containerName).getBlockBlobClient(key);
    try {
      const download = await blockBlobClient.download();
      if (!download.readableStreamBody) {
        throw new Error(`Blob "${key}" has no readable body`);
      }
      return download.readableStreamBody;
    } catch (err) {
      if (err instanceof RestError && err.statusCode === 404) {
        throw new Error(`Blob "${key}" not found`);
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.ensureContainer();
    await this.client.getContainerClient(this.containerName).getBlockBlobClient(key).deleteIfExists();
  }
}

function createStorage(): FileStorage {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || "attachments";
    return new AzureBlobStorage(connectionString, containerName);
  }
  return new LocalDiskStorage();
}

export const storage: FileStorage = createStorage();
