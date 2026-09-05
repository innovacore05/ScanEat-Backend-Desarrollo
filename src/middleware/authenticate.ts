import { Request, Response, NextFunction } from "express";
import { verifyToken, CustomJWTPayload } from "../utils/jwt";
import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { users } from "../db/schemas/userSchema";

export interface AuthRequest extends Request {
  user?: CustomJWTPayload;
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Token required",
      });
    }

    const token = authHeader.slice(7).trim();

    const payload = await verifyToken(token);

    const [user] = await db
      .select({
        user_id: users.user_id,
        email: users.email,
        role_id: users.role_id,
      })
      .from(users)
      .where(eq(users.user_id, payload.user_id))
      .limit(1);

    if (!user) {
      return res.status(401).json({
        message: "User not found",
      });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({
      message: "Invalid token",
    });
  }
};

export const requireRole = (...allowedRoles: number[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        message: "Authentication required",
      });
    }

    if (!allowedRoles.includes(req.user.role_id)) {
      return res.status(403).json({
        message: "Insufficient permissions",
      });
    }

    next();
  };
};