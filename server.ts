import env from './env';


import app from './src/app';

import authRoutes from './src/routes/authRoutes';
import { Request,Response,NextFunction } from 'express';
import menuRoutes from './src/routes/menuRoutes';
import mesaRoutes from './src/routes/mesaRoutes';
import userRoutes from './src/routes/userRoutes';
import orderRoutes from './src/routes/orderRoutes';
import reviewRoutes from "./src/routes/reviewRoutes";
import businessRoutes from "./src/routes/businessRoutes";
import themeRoutes from "./src/routes/themeRoutes";
import publicThemeRoutes from "./src/routes/publicThemeRoutes";
import multer from "multer";

app.use('/api/auth', authRoutes);
app.use("/api/menu",menuRoutes);
app.use('/api/table', mesaRoutes);
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/businesses', businessRoutes);
app.use("/api/businesses", themeRoutes);
app.use("/api/public", publicThemeRoutes);

app.use('/api', (req, res) =>{
    res.status(404).json({ message: 'Endpoint not found' });
});

//maneja errores globales, evita que se filtre informacion interna del sistema como librerias
//rutas, archivos del server,etc
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.message);

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: "El logo no puede superar los 5 MB",
      });
    }

    return res.status(400).json({
      message: "Error al procesar el archivo",
    });
  }

  if (err.message === "El logo debe ser JPG, PNG o WEBP") {
    return res.status(400).json({
      message: err.message,
    });
  }

  return res.status(500).json({
    message: "Ha ocurrido un error inesperado",
  });
});



app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT}`);
});
