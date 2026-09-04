import cors from 'cors';
import express, { Application } from 'express';
import path from 'path';

import morgan from 'morgan';
import helmet from 'helmet';

import cookieParser from 'cookie-parser';

const app: Application = express();

app.set('trust proxy', 1);


//para produccion , cuando se necesite subir el proyecto a los servicios de hosting correspondientes
//configurar las variables de entorno en cada plataforma
//FRONTEND_URL= Y VITE_API_URL
//en el .env del backend: FRONTEND_URL=http://localhost:5173
//en el .env del front: VITE_API_URL=http://localhost:3000
//Si hay problemas puede ser que cambio elpuerto o el cors 

app.use(cors({
    origin: (origin, callback) => {
        const allowedOrigins = (process.env.FRONTEND_URL ?? '')
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean);

        // permite requests sin origin como postman
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));




app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan('dev', {
    skip: () => process.env.NODE_ENV === 'test'
}));

app.use(express.static(path.join(__dirname, '..', 'public')));







export default app;

