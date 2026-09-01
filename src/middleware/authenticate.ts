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
    //cambio
    const token=req.cookies?.authToken;
    if(!token){
      return res.status(401).json({
        message:"Token required",
      });
    }

const payload = await verifyToken(token);
req.user=payload;
next();
  }catch{
    return res.status(401).json({
      message:"Invalid token",
    });
  }
};
//INSTALAR
  //    npm install cookie-parser
  //  npm install -D @types/cookie-parser