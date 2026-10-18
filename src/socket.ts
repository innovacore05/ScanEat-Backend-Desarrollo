
// import type { Server as HttpServer } from "http";
// import { Server } from "socket.io";
// import { z } from "zod";
// import { getAllowedOrigins } from "./app";

// let io: Server | null = null;

// const room = (tableId: string) => `table:${tableId}`;

// const joinSchema = z.object({
//   tableId: z.uuid(),
//   clientId: z.uuid(),
// });

// export const initSocket = (server: HttpServer) => {
//   io = new Server(server, {
//     cors: {
//       origin: getAllowedOrigins(),
//       credentials: true,
//     },
//   });

//   io.on("connection", (socket) => {
//     socket.on("join_table", (payload, ack) => {
//       const parsed = joinSchema.safeParse(payload);

//       if (!parsed.success) {
//         ack?.({ ok: false, message: "Datos inválidos" });
//         return;
//       }

//       const { tableId, clientId } = parsed.data;

//       if (
//         socket.data.tableId &&
//         socket.data.tableId !== tableId
//       ) {
//         socket.leave(room(socket.data.tableId));
//       }

//       socket.data.tableId = tableId;
//       socket.data.clientId = clientId;

//       socket.join(room(tableId));

//       ack?.({ ok: true });
//     });
//   });

//   return io;
// };

// export const emitToTable = (
//   tableId: string,
//   event: string,
//   payload: unknown
// ) => {
//   io?.to(room(tableId)).emit(event, payload);
// };

// export const getConnectedClientIds = async (
//   tableId: string
// ): Promise<string[]> => {
//   if (!io) return [];

//   const sockets = await io.in(room(tableId)).fetchSockets();

//   return [
//     ...new Set(
//       sockets
//         .map((socket) => socket.data.clientId as string)
//         .filter(Boolean)
//     ),
//   ];
// };




import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { z } from "zod";
import { getAllowedOrigins } from "./app";

let io: Server | null = null;

const room = (tableId: string) => `table:${tableId}`;

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
  });

  io.on("connection", (socket) => {
    socket.on("join_table", (payload, ack) => {
      
      
      console.log("Tipo de payload:", typeof payload);
console.log("¿Es una cadena?:", typeof payload === "string");
  

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

      if (
        socket.data.tableId &&
        socket.data.tableId !== tableId
      ) {
        socket.leave(room(socket.data.tableId));
      }

      socket.data.tableId = tableId;
      socket.data.clientId = clientId;

      socket.join(room(tableId));

      ack?.({ ok: true });
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
