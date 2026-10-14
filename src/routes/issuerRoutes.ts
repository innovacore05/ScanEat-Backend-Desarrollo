import { Router } from "express";
import multer from "multer";
import { authenticate, requireRole } from "../middleware/authenticate";
import {
  getIssuer,
  saveIssuer,
  uploadCertificate,
} from "../controllers/issuerController";

const router = Router();

// el .p12 se queda en memoria, nunca se escribe en disco (máximo 64 KB)
const uploadP12 = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 },
});

router.get("/", authenticate, requireRole(1), getIssuer);
router.put("/", authenticate, requireRole(1), saveIssuer);
router.post(
  "/certificate",
  authenticate,
  requireRole(1),
  uploadP12.single("p12"),
  uploadCertificate,
);

export default router;