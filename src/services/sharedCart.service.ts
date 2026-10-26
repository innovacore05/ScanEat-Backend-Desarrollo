import { and, eq, gt, inArray, lt, lte, ne } from "drizzle-orm";
import { db } from "../db/connection";
import { products } from "../db/schemas/adminMenuSchema";
import { tables } from "../db/schemas/mesaSchema";
import { orders, orderStatuses } from "../db/schemas/orderSchema";
import { sharedCarts, sharedCartItems } from "../db/schemas/sharedCartSchema";
import {
  calculateOrderLines,
  roundCurrency,
  type ProductPricingData,
} from "./orderPricing.service";
import { emitToTable,emitOrderChanged } from "../socket";
import { createOrderFromCart } from "./orderCreation.service";

//limites del carrito, tiempo e 60 m y max de productos 
const CART_TTL_MS = 60 * 60 * 1000; 
const MAX_CART_ITEMS = 100;
const nextExpiry = () => new Date(Date.now() + CART_TTL_MS);

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Cart = typeof sharedCarts.$inferSelect;

//para lanzar errores dle carrito y asociarle un codigo de http
export class CartError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
//busca un carrito abierto donde identificador de mesa=tableid
const findOpenCart = async (tableId: string, executor: typeof db | Tx = db) => {
  const [cart] = await executor
    .select()
    .from(sharedCarts)
    .where(and(eq(sharedCarts.tableId, tableId), eq(sharedCarts.status, "open")))
    .limit(1);
  return cart;
};

//expira carrito
const expireCart = async (cart: Cart) => {
  await db
    .update(sharedCarts)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(sharedCarts.id, cart.id), eq(sharedCarts.status, "open")));
  emitToTable(cart.tableId, "cart:expired", { cartId: cart.id });
};


const touchCart = async (tx: Tx, cartId: string) => {
  const [touched] = await tx
    .update(sharedCarts)
    .set({ expiresAt: nextExpiry(), updatedAt: new Date() })
    .where(
      and(
        eq(sharedCarts.id, cartId),
        eq(sharedCarts.status, "open"),
        gt(sharedCarts.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!touched) throw new CartError(410, "El carrito expiró o ya fue enviado");
  return touched;
};



//exige carrito vigente, debe existir un carrito abierto 
const requireLiveCart = async (tableId: string) => {
  const cart = await findOpenCart(tableId);
  if (!cart) throw new CartError(404, "No hay un carrito abierto para esta mesa");
  if (cart.expiresAt <= new Date()) {
    await expireCart(cart);
    throw new CartError(410, "El carrito expiró");
  }
  return cart;
};
//carrito vacio
const emptyState = {
  cartId: null,
  status: null,
  expiresAt: null,
  observation: null,
  items: [],
  totals: { subtotal: 0, discount: 0, tax: 0, total: 0 },
};

//lee productos, calcula los precios, los impuestos y prepara los datos del front
export const loadCartLines = async (executor: typeof db | Tx, cartId: string) => {
  const rows = await executor
    .select({
      item: sharedCartItems,
      name: products.productName,
      price: products.price,
      discount: products.discount,
      cabysCode: products.cabysCode,
      ivaRate: products.ivaRate,
      ivaRateCode: products.ivaRateCode,
    })
    .from(sharedCartItems)
    .innerJoin(products, eq(products.productId, sharedCartItems.productId))
    .where(eq(sharedCartItems.cartId, cartId))
    .orderBy(sharedCartItems.id);

  const productData = new Map<number, ProductPricingData>(
    rows.map((r) => [
      r.item.productId,
      {
        price: Number(r.price),
        discount: Number(r.discount ?? 0),
        cabysCode: r.cabysCode ?? "",
        ivaRate: Number(r.ivaRate),
        ivaRateCode: r.ivaRateCode,
      },
    ]),
  );

  const lines = calculateOrderLines(
    rows.map((r) => ({
      productId: r.item.productId,
      quantity: r.item.quantity,
      selectedOptions: r.item.selectedOptions ?? {},
      clientId: r.item.clientId,
    })),
    productData,
  );

  return { rows, lines };
};

export const buildCartState = async (cart: Cart) => {
  const { rows, lines } = await loadCartLines(db, cart.id);

  const sum = (f: (l: (typeof lines)[number]) => number) =>
    roundCurrency(lines.reduce((acc, l) => acc + f(l), 0));
  const subtotal = sum((l) => l.subtotal);
  const tax = sum((l) => l.taxAmount);

  return {
    cartId: cart.id,
    status: cart.status,
    expiresAt: cart.expiresAt,
    observation: cart.observation,
    items: rows.map((r, i) => ({
      id: r.item.id,
      clientId: r.item.clientId,
      productId: r.item.productId,
      productName: r.name,
      quantity: r.item.quantity,
      selectedOptions: r.item.selectedOptions ?? {},
      unitPrice: Number(lines[i].unitPrice),
      lineTotal: roundCurrency(lines[i].subtotal + lines[i].taxAmount),
    })),
    totals: {
      subtotal,
      discount: sum((l) => Number(l.discountAmount)),
      tax,
      total: roundCurrency(subtotal + tax),
    },
  };
};

const broadcast = async (cart: Cart) => {
  const state = await buildCartState(cart);
  emitToTable(cart.tableId, "cart:updated", state);
  return state;
};


export const submitCart = async (tableId: string, observation?: string | null) => {
 const { cart, order, businessId } = await db.transaction(async (tx) => {
    // Bloquea el carrito
    const [cart] = await tx
      .select()
      .from(sharedCarts)
      .where(and(eq(sharedCarts.tableId, tableId), eq(sharedCarts.status, "open")))
      .limit(1)
      .for("update");

    if (!cart) throw new CartError(409, "El carrito ya fue enviado o no existe");
    if (cart.expiresAt <= new Date()) throw new CartError(410, "El carrito expiró");

    const { rows, lines } = await loadCartLines(tx, cart.id);
    if (rows.length === 0) throw new CartError(400, "El carrito está vacío");

    const [table] = await tx
  .select({ businessId: tables.businessId })
  .from(tables)
  .where(eq(tables.id, tableId))
  .limit(1);
if (!table) throw new CartError(404, "Mesa no encontrada");

    const order = await createOrderFromCart(
      tx,
      tableId,
      lines,
      observation ?? cart.observation,
    );

    await tx
      .update(sharedCarts)
      .set({
        status: "submitted",
        orderId: order.orderId,
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sharedCarts.id, cart.id));

    return { cart, order, businessId: table.businessId };
  });

     try {
    emitToTable(tableId, "cart:submitted", {
      tableId,
      cartId: cart.id,
      orderId: order.orderId,
    });

    emitOrderChanged({
  order_id: order.orderId,
  table_id: tableId,
  state: orderStatuses.pending,
  business_id: businessId,
});
  } catch (e) {
    console.error("No se pudo emitir cart:submitted:", e);
  }

  return order;
};

export const getCartState = async (tableId: string) => {
  const cart = await findOpenCart(tableId);
  if (!cart) return emptyState;
  if (cart.expiresAt <= new Date()) {
    await expireCart(cart);
    return emptyState;
  }
  return buildCartState(cart);
};

export const addItem = async (
  tableId: string,
  input: {
    clientId: string;
    productId: number;
    quantity: number;
    selectedOptions: Record<string, string>;
  },
) => {
  const [table] = await db
    .select({ id: tables.id, businessId: tables.businessId })
    .from(tables)
    .where(and(eq(tables.id, tableId), eq(tables.active, true)))
    .limit(1);
  if (!table) throw new CartError(404, "Mesa no encontrada o inactiva");

  const [product] = await db
    .select({ productId: products.productId })
    .from(products)
    .where(
      and(
        eq(products.productId, input.productId),
        eq(products.businessId, table.businessId),
      ),
    )
    .limit(1);
  if (!product) throw new CartError(404, "Producto no encontrado en este negocio");


  const [activeOrder] = await db
    .select({ state: orders.state })
    .from(orders)
    .where(
      and(
        eq(orders.tableId, tableId),
        inArray(orders.state, [
          orderStatuses.pending,
          orderStatuses.inPreparation,
          orderStatuses.ready,
          orderStatuses.delivered,
        ]),
      ),
    )
    .limit(1);
 if (activeOrder) {
  throw new CartError(409, "La comanda de esta mesa ya fue enviada");
}

  const existing = await findOpenCart(tableId);
  if (existing && existing.expiresAt <= new Date()) {
    await expireCart(existing);
    throw new CartError(410, "El carrito expiró");
  }

  const cart = await db.transaction(async (tx) => {
    let current = existing;
    if (!current) {
      // Si dos personas crean a la vez, el índice único deja pasar solo a una.
      await tx
        .insert(sharedCarts)
        .values({ tableId, expiresAt: nextExpiry() })
        .onConflictDoNothing();
      current = await findOpenCart(tableId, tx);
      if (!current) {
        throw new CartError(409, "No se pudo abrir el carrito, intenta de nuevo");
      }
    }

    const touched = await touchCart(tx, current.id);

    const currentItems = await tx
      .select()
      .from(sharedCartItems)
      .where(eq(sharedCartItems.cartId, current.id));

    // Mismo cliente + mismo producto + mismas opciones = se suma la cantidad.
    const key = (options: Record<string, string> | null) =>
      JSON.stringify(Object.entries(options ?? {}).sort());
    const match = currentItems.find(
      (i) =>
        i.clientId === input.clientId &&
        i.productId === input.productId &&
        key(i.selectedOptions) === key(input.selectedOptions),
    );

    if (match) {
      await tx
        .update(sharedCartItems)
        .set({ quantity: match.quantity + input.quantity, updatedAt: new Date() })
        .where(eq(sharedCartItems.id, match.id));
    } else {
      if (currentItems.length >= MAX_CART_ITEMS) {
        throw new CartError(409, "El carrito alcanzó el máximo de productos");
      }
      await tx.insert(sharedCartItems).values({
        cartId: current.id,
        clientId: input.clientId,
        productId: input.productId,
        quantity: input.quantity,
        selectedOptions: input.selectedOptions,
      });
    }
    return touched;
  });

  return broadcast(cart);
};

// El ítem debe pertenecer al carrito abierto de ESA mesa y ser de quien lo modifica.
const loadItemForChange = async (tableId: string, itemId: number, clientId: string) => {
  const cart = await requireLiveCart(tableId);
  const [item] = await db
    .select()
    .from(sharedCartItems)
    .where(and(eq(sharedCartItems.id, itemId), eq(sharedCartItems.cartId, cart.id)))
    .limit(1);
  if (!item) throw new CartError(404, "Producto no encontrado en el carrito");
  if (item.clientId !== clientId) {
    throw new CartError(403, "Solo puedes modificar tus propios productos");
  }
  return { cart, item };
};

export const updateItemQuantity = async (
  tableId: string,
  itemId: number,
  clientId: string,
  quantity: number,
) => {
  const { cart, item } = await loadItemForChange(tableId, itemId, clientId);
  const touched = await db.transaction(async (tx) => {
    const t = await touchCart(tx, cart.id);
    await tx
      .update(sharedCartItems)
      .set({ quantity, updatedAt: new Date() })
      .where(eq(sharedCartItems.id, item.id));
    return t;
  });
  return broadcast(touched);
};

export const removeItem = async (tableId: string, itemId: number, clientId: string) => {
  const { cart, item } = await loadItemForChange(tableId, itemId, clientId);
  const touched = await db.transaction(async (tx) => {
    const t = await touchCart(tx, cart.id);
    await tx.delete(sharedCartItems).where(eq(sharedCartItems.id, item.id));
    return t;
  });
  return broadcast(touched);
};

// Marca como vencidos los carritos inactivos y borra los cerrados viejos.
export const startCartCleanup = () => {
  const run = async () => {
    try {
      const expired = await db
        .update(sharedCarts)
        .set({ status: "expired", updatedAt: new Date() })
        .where(and(eq(sharedCarts.status, "open"), lte(sharedCarts.expiresAt, new Date())))
        .returning({ id: sharedCarts.id, tableId: sharedCarts.tableId });

      for (const cart of expired) {
        emitToTable(cart.tableId, "cart:expired", { cartId: cart.id });
      }

      // El historial real vive en orders/order_details; el carrito cerrado es descartable.
      await db
        .delete(sharedCarts)
        .where(
          and(
            ne(sharedCarts.status, "open"),
            lt(sharedCarts.updatedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
          ),
        );
    } catch (error) {
      console.error("Error en la limpieza de carritos:", error);
    }
  };
  return setInterval(run, 60_000);
};