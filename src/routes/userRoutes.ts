import { Router } from "express";
import {
  deleteUser,
  getUserById,
  getUsers,
  updateUser,
} from "../controllers/userController";
import { authenticate, requireRole } from "../middleware/authenticate";
import { validateBody, validateParams } from "../middleware/validations";
import {
  adminUpdateUserSchema,
  userParamsSchema,
} from "../db/schemas/userSchema";

const router = Router();

router.get("/", authenticate, requireRole(1), getUsers);
router.get("/:id",authenticate,requireRole(1),validateParams(userParamsSchema),getUserById,);
router.put("/:id",authenticate,requireRole(1),validateParams(userParamsSchema),validateBody(adminUpdateUserSchema),updateUser,);
router.patch("/:id",authenticate,requireRole(1),validateParams(userParamsSchema),validateBody(adminUpdateUserSchema),updateUser,);
router.delete("/:id",authenticate,requireRole(1),validateParams(userParamsSchema),deleteUser,);

export default router;
