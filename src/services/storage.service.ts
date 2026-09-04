// src/services/storage.service.ts
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { r2Client } from "../config/r2Client";
import sharp from "sharp";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_DIMENSION=1000;
const MAX_IMAGE_BYTES = 1024 * 1024;


//compresionq ue cumpla ocn 1 mb
async function compressToTarget(
  buffer:Buffer,
  maxBytes:number=MAX_IMAGE_BYTES
):Promise<Buffer>{
  let quality=80;
  let output=await sharp (buffer)
  .resize(MAX_DIMENSION,MAX_DIMENSION,{fit:"inside",withoutEnlargement:true})
.webp({quality})
.toBuffer();

//vuelve a comprimir si el peso es mucho aun 
  while (output.length > maxBytes && quality > 20) {
    quality -= 15;
    output = await sharp(buffer)
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
  }

  return output;
}


//sube la imagen a r2

export async function uploadImageToStorage(
  file: Express.Multer.File,
  folder: string
): Promise<string> {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new Error("Tipo de archivo no permitido. Solo JPG, PNG o WEBP.");
  }

  //verifica que lo que entra sea una imagen real , sharp falla si el buffer no es una imagen
  let processedBuffer: Buffer;
  try {
    processedBuffer = await compressToTarget(file.buffer);
  } catch {
    throw new Error("El archivo no es una imagen válida");
  }

//lo que entra se transforma en formato webp 
 
 const key = `${folder}/${randomUUID()}.webp`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: processedBuffer,
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