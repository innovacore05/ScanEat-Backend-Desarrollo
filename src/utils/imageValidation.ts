export const validateImage = (file: Express.Multer.File | undefined): string | null => {
  if (!file) return "Selecciona una imagen para el platillo";
  return null;
};