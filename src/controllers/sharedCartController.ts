import { Request, Response } from "express";
import { z } from "zod";
import * as cartService from "../services/sharedCart.service";

const tableParams = z.object({ tableId: z.uuid() });
const itemParams = tableParams.extend({ itemId: z.coerce.number().int().positive() });
const clientQuery = z.object({ clientId: z.uuid() });

const addBody = z.object({
  clientId: z.uuid(),
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive().max(99),
  selectedOptions: z.record(z.string(), z.string()).optional().default({}),
});
const qtyBody = z.object({
  clientId: z.uuid(),
  quantity: z.coerce.number().int().positive().max(99),
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Los datos no son válidos",
          errors: z.flattenError(error),
        });
      }
      if (error instanceof cartService.CartError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Error en carrito compartido:", error);
      return res.status(500).json({ message: "No se pudo procesar el carrito" });
    }
  };

export const getCart = handle(async (req, res) => {
  const { tableId } = tableParams.parse(req.params);
  res.status(200).json(await cartService.getCartState(tableId));
});

export const addItem = handle(async (req, res) => {
  const { tableId } = tableParams.parse(req.params);
  res.status(201).json(await cartService.addItem(tableId, addBody.parse(req.body)));
});

export const updateItem = handle(async (req, res) => {
  const { tableId, itemId } = itemParams.parse(req.params);
  const { clientId, quantity } = qtyBody.parse(req.body);
  res.status(200).json(
    await cartService.updateItemQuantity(tableId, itemId, clientId, quantity),
  );
});

export const removeItem = handle(async (req, res) => {
  const { tableId, itemId } = itemParams.parse(req.params);
  const { clientId } = clientQuery.parse(req.query);
  res.status(200).json(await cartService.removeItem(tableId, itemId, clientId));
});