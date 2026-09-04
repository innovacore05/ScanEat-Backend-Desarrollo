import { Request, Response, NextFunction } from "express";
import { verifyToken, CustomJWTPayload } from "../utils/jwt";

export interface AuthRequest extends Request {
  user?: CustomJWTPayload;
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // const authHeader = req.headers.authorization;
    const token = req.cookies?.token;

    // if (!authHeader || !authHeader.startsWith("Bearer ")) {
    //   return res.status(401).json({
    //     message: "Token required",
    //   });
    // }

    // const token = authHeader.slice(7).trim();
if (!token) {
      return res.status(401).json({
        message: "Token required",
      });
    }
    const payload = await verifyToken(token);

    req.user = payload;
    next();
  } catch {
    return res.status(401).json({
      message: "Invalid token",
    });
  }
};