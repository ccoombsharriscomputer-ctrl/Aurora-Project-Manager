import multer from "multer";
import path from "path";
import crypto from "crypto";

export const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const unique = crypto.randomBytes(16).toString("hex");
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});
