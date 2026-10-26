
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { r2Client } from "../config/r2Client";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function uploadImageToStorage(
  file: Express.Multer.File,
  folder: string
): Promise<string> {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new Error("Tipo de archivo no permitido. Solo JPG, PNG o WEBP.");
  }

  const extension = file.originalname.split(".").pop();
  const key = `${folder}/${randomUUID()}.${extension}`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
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


export async function uploadInvoiceToStorage(
  file: Express.Multer.File
): Promise<string> {
  if (
    file.mimetype !== "application/pdf" ||
    !file.originalname.toLowerCase().endsWith(".pdf")
  ) {
    throw new Error("Tipo de archivo no permitido. Solo se aceptan archivos PDF.");
  }

  const key = `invoices/${randomUUID()}.pdf`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: file.buffer,
      ContentType: "application/pdf",
      ContentDisposition: "attachment",
    })
  );

  return key;
}


export async function deleteInvoiceFromStorage(
  key: string
): Promise<void> {
  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })
  );
}


export async function downloadInvoiceFromStorage(key: string) {
  const response = await r2Client.send(
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })
  );

  if (!response.Body) {
    throw new Error("No se encontró el archivo de la factura.");
  }

  return response.Body;
}
