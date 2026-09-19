// export const validateImage = (
//   file: Express.Multer.File | undefined,
//   maxSizeMB: number = 1
// ): string | null => {
//   if (!file) {
//     return "Selecciona una imagen para el platillo";
//   }
//   return null;
// };




export const validateImage = (
  file: Express.Multer.File | undefined,
  maxSizeMB: number = 10
): string | null => {
  if (!file) {
    return "Selecciona una imagen para el platillo";
  }


const allowedTypes=["image/jpeg", "image/png", "image/webp"];

if (!allowedTypes.includes(file.mimetype)){
  return "Formato no soportado.Usa JPG, PNG o WebP";
}
const maxBytes =maxSizeMB*1024*1024;
if(file.size>maxBytes){
  return `La imagen no puede superar ${maxSizeMB}MB`;
}
  return null;
};