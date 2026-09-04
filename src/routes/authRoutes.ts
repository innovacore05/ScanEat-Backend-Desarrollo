import { Router } from "express";
import {
  forgotPassword,
  register,
  resendVerificationCode,
  resetPassword,
  verifyEmail,
  login,
  verifyLoginCode,
  resendLoginCode,
  resendResetCode,
  editProfile,
changePassword,
getProfile, verifyResetCode} from "../controllers/authController";

import { validateBody } from "../middleware/validations";
import { registerUserSchema } from "../db/schemas/userSchema";
import { authenticate } from "../middleware/authenticate";
import { updateUserSchema } from "../db/schemas/userSchema";
import {
  registerLimiter,
  verifyEmailLimiter,
  resendVerificationLimiter,
  loginLimiter,
  verifyLoginLimiter,
  resendLoginLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  resendResetLimiter,
  
} from "../middleware/rateLimiter";

//actualizacion de baackend
const router = Router();

router.post("/register", registerLimiter, validateBody(registerUserSchema), register);
router.post("/verify-email", verifyEmailLimiter, verifyEmail);
router.post("/resend-verification-code", resendVerificationLimiter, resendVerificationCode);
router.post("/login", loginLimiter, login);
router.post("/verify-login-code", verifyLoginLimiter, verifyLoginCode);
router.post("/resend-login-code", resendLoginLimiter, resendLoginCode);
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/verify-reset-code", verifyResetCode);
router.post("/reset-password", resetPasswordLimiter, resetPassword);
router.post("/resend-reset-code", resendResetLimiter, resendResetCode);

router.patch("/change-password", authenticate, changePassword);
router.patch("/edit-profile", authenticate,validateBody(updateUserSchema),editProfile);
router.get("/profile",authenticate,getProfile);



export default router;