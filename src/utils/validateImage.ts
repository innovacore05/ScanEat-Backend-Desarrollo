export const validateImage = (
  file: Express.Multer.File | undefined,
  maxSizeMB: number = 1
): string | null => {
  if (!file) {
    return "Selecciona una imagen para el platillo";
  }
  return null;
};