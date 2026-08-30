import {  pgTable, uuid, varchar, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";




export const dishes=pgTable("dishes",{

id:uuid("id").primaryKey().defaultRandom(),
businessId: uuid("business_id").notNull(),
name:varchar("name",{length:100}).notNull(),
description:text("description"),
price:numeric("price",{precision:10,scale:2}).notNull(),
category:varchar("category",{length:50}).notNull(),
discount:integer("discount").default(0),
imageUrl:text("image_url"),
isCustom:integer("is_custom").default(1),
createdAt:timestamp("created_at").defaultNow(),
updatedAt:timestamp("updated_at").defaultNow(),
});


//grupos 
export const modifierGroups=pgTable("modifier_groups",{
    id:uuid("id").primaryKey().defaultRandom(),
    dishId:uuid("dish_id").notNull().references(()=>dishes.id,{onDelete:"cascade"}),
    name:varchar("name",{length:100}).notNull(),
});


//opciones

export const modifierOptions=pgTable("modifier_options",{
    id:uuid("id").primaryKey().defaultRandom(),
    groupId:uuid("group_id").notNull().references(()=>modifierGroups.id,{onDelete:"cascade"}),
    name:varchar("name",{length:100}).notNull(),
});



export const dishRelations=relations(dishes,({many})=>({
    modifierGroups:many(modifierGroups),
}));


export const modifierGroupRelations= relations(modifierGroups,({one,many})=>({
    dish:one(dishes,{fields:[modifierGroups.dishId],references:[dishes.id]}),
    options:many(modifierOptions)
}));


export const modifierOptionsRelations= relations(modifierOptions,({one})=>({

group: one(modifierGroups, { fields: [modifierOptions.groupId], references: [modifierGroups.id] }),
}));

//zod validation
const optionGroupSchema=z.object({
name:z.string().min(1, "El grupo necesita un nombre").max(100),
options: z.array(z.string().min(1)).default([]),
});

export const createCustomDishSchema=z.object({
name:z.string().min(1, "El nombre es requerido").max(100),
description: z.string().max(500).optional(),
price: z.coerce.number().positive("El precio debe ser mayor a 0"),
category:z.string().min(1,"La categoría es requerida"),
discount:z.coerce.number().min(0).max(100).optional(),
optionGroups:z.array(optionGroupSchema).default([]),
});

export type CreateCustomDishInput = z.infer<typeof createCustomDishSchema>;