import { Request, Response } from "express";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/connection";
import {
  products,
  categories,
  modifierGroups,
  modifierOptions,
  createProductSchema,
  createCustomDishSchema,
  type CreateProductInput, 

} from "../db/schemas/adminMenuSchema";
import { CreateCustomDishInput } from "../db/schemas/adminMenuSchema";
import {  deleteImageFromStorage, uploadImageToStorage} from "../services/storage.service";
import { validateImage } from "../utils/imageValidation";


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

const normaliseProductName = (value: unknown): string => {
  const result = String(value ?? "").trim();
  return result;
};

const normaliseOptionalImage = async (
  req: Request,
  currentImage: string | null,
  folder: string = "products"
) => {
  const rawImage = req.body?.image;
  const shouldRemove =
    rawImage === "null" ||
    rawImage === "undefined" ||
    rawImage === "" ||
    req.body?.removeImage === "true" ||
    req.body?.removeImage === true;

  if (req.file) {
    if (currentImage) {
      await deleteImageFromStorage(currentImage).catch(() => undefined);
    }
    return await uploadImageToStorage(req.file, folder);
  }

  if (shouldRemove) {
    if (currentImage) {
      await deleteImageFromStorage(currentImage).catch(() => undefined);
    }
    return null;
  }

  return currentImage;
};

const normalisePrice = (value: unknown): number => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error("El precio debe ser mayor a 0");
  }
  return numericValue;
};

const normaliseDiscount = (value: unknown, fallback: string = "0") => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error("El descuento debe ser un número válido");
  }

  return String(numericValue);
};

const normaliseOptionGroups = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((group: any) => ({
      name: String(group?.name ?? "").trim(),
      options: Array.isArray(group?.options)
        ? group.options
            .map((option: unknown) => String(option ?? "").trim())
            .filter((option: string) => option.length > 0)
        : [],
    }))
    .filter((group) => group.name.length > 0);
};

//agregar producto simple 
export const createProduct = async (req: Request, res: Response) => {
    
 try {
    const data = req.body as CreateProductInput;

    const imageError = validateImage(req.file);
    if (imageError) {
      return res.status(400).json({ message: imageError });
    }
        // Verificar que la categoría exista
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
//CAMBIO DE GUARDADO DE LOCAL A R2
        // subir la imagen a r2 cloudflare
        const imageUrl = await uploadImageToStorage(req.file!, "products");


        // Crear producto CAMBIO e el valor, desde data
        const [newProduct] = await db
            .insert(products)
            .values({
               productName: data.name,
        description: data.description,
        price: String(data.price),
        discount: data.discount !== undefined ? String(data.discount) : "0",
        categoryId: data.categoryId,
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
    // req.body ya viene validado y tipado por el middleware validateBody
    const data = req.body as CreateCustomDishInput;

    const imageError = validateImage(req.file);
    if (imageError) {
      return res.status(400).json({ message: imageError });
    }

    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.categoryId, data.categoryId))
      .limit(1);

    if (!category) {
      return res.status(400).json({ message: "La categoría seleccionada no existe" });
    }

    const imageUrl = await uploadImageToStorage(req.file!, "products");

    const result = await db.transaction(async (tx) => {
      const [newProduct] = await tx
        .insert(products)
        .values({
          productName: data.name,
          description: data.description,
          price: String(data.price),
          discount: data.discount !== undefined ? String(data.discount) : "0",
          categoryId: data.categoryId,
          image: imageUrl,
          rating: "0.0",
          isCustom: 1,
        })
        .returning();

      for (const group of data.optionGroups) {
        const [createdGroup] = await tx
          .insert(modifierGroups)
          .values({ productId: newProduct.productId, name: group.name })
          .returning();

        await tx.insert(modifierOptions).values(
          group.options.map((name) => ({ groupId: createdGroup.id, name }))
        );
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
    return res.status(500).json({ message: "Error al crear el platillo personalizado" });
  }
};


export const updateProduct = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const productId = Number(id);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ message: "ID de producto inválido" });
    }

    const [existingProduct] = await db
      .select()
      .from(products)
      .where(eq(products.productId, productId))
      .limit(1);

    if (!existingProduct) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    const productName = normaliseProductName(req.body?.name ?? req.body?.name);
    const description = req.body?.description ?? existingProduct.description;
    const categoryId = Number(req.body?.categoryId ?? existingProduct.categoryId);
    const price = normalisePrice(req.body?.price ?? existingProduct.price);

    if (!productName) {
      return res.status(400).json({ message: "El nombre del platillo es obligatorio" });
    }

    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.categoryId, categoryId))
      .limit(1);

    if (!category) {
      return res.status(400).json({ message: "La categoría seleccionada no existe" });
    }

    const nextImage = await normaliseOptionalImage(req, existingProduct.image);
    const nextDiscount = normaliseDiscount(
      req.body?.discount,
      existingProduct.discount ? String(existingProduct.discount) : "0"
    );

    const [updatedProduct] = await db
      .update(products)
      .set({
        productName: productName.trim(),
        description: description !== undefined && description !== null ? String(description).trim() : null,
        price: String(price),
        discount: nextDiscount,
        categoryId,
        image: nextImage,
      })
      .where(eq(products.productId, productId))
      .returning();

    const responseProduct = {
      ...updatedProduct,
      price: Number(updatedProduct.price),
      discount: Number(updatedProduct.discount ?? 0),
      rating: Number(updatedProduct.rating ?? 0),
    };

    return res.status(200).json({
      message: "Platillo actualizado correctamente",
      product: responseProduct,
    });
  } catch (error) {
    console.error("Error updating product:", error);
    const message =
      error instanceof Error ? error.message : "Error al actualizar el platillo";

    return res.status(400).json({ message });
  }
};

export const updateCustomDish = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const productId = Number(id);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ message: "ID de producto inválido" });
    }

    const [existingProduct] = await db
      .select()
      .from(products)
      .where(eq(products.productId, productId))
      .limit(1);

    if (!existingProduct) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    if (existingProduct.isCustom !== 1) {
      return res.status(400).json({ message: "Este producto no es personalizado" });
    }

    const productName = normaliseProductName(req.body?.name ?? req.body?.productName);
    const price = normalisePrice(req.body?.price ?? existingProduct.price);
    const categoryId = Number(req.body?.categoryId ?? existingProduct.categoryId);

    if (!productName) {
      return res.status(400).json({ message: "El nombre del platillo es obligatorio" });
    }

    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.categoryId, categoryId))
      .limit(1);

    if (!category) {
      return res.status(400).json({ message: "La categoría seleccionada no existe" });
    }

    const optionGroups = normaliseOptionGroups(req.body?.optionGroups);
    const nextImage = await normaliseOptionalImage(req, existingProduct.image);
    const nextDiscount = normaliseDiscount(
      req.body?.discount,
      existingProduct.discount ? String(existingProduct.discount) : "0"
    );

    const result = await db.transaction(async (tx) => {
      const existingGroups = await tx
        .select()
        .from(modifierGroups)
        .where(eq(modifierGroups.productId, productId));

      if (existingGroups.length > 0) {
        const groupIds = existingGroups.map((group) => group.id);
        await tx.delete(modifierOptions).where(inArray(modifierOptions.groupId, groupIds));
        await tx.delete(modifierGroups).where(inArray(modifierGroups.id, groupIds));
      }

      const [updatedProduct] = await tx
        .update(products)
        .set({
          productName: productName.trim(),
          description:
            req.body?.description !== undefined && req.body?.description !== null
              ? String(req.body.description).trim()
              : existingProduct.description,
          price: String(price),
          discount: nextDiscount,
          categoryId,
          image: nextImage,
          isCustom: 1,
        })
        .where(eq(products.productId, productId))
        .returning();

      for (const group of optionGroups) {
        const [createdGroup] = await tx
          .insert(modifierGroups)
          .values({ productId, name: group.name })
          .returning();

        if (group.options.length > 0) {
          await tx.insert(modifierOptions).values(
            group.options.map((optionName: string) => ({
              groupId: createdGroup.id,
              name: optionName,
            }))
          );
        }
      }

      return updatedProduct;
    });

    return res.status(200).json({
      message: "Platillo personalizado actualizado correctamente",
      product: {
        ...result,
        price: Number(result.price),
        discount: Number(result.discount ?? 0),
        rating: Number(result.rating ?? 0),
      },
    });
  } catch (error) {
    console.error("Error updating custom dish:", error);
    const message =
      error instanceof Error ? error.message : "Error al actualizar el platillo personalizado";

    return res.status(400).json({ message });
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const productId = Number(id);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ message: "ID de producto inválido" });
    }

    const [existingProduct] = await db
      .select()
      .from(products)
      .where(eq(products.productId, productId))
      .limit(1);

    if (!existingProduct) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    if (existingProduct.image) {
      await deleteImageFromStorage(existingProduct.image).catch(() => undefined);
    }

    const relatedGroups = await db
      .select()
      .from(modifierGroups)
      .where(eq(modifierGroups.productId, productId));

    if (relatedGroups.length > 0) {
      const groupIds = relatedGroups.map((group) => group.id);
      await db.delete(modifierOptions).where(inArray(modifierOptions.groupId, groupIds));
      await db.delete(modifierGroups).where(inArray(modifierGroups.id, groupIds));
    }

    await db.delete(products).where(eq(products.productId, productId));

    return res.status(200).json({ message: "Platillo eliminado correctamente" });
  } catch (error) {
    console.error("Error deleting product:", error);
    return res.status(500).json({ message: "Error al eliminar el platillo" });
  }
};

export const deleteCustomProduct = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const productId = Number(id);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ message: "ID de producto inválido" });
    }

    const [existingProduct] = await db
      .select()
      .from(products)
      .where(eq(products.productId, productId))
      .limit(1);

    if (!existingProduct) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    if (existingProduct.isCustom !== 1) {
      return res.status(400).json({ message: "Este producto no es personalizado" });
    }

    if (existingProduct.image) {
      await deleteImageFromStorage(existingProduct.image).catch(() => undefined);
    }

    const relatedGroups = await db
      .select()
      .from(modifierGroups)
      .where(eq(modifierGroups.productId, productId));

    if (relatedGroups.length > 0) {
      const groupIds = relatedGroups.map((group) => group.id);
      await db.delete(modifierOptions).where(inArray(modifierOptions.groupId, groupIds));
      await db.delete(modifierGroups).where(inArray(modifierGroups.id, groupIds));
    }

    await db.delete(products).where(eq(products.productId, productId));

    return res.status(200).json({ message: "Platillo personalizado eliminado correctamente" });
  } catch (error) {
    console.error("Error deleting custom product:", error);
    return res.status(500).json({ message: "Error al eliminar el platillo personalizado" });
  }
};