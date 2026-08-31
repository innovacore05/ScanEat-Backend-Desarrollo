import { Request, Response } from "express";
import { and, eq,ilike, or , sql} from "drizzle-orm";
import { db } from "../db/connection";
import {
  products,
  categories,
  modifierGroups,
  modifierOptions,
} from "../db/schemas/adminMenuSchema";
import { CreateCustomDishInput } from "../db/schemas/adminMenuSchema";
import { uploadImageToStorage } from "../services/storage.service";



//obtener los productos de la base de datos

export const getProducts= async (req:Request,res:Response)=>{

try{ 

const { category, search, limit, offset } = req.query;
const limitNum = limit ? Number(limit) : 10;
		const offsetNum = offset ? Number(offset) : 0;
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
								sql`unaccent(${products.productName}) ILIKE unaccent(${`%${search}%`})`,
								sql`unaccent(${categories.name}) ILIKE unaccent(${`%${search}%`})`
							)
						: undefined
    )
    )
    .orderBy(products.productId)
			.limit(limitNum)
			.offset(offsetNum);


    const formatted =result.map((p)=>({
        ...p,
        price:Number(p.price),
        rating:Number(p.rating),
    }));

 res.status(200).json({
			products: formatted,
			hasMore: formatted.length === limitNum,
		});
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

//obtener categorias
export const getCategories = async (req: Request, res: Response) => {
  try {
    const result = await db.select().from(categories).orderBy(categories.name);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Error al obtener las categorías" });
  }
};




//agregar producto simple 
export const createProduct = async (req: Request, res: Response) => {
    try {
        const {
            productName,
            description,
            price,
            discount,
            categoryId,
        } = req.body;

        // Validar campos obligatorios
        if (!productName || !price || !categoryId) {
            return res.status(400).json({
                message: "El nombre, precio y categoría son requeridos",
            });
        }

        // Verificar que la categoría exista
        const [category] = await db
            .select()
            .from(categories)
            .where(eq(categories.categoryId, Number(categoryId)))
            .limit(1);

        if (!category) {
            return res.status(400).json({
                message: "La categoría seleccionada no existe",
            });
        }
//CAMBIO DE GUARDADO DE LOCAL A R2
        // subir la imagen a r2 cloudflare
        let imageUrl: string | null = null;
        if (req.file) {
            imageUrl = await uploadImageToStorage(req.file, "products");
        }

        // Crear producto
        const [newProduct] = await db
            .insert(products)
            .values({
                productName: String(productName).trim(),
                description: description
                    ? String(description).trim()
                    : null,
                price: String(price),
                discount:
                    discount !== undefined && discount !== ""
                        ? String(discount)
                        : "0",
                categoryId: Number(categoryId),
                image: imageUrl,
                rating: "0.0",
            })
            .returning();

        return res.status(201).json({
            message: "Producto creado correctamente",
            product: {
                ...newProduct,
                price: Number(newProduct.price),
                discount: Number(newProduct.discount),
                rating: Number(newProduct.rating),
            },
        });
    } catch (error) {
        console.error("Error creating product:", error);

        return res.status(500).json({
            message: "Error al crear el producto",
        });
    }
};

//NUEVO /PARTE DEL CUSTOMDISH
//agregar producto personalizado 
export const createCustomDish = async (req: Request, res: Response) => {
  try {
    const data = req.body as CreateCustomDishInput;

    // Categoria existe?
    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.categoryId, data.categoryId))
      .limit(1);

    if (!category) {
      return res.status(400).json({
        message: "La categoría seleccionada no existe",
      });
    }

    //subir imagen a r2
    let imageUrl: string | null = null;
    if (req.file) {
      imageUrl = await uploadImageToStorage(req.file, "products");
    }

    const result = await db.transaction(async (tx) => {
      const [newProduct] = await tx
        .insert(products)
        .values({
          productName: data.name.trim(),
          description: data.description ? data.description.trim() : null,
          price: data.price.toString(),
          discount: data.discount !== undefined ? data.discount.toString() : "0",
          categoryId: data.categoryId,
          image: imageUrl,
          rating: "0.0",
          isCustom: 1,
        })
        .returning();

      for (const group of data.optionGroups) {
        if (!group.name.trim()) continue;

        const [createdGroup] = await tx
          .insert(modifierGroups)
          .values({ productId: newProduct.productId, name: group.name })
          .returning();

        const validOptions = group.options.filter((o) => o.trim() !== "");
        if (validOptions.length > 0) {
          await tx.insert(modifierOptions).values(
            validOptions.map((name) => ({ groupId: createdGroup.id, name }))
          );
        }
      }

      return newProduct;
    });

    return res.status(201).json({
      message: "Platillo personalizado creado correctamente",
      product: {
        ...result,
        price: Number(result.price),
        discount: Number(result.discount),
        rating: Number(result.rating),
      },
    });
  } catch (error) {
    console.error("Error creating custom dish:", error);
    return res.status(500).json({
      message: "Error al crear el platillo personalizado",
    });
  }
};