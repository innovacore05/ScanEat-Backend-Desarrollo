import { pgTable, serial, text, timestamp, boolean, integer, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { numeric } from "drizzle-orm/pg-core";



export const categories = pgTable("categories",{
    categoryId:serial("category_id").primaryKey(),
    name:varchar("name",{
        length:100  }).notNull(),
    });

    export const products=pgTable("products",{
        productId:serial("product_id").primaryKey(),
        productName:varchar("product_name",{length:225}).notNull(),
        image: varchar("image",{length:225}),
        description:text("description"),
        price:numeric("price",{precision:10,scale:2}).notNull(),
        rating: numeric("rating",{precision:2,scale:1}).default("0.0"),
        discount: numeric("discount", {precision: 5,scale: 2,}).default("0.00"),
       categoryId:integer("category_id")
       .notNull()
       .references(()=>categories.categoryId),
    });




    export const productsRelations=relations(products,({one})=>({
        category: one(categories,{
            fields:[products.categoryId],
            references:[categories.categoryId],
        }),
    }));


    export const categoriesRelations =relations(categories,({many})=>({
        products:many(products),
    }));


    //zod schema

    export const insertCategorySchema=createInsertSchema(categories);
    export const inselectCategorySchema=createSelectSchema(categories);
    export const insertProductSchema=createInsertSchema(products);
    export const selectProductSchema = createSelectSchema(products);


export const menuSearchQuerySchema=z.object({
    q:z.string().optional(),
    category:z.string().optional(),
});