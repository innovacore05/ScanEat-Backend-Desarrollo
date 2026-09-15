
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { r2Client } from "../config/r2Client";
import { optimizeImage } from "../utils/optimizeImage";



const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function uploadImageToStorage(
  file: Express.Multer.File,
  folder: string
): Promise<string> {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new Error("Tipo de archivo no permitido. Solo JPG, PNG o WEBP.");
  }
//agregado nuevo para la optimizcion de imagenes

const optimizedBuffer=await optimizeImage (file.buffer);
const key = `${folder}/${randomUUID()}.webp`;



  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: optimizedBuffer,
      ContentType: "image/webp",
    })
  );

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

export async function deleteImageFromStorage(imageUrl: string): Promise<void> {
  const key = imageUrl.replace(`${process.env.R2_PUBLIC_URL}/`, "");

  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })
  );
}