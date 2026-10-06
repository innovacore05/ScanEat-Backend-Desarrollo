import { Router } from "express";

import {testGemini,createSalesReport,
} from "../controllers/aiController";

import {
  authenticate,
  requireRole,
} from "../middleware/authenticate";

const router = Router();

router.get("/test", testGemini);

router.post("/sales-report",authenticate,requireRole(1, 2, 3, 4),createSalesReport,);


export default router;