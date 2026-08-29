import { Request, Response } from "express";
import { and, eq,ilike, or } from "drizzle-orm";
import { db } from "../db/connection";
import { products,categories } from "../db/schemas/menuschema";



//obtener los productos de la base de datos

export const getProducts= async (req:Request,res:Response)=>{

try{ 

const {category,search}=req.query;

const result=await db
.select({

 productId: products.productId,
    productName: products.productName,
    description: products.description,
    price: products.price,
    image: products.image,
    rating: products.rating,
    categoryId: products.categoryId,

})
.from(products)
.leftJoin(categories,eq(products.categoryId,categories.categoryId))
.where(
    and(
        category ? eq (products.categoryId,Number(category)):undefined,
        search ? or(
        ilike (products.productName, `%${search}%`),
        ilike(categories.name, `%${search}%`)
        ):undefined
    )
    );


    const formatted =result.map((p)=>({
        ...p,
        price:Number(p.price),
        rating:Number(p.rating),
    }));

  res.status(200).json(formatted);
}catch (error){
    console.error("Error fetching products:",error);
    res.status(500).json({message:"Error al obtener los productos"});
}
};


//obtener producto por id 

export const getProductsById=async(req:Request,res:Response)=>{
    try{
        const {id}=req.params;

        const result=await db
        .select()
        .from(products)
        .where(eq(products.productId,Number(id)));

if(result.length===0){
    return res.status(404).json({message:"Producto no encontrado"});
}


const product={
    ...result[0],
    price:Number(result[0].price),
    rating:Number(result[0].rating),
};

res.status(200).json(product);
    }catch(error){
        console.error("Error fetching product:",error);
        res.status(500).json({message:"Error al obtener el producto"});
    }
};