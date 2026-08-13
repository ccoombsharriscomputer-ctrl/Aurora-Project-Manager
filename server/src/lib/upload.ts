import multer from "multer";

// Files are held in memory only during the request — the route handler is responsible for
// persisting them via lib/storage.ts, which is what actually decides where the bytes end up
// (local disk or Azure Blob Storage).
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
