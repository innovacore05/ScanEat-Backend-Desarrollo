import { Request,Response } from "express";
import { and,eq } from "drizzle-orm";   
import db from "../db/connection";
import { orderDetails,orders } from "../db/schemas/orderSchema";
import { tables } from "../db/schemas/mesaSchema";  
import { products } from "../db/schemas/adminMenuSchema";   


const TAX_RATE=0.13;

const roundCurrency=(value:number)=>
    Math.round((value+Number.EPSILON) * 100) /100; 
    

export const getPaymentPreview=async (

    req: Request,
    res:Response
)=>
{
    try{
        const orderId=Number(req.params.orderId);
        if(!Number.isInteger(orderId) || orderId <=0){
            return res.status(400).json({
                message:"El identificador de la orden no  es válido",
            });
        }
        const rows =await db.select
        ({
            order:orders,
            table:tables,
            detail:orderDetails,
            product:products,
        })
        .from (orders)
        .innerJoin(tables,eq(orders.tableId,tables.id))
        .innerJoin(
            orderDetails,
            eq(orders.orderId,orderDetails.orderId)
        )
        .innerJoin(
        products,
        eq(orderDetails.productId, products.productId)
      )
      .where(eq(orders.orderId,orderId));

      if(rows.length===0)
      {
        return res.status(404).json({
            message:"Orden no encontrada",
        });
      }

      //---
    const firstRow = rows[0];

    const lines = rows.map((row) => {
      const unitPrice = Number(row.detail.unitPrice);
      const quantity = row.detail.quantity;
      const discount = Number(row.detail.discountAmount);
      const subtotal = Number(row.detail.subtotal);

      const gross = roundCurrency(unitPrice * quantity);

      const tax = roundCurrency(subtotal * TAX_RATE);

      const total = roundCurrency(subtotal + tax);

      return {
        detailId: row.detail.detailId,
        detail: row.product.productName,
        quantity,
        unitPrice: row.detail.unitPrice,
        gross: gross.toFixed(2),
        discount: discount.toFixed(2),
        subtotal: row.detail.subtotal,
        tax: tax.toFixed(2),
        total: total.toFixed(2),
      };
    });

    const totalDiscount = lines.reduce(
      (sum, line) => sum + Number(line.discount),
      0
    );

    return res.status(200).json({
      orderId: firstRow.order.orderId,

      tableNumber: firstRow.table.tableNumber,

      lines,

      totals: {
        totalSale: firstRow.order.total,
        totalDiscount: totalDiscount.toFixed(2),
        totalNetSale: firstRow.order.subtotal,
        totalTax: firstRow.order.tax,
        serviceCharge: "0.00",
        totalOtherCharges: "0.00",
        totalVoucher: "0.00",
      },

      missingCabys: [],
    });
  } catch (error) {
    console.error("Error obteniendo preview de pago:", error);

    return res.status(500).json({
      message: "No se pudo cargar la información de pago",
    });
  }
};
