
export const validateImage = (
  file: Express.Multer.File | undefined,
  maxSizeMB: number = 1
): string | null => {
  if (!file) {
    return "Selecciona una imagen para el platillo";
  }

  if (file.size > maxSizeMB * 1024 * 1024) {
    return `La imagen no debe superar ${maxSizeMB} MB`;
  }

  return null;
};