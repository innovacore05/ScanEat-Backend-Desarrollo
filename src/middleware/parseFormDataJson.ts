import { Request,Response,NextFunction } from "express";

//Esta clase cumple la funcion de normalizar los datos que entren a un form cualquiera
//json=>array
export function parseFormDataJson(fields: string[]) {

return (req:Request,_res:Response,next:NextFunction)=>{
for (const field of fields){
 if(typeof req.body[field]==="string"){
    try{
        req.body[field]=JSON.parse(req.body[field]);
    }catch{

        req.body[field]=field.endsWith("s") ? []:{};
    }
 }
}
  next(); 
};
}