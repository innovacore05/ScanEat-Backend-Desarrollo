
import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { z } from "zod";
import { getAllowedOrigins } from "./app";

import { parseCookie } from "cookie";
import { eq } from "drizzle-orm";
import { verifyToken } from "./utils/jwt";
import db from "./db/connection";
import { users } from "./db/schemas/userSchema";

const staffRoom = (businessId: number) => `staff:${businessId}`;
const STAFF_ROLE_IDS = [2, 3, 4]; 
const AUTH_COOKIE_NAME = "token";

let io: Server | null = null;

const room = (tableId: string) => `table:${tableId}`;
const readyRoom = (tableId: string) => `table:ready:${tableId}`;

type TableSession = {
  connected: Set<string>;
  ready: Set<string>;
};

const tableSession = new Map<string, TableSession>();

const getSession = (tableId: string) => {
  if (!tableSession.has(tableId)) {
    tableSession.set(tableId, { connected: new Set(), ready: new Set() });
  }

  return tableSession.get(tableId)!;
};

export const getTableReadyClientIds = (tableId: string) => {
  const session = tableSession.get(tableId);
  return session ? [...session.ready] : [];
};

export const clearTableReadyState = (tableId: string) => {
  const session = tableSession.get(tableId);
  if (!session) return;

  session.ready.clear();
  session.connected.clear();
  tableSession.delete(tableId);
};

const broadcastTableState = async (tableId: string) => {
  const session = getSession(tableId);
  const connected = [...session.connected].sort();
  const ready = [...session.ready]
    .filter((clientId) => connected.includes(clientId))
    .sort();
  const allReady =
    connected.length > 0 &&
    connected.every((clientId) => ready.includes(clientId));

  io?.to(readyRoom(tableId)).emit("table:state", {
    tableId,
    connected,
    ready,
    allReady,
    connectedCount: connected.length,
    readyCount: ready.length,
  });
};

const joinSchema = z.object({
  tableId: z.uuid(),
  clientId: z.uuid(),
});

export const initSocket = (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: getAllowedOrigins(),
      credentials: true,
    },

 allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, !!origin && getAllowedOrigins().includes(origin));
    },

  });

 io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie;
      if (!raw) return next(); // cliente de mesa: anónimo

      const token = parseCookie(raw)[AUTH_COOKIE_NAME];
      if (!token) return next();

      const payload = await verifyToken(token);

      const [user] = await db
        .select({
          user_id: users.user_id,
          role_id: users.role_id,
          business_id: users.business_id,
        })
        .from(users)
        .where(eq(users.user_id, payload.user_id))
        .limit(1);

      if (user) {
        socket.data.user = {
          userId: user.user_id,
          roleId: user.role_id,
          businessId: user.business_id,
        };
      }
    } catch {
      // token invalido o vencido
    }
    next();
  });


  io.on("connection", (socket) => {


    const user = socket.data.user;
if (
  user &&
  STAFF_ROLE_IDS.includes(user.roleId) &&
  user.businessId != null
) {
  socket.join(staffRoom(user.businessId));
  console.log("staff conectado:", user.userId, "rol", user.roleId, "negocio", user.businessId);
}


    socket.on("join_table", async (payload, ack) => {
      let data: unknown = payload;

      if (typeof payload === "string") {
        try {
          data = JSON.parse(payload);
        } catch {
          ack?.({ ok: false, message: "JSON inválido" });
          return;
        }
      }

      const parsed = joinSchema.safeParse(data);

      if (!parsed.success) {
        console.error(
          "Error de validación join_table:",
          JSON.stringify(parsed.error.issues, null, 2)
        );
        console.error("Payload recibido:", payload);

        ack?.({ ok: false, message: "Datos inválidos" });
        return;
      }

      const { tableId, clientId } = parsed.data;

      if (socket.data.tableId && socket.data.tableId !== tableId) {
        socket.leave(room(socket.data.tableId));
        socket.leave(readyRoom(socket.data.tableId));
      }

      socket.data.tableId = tableId;
      socket.data.clientId = clientId;

      const session = getSession(tableId);
      session.connected.add(clientId);

      socket.join(room(tableId));
      socket.join(readyRoom(tableId));

      await broadcastTableState(tableId);

      ack?.({ ok: true });
    });

    socket.on("disconnect", async () => {
      const tableId = socket.data.tableId as string | undefined;
      const clientId = socket.data.clientId as string | undefined;

      if (!tableId || !clientId) return;

      const session = tableSession.get(tableId);
      if (!session) return;

      session.connected.delete(clientId);
      session.ready.delete(clientId);

      if (session.connected.size === 0 && session.ready.size === 0) {
        tableSession.delete(tableId);
      } else {
        await broadcastTableState(tableId);
      }
    });

    socket.on("table:toggle-ready", async ({ tableId, clientId }) => {
      if (!tableId || !clientId) return;

      const session = getSession(tableId);
      if (!session.connected.has(clientId)) return;

      if (session.ready.has(clientId)) {
        session.ready.delete(clientId);
      } else {
        session.ready.add(clientId);
      }

      await broadcastTableState(tableId);
    });

    socket.on("table:cart-changed", async ({ tableId, clientId }) => {
      if (!tableId || !clientId) return;

      const session = tableSession.get(tableId);
      if (!session) return;

      session.ready.delete(clientId);
      await broadcastTableState(tableId);
    });

    socket.on("table:get-state", async ({ tableId }) => {
      if (!tableId) return;
      await broadcastTableState(tableId);
    });
  });

  return io;
};

export const emitToTable = (
  tableId: string,
  event: string,
  payload: unknown
) => {
  io?.to(room(tableId)).emit(event, payload);
};

export const emitToStaff = (
  businessId: number,
  event: string,
  payload: unknown,
) => {
  io?.to(staffRoom(businessId)).emit(event, payload);
};


export const emitOrderChanged = (order: {
  order_id: number;
  table_id: string;
  state: string;
  business_id: number;
}) => {
  const payload = {
    orderId: order.order_id,
    tableId: order.table_id,
    state: order.state,
  };
  emitToTable(order.table_id, "order_status_updated", payload);
  emitToStaff(order.business_id, "kitchen_orders_updated", payload);
  emitToStaff(order.business_id, "waiter_orders_updated", payload);
  emitToStaff(order.business_id, "cashier_orders_updated", payload);
};



export const getConnectedClientIds = async (
  tableId: string
): Promise<string[]> => {
  if (!io) return [];

  const sockets = await io.in(room(tableId)).fetchSockets();

  return [
    ...new Set(
      sockets
        .map((socket) => socket.data.clientId as string)
        .filter(Boolean)
    ),
  ];
};
