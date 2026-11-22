
import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

// Genera el hash que se almacena en la columna "code".
export const hashBusinessCode = (code: string): string => {
  const secret = process.env.BUSINESS_CODE_SECRET;

  if (!secret) {
    throw new Error(
      "La variable BUSINESS_CODE_SECRET no está configurada"
    );
  }

  return createHmac("sha256", secret)
    .update(code.trim().toUpperCase())
    .digest("hex");
};

// Obtiene la clave de cifrado de 32 bytes.
const getEncryptionKey = (): Buffer => {
  const secret = process.env.BUSINESS_CODE_ENCRYPTION_KEY;

  if (!secret) {
    throw new Error(
      "La variable BUSINESS_CODE_ENCRYPTION_KEY no está configurada"
    );
  }

  const key = Buffer.from(secret, "base64");

  if (key.length !== 32) {
    throw new Error(
      "La clave de cifrado debe tener exactamente 32 bytes"
    );
  }

  return key;
};

// Cifra el código original para guardarlo en "code_encrypted".
export const encryptBusinessCode = (code: string): string => {
  const key = getEncryptionKey();
  const iv = randomBytes(12);

  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(code.trim().toUpperCase(), "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
};

// Descifra el código para mostrarlo cuando sea necesario.
export const decryptBusinessCode = (encryptedCode: string): string => {
  const key = getEncryptionKey();
  const parts = encryptedCode.split(":");

  if (parts.length !== 3) {
    throw new Error("El código cifrado tiene un formato inválido");
  }

  const [ivBase64, authTagBase64, encryptedBase64] = parts;

  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");
  const encrypted = Buffer.from(encryptedBase64, "base64");

  if (iv.length !== 12 || authTag.length !== 16) {
    throw new Error("El código cifrado tiene un formato inválido");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, iv);

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
};
