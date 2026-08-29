import app from './src/app';
import env from './env';
import authRoutes from './src/routes/authRoutes';
import { Request,Response,NextFunction } from 'express';
import menuRoutes from './src/routes/menuRoutes';

app.use('/api/auth', authRoutes);
app.use("/api/menu",menuRoutes);


app.use('/api', (req, res) =>{
    res.status(404).json({ message: 'Endpoint not found' });
});

//maneja errores globales, evita que se filtre informacion interna del sistema como librerias
//rutas, archivos del server,etc
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.message);
  res.status(500).json({ message: "Ha ocurrido un error inesperado" });
});



app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT}`);
});