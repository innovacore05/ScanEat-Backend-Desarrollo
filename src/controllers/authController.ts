import { Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { emailVerifications, loginVerifications,resetVerifications,  pendingRegistrations, roleCodes, users } from "../db/schemas/userSchema";
import { desc } from "drizzle-orm";
import { generateToken } from "../utils/jwt";
import { hashPassword } from "../utils/passwords";
import { comparePassword } from "../utils/passwords";
import { generateVerificationCode } from "../utils/generateCode";
import { sendVerificationEmail } from '../services/email.service';
import { AuthRequest } from "../middleware/authenticate";
import { isProd } from "../../env";
import { validatePasswordStrength } from "../utils/passwordValidation";



const normalizeEmail = (value: string) => value.trim().toLowerCase();

// Función para verificar si las variables de entorno SMTP están configuradas correctamente
const isSmtpConfigured = () => {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;

  const hasPlaceholders = [host, user, password].some((value) =>
    String(value ?? "").includes("YOUR_")
  );

  return Boolean(host && user && password && !hasPlaceholders);
};

// Función para crear o actualizar un registro de verificación de correo electrónico
const createOrUpdateVerification = async (userId: number, email: string) => {
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const [existingVerification] = await db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.user_id, userId))
    .limit(1);

  if (existingVerification) {
    await db
      .update(emailVerifications)
      .set({
        code,
        expires_at: expiresAt,
        verified_at: null,
      })
      .where(eq(emailVerifications.user_id, userId));
  } else {
    await db.insert(emailVerifications).values({
      user_id: userId,
      code,
      expires_at: expiresAt,
      verified_at: null,
    });
  }

  if (isSmtpConfigured()) {
    try {
      await sendVerificationEmail({
        to: normalizeEmail(email),
        code,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown email error";
      throw new Error(`No se pudo enviar el código al correo: ${message}`);
    }
  }

  return code;
};

// Controlador para el registro de usuarios
export const register = async (req: Request, res: Response) => {
    try {
        const {
            first_name,
            last_name,
            email,
            password,
            code,
            role_id,
            firstName,
            lastName,
            roleId,
            roleCode,
        } = req.body ?? {};

        const normalizedFirstName = first_name ?? firstName;
        const normalizedLastName = last_name ?? lastName;
        const normalizedEmail = email ? normalizeEmail(email) : "";
        const normalizedRoleId = Number(role_id ?? roleId);
        const normalizedCode = String(code ?? roleCode ?? "")
            .trim()
            .toUpperCase();

        if (
            !normalizedFirstName ||
            !normalizedLastName ||
            !normalizedEmail ||
            !password ||
            !normalizedCode ||
            !Number.isInteger(normalizedRoleId) ||
            normalizedRoleId <= 0
        ) {
            return res.status(400).json({
                message: "Faltan campos requeridos",
            });
        }

const passwordError = validatePasswordStrength(String(password));
if (passwordError) {
  return res.status(400).json({ message: passwordError });
}

        // Validar código de autorización del empleado
        const validRoleCode = await db
            .select()
            .from(roleCodes)
            .where(
                and(
                    eq(roleCodes.code, normalizedCode),
                    eq(roleCodes.role_id, normalizedRoleId),
                    eq(roleCodes.is_active, true)
                )
            )
            .limit(1);

        if (!validRoleCode.length) {
            return res.status(400).json({
                message: "Código de autorización inválido",
            });
        }

        // Verificar si el usuario ya existe
        const [existingUser] = await db
            .select({
                user_id: users.user_id,
                email: users.email,
            })
            .from(users)
            .where(sql`LOWER(${users.email}) = LOWER(${normalizedEmail})`)
            .limit(1);

        if (existingUser) {
            return res.status(409).json({
                message: "Este correo ya está registrado",
            });
        }

        // Verificar si ya existe un registro pendiente
        const [existingPending] = await db
            .select()
            .from(pendingRegistrations)
            .where(
                sql`LOWER(${pendingRegistrations.email}) = LOWER(${normalizedEmail})`
            )
            .limit(1);

        // Hashear contraseña antes de almacenarla temporalmente
        const hashedPassword = await hashPassword(String(password));

        // Generar código de verificación
        const verificationCode = generateVerificationCode();

        // El código dura 10 minutos
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        if (existingPending) {
            // Actualizar registro pendiente existente
            await db
                .update(pendingRegistrations)
                .set({
                    first_name: String(normalizedFirstName),
                    last_name: String(normalizedLastName),
                    password: hashedPassword,
                    role_id: validRoleCode[0].role_id,
                    code: verificationCode,
                    expires_at: expiresAt,
                })
                .where(
                    eq(
                        pendingRegistrations.pending_id,
                        existingPending.pending_id
                    )
                );
        } else {
            // Crear registro temporal
            await db.insert(pendingRegistrations).values({
                first_name: String(normalizedFirstName),
                last_name: String(normalizedLastName),
                email: normalizedEmail,
                password: hashedPassword,
                role_id: validRoleCode[0].role_id,
                code: verificationCode,
                expires_at: expiresAt,
            });
        }

        // Enviar código al correo
        try {
            await sendVerificationEmail({
                to: normalizedEmail,
                code: verificationCode,
            });
        } catch (error) {
            console.error(
                "Error al enviar código de verificación:",
                error
            );

            return res.status(500).json({
                message:
                    "No se pudo enviar el código de verificación al correo",
            });
        }

        return res.status(200).json({
            message:
                "Te enviamos un código de verificación a tu correo.",
            email: normalizedEmail,
        });
    } catch (error) {
        console.error("Error during registration:", error);

        return res.status(500).json({
            message: "No se pudo iniciar el registro",
        });
    }
};

// Controlador para verificar el correo electrónico del usuario
export const verifyEmail = async (req: Request, res: Response) => {
    try {
        const { email, code } = req.body ?? {};

        if (!email || !code) {
            return res.status(400).json({
                message: "El correo y el código de verificación son requeridos",
            });
        }

        const normalizedEmail = normalizeEmail(email);
        const normalizedCode = String(code).trim();

        // Buscar registro pendiente
        const [pendingRegistration] = await db
            .select()
            .from(pendingRegistrations)
            .where(
                sql`LOWER(${pendingRegistrations.email}) = LOWER(${normalizedEmail})`
            )
            .limit(1);

        if (!pendingRegistration) {
            return res.status(404).json({
                message:
                    "No existe un registro pendiente para este correo",
            });
        }

        // Verificar expiración
        if (
            new Date(pendingRegistration.expires_at).getTime() <
            Date.now()
        ) {
            return res.status(400).json({
                message: "El código de verificación expiró",
            });
        }

        // Verificar código
        if (pendingRegistration.code !== normalizedCode) {
            return res.status(400).json({
                message: "Código inválido",
            });
        }

        // Crear usuario REAL
        const [user] = await db
            .insert(users)
            .values({
                first_name: pendingRegistration.first_name,
                last_name: pendingRegistration.last_name,
                email: pendingRegistration.email,
                password: pendingRegistration.password,
                role_id: pendingRegistration.role_id,
            })
            .returning({
                user_id: users.user_id,
                email: users.email,
                role_id: users.role_id,
            });

        // Crear registro de verificación ya verificado
        await db.insert(emailVerifications).values({
            user_id: user.user_id,
            code: pendingRegistration.code,
            expires_at: new Date(),
            verified_at: new Date(),
        });

        // Eliminar registro temporal
        await db
            .delete(pendingRegistrations)
            .where(
                eq(
                    pendingRegistrations.pending_id,
                    pendingRegistration.pending_id
                )
            );

        return res.status(201).json({
            message:
                "Correo verificado correctamente. Tu cuenta ha sido creada.",
            user: {
                userId: user.user_id,
                email: user.email,
                roleId: user.role_id,
            },
        });
    } catch (error) {
        console.error("Verify email error:", error);

        return res.status(500).json({
            message: "No se pudo verificar el correo",
        });
    }
};

// Controlador para reenviar el código de verificación al correo
export const resendVerificationCode = async (req: Request, res: Response) => {
  try {
    const { email } = req.body ?? {};

    if (!email) {
      return res.status(400).json({
        message: "El correo es requerido",
      });
    }

    const normalizedEmail = normalizeEmail(email);

    // Buscar el registro pendiente
    const [pendingRegistration] = await db
      .select()
      .from(pendingRegistrations)
      .where(
        sql`LOWER(${pendingRegistrations.email}) = LOWER(${normalizedEmail})`
      )
      .limit(1);

    if (!pendingRegistration) {
      return res.status(404).json({
        message: "No existe un registro pendiente para este correo",
      });
    }

    // Generar un nuevo código
    const verificationCode = generateVerificationCode();

    // El nuevo código tendrá una duración de 10 minutos
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Actualizar el código y la fecha de expiración
    await db
      .update(pendingRegistrations)
      .set({
        code: verificationCode,
        expires_at: expiresAt,
      })
      .where(
        eq(
          pendingRegistrations.pending_id,
          pendingRegistration.pending_id
        )
      );

    // Enviar el nuevo código al correo
    try {
      await sendVerificationEmail({
        to: pendingRegistration.email,
        code: verificationCode,
      });
    } catch (error) {
      console.error(
        "Error al enviar el código de verificación:",
        error
      );

      return res.status(500).json({
        message:
          "No se pudo enviar el código de verificación al correo",
      });
    }

    const response: {
      message: string;
      verificationCode?: string;
    } = {
      message: "Se envió un nuevo código de verificación",
    };

    // Código de desarrollo si SMTP no está configurado
   if (!isProd() && !isSmtpConfigured()) {
  response.verificationCode = verificationCode;
}

    return res.status(200).json(response);
  } catch (error) {
    console.error("Resend verification error:", error);

    return res.status(500).json({
      message: "No se pudo reenviar el código de verificación",
    });
  }
};



// Controlador para el inicio de sesión de usuarios
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};

if (!email || !password) {
    return res.status(400).json({
      message: "El correo y la contraseña son requeridos" 
    });
}

const normalizedEmail = normalizeEmail(email);

const [user] = await db.select({
  user_id: users.user_id,
  email: users.email,
  password: users.password,
})
.from(users)
.where(sql`LOWER(${users.email}) = LOWER(${normalizedEmail})`)
.limit(1);

if (!user) {
    return res.status(401).json({ message: "Credenciales invalidas" });
}
const isPasswordValid = await comparePassword(String(password), String(user.password)
);

if (!isPasswordValid) {
    return res.status(401).json({ message: "Credenciales invalidas" });
}

const emailVerification = await db.select().from(emailVerifications).where(eq(emailVerifications.user_id, user.user_id)).limit(1);

if (!emailVerification.length || !emailVerification[0].verified_at) {
    return res.status(403).json({ message: "El correo no está verificado" });
}
const code = generateVerificationCode();
const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

await db.insert(loginVerifications).values({
  user_id: user.user_id,
  code,
  expires_at: expiresAt,
});

try{
  await sendVerificationEmail({
    to:user.email,
    code,
  });
}catch(error){
  console.error("Error al enviar la verificación del correo:", error);
  return res.status(500).json({ message: "No se pudo enviar el código de verificación al correo" });
}
return res.status(200).json({
  message: "Revisa tu correo para completar el inicio de sesión",
  requiresTwoFactor: true,
});
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "No se pudo iniciar sesión" });
  }
};

export const verifyLoginCode = async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body ?? {};
    if (!email || !code) {
      return res.status(400).json({ 
        message: "El correo y el código son requeridos" 
      });
    }

    const normalizedEmail = normalizeEmail(email);

    const [user] = await db
    .select()
    .from(users)
    .where(sql`LOWER(${users.email}) = LOWER(${normalizedEmail})`)
    .limit(1);

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const [logingCode] = await db
    .select()
    .from(loginVerifications)
    .where(eq(loginVerifications.user_id, user.user_id))
    .orderBy(desc(loginVerifications.otp_id))
    .limit(1);

    if (!logingCode) {
      return res.status(404).json({ message: "No existe un código de verificación para este usuario" });
    }

    if (new Date(logingCode.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ message: "El código de verificación expiró" });
    }

    if (logingCode.code !== String(code).trim()) {
      return res.status(400).json({ message: "Código inválido" });
    }

    const token = await generateToken({
      user_id: user.user_id,
      email: user.email,
      role_id: user.role_id,
    });
    //agregado
    res.cookie("token", token, {
  httpOnly: true,
  secure: false,
  sameSite: "lax",
});

    await db
    .delete(loginVerifications)
    .where(eq(loginVerifications.user_id, user.user_id));

    return res.status(200).json({
      message: "Inicio de sesión exitoso",
      token,
      user: {
        userId: user.user_id,
        email: user.email,
        roleId: user.role_id,
      },
    });
  } catch (error) {
    console.error("Verify login code error:", error);
    return res.status(500).json({ message: "No se pudo verificar el código de inicio de sesión" });
  } 
};

//controlador para reenviar el login code al correo
export const resendLoginCode = async (req: Request, res: Response) => {
  try {
    const { email } = req.body ?? {};

    if (!email) {
      return res.status(400).json({
        message: "El correo es requerido",
      });
    }

    const normalizedEmail = normalizeEmail(email);

    // Generar un nuevo código
    const verificationCode = generateVerificationCode();

    // El nuevo código tendrá una duración de 10 minutos
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Actualizar el código y la fecha de expiración
    await db
      .update(loginVerifications)
      .set({
        code: verificationCode,
        expires_at: expiresAt,
      })
      .where(
        eq(
          loginVerifications.user_id,
          sql`(SELECT user_id FROM users WHERE LOWER(email) = LOWER(${normalizedEmail}))`
        )
      );

    // Enviar el nuevo código al correo
    try {
      await sendVerificationEmail({
      to: normalizeEmail(normalizedEmail),
      code: verificationCode,
      });
    } catch (error) {
      console.error(
        "Error al enviar el código de verificación:",
        error
      );

      return res.status(500).json({
        message:
          "No se pudo enviar el código de verificación al correo",
      });
    }

    const response: {
      message: string;
      verificationCode?: string;
    } = {
      message: "Se envió un nuevo código de verificación",
    };

    // Código de desarrollo si SMTP no está configurado
     if (!isProd() && !isSmtpConfigured()) {
  response.verificationCode = verificationCode;
}

    return res.status(200).json(response);
  } catch (error) {
    console.error("Resend verification error:", error);

    return res.status(500).json({
      message: "No se pudo reenviar el código de verificación",
    });
  }
};

//controlador para restablecer la contraseña del usuario
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body ?? {};
    if (!email) {
      return res.status(400).json({ message: "El correo es requerido" });
    }
    const normalizedEmail = normalizeEmail(email);

    const [user] = await db
    .select()
    .from(users)
    .where(sql`LOWER(${users.email}) = LOWER(${normalizedEmail})`)
    .limit(1);

    if (!user) {
      return res.status(200).json({ message: "Si el correo está registrado, recibirás un código de restablecimiento" });
    }

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db
      .delete(resetVerifications)
      .where(eq(resetVerifications.user_id, user.user_id));

    await db.insert(resetVerifications).values({
      user_id: user.user_id,
      code,
      expires_at: expiresAt,
    });

    try {
      await sendVerificationEmail({
        to: user.email,
        code,
      });
    } catch (error) {
      console.error("Error al enviar el código de restablecimiento de contraseña:", error);
      return res.status(500).json({ message: "No se pudo enviar el código de restablecimiento al correo" });
    }

    return res.status(200).json({ message: "Se ha enviado un código de restablecimiento a tu correo" });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ message: "No se pudo procesar la solicitud de restablecimiento de contraseña" });
  }
};

// Controlador para restablecer la contraseña del usuario
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { email, code, newPassword } = req.body ?? {};

    if (!email || !code || !newPassword) {
      return res.status(400).json({
        message: "El correo, el código y la nueva contraseña son requeridos",
      });
    }

    const passwordError = validatePasswordStrength(String(newPassword));
if (passwordError) {
  return res.status(400).json({ message: passwordError });
}

    const normalizedEmail = normalizeEmail(email);

    const [user] = await db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = LOWER(${normalizedEmail})`)
      .limit(1);

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const [resetCode] = await db
      .select()
      .from(resetVerifications)
      .where(eq(resetVerifications.user_id, user.user_id))
      .orderBy(desc(resetVerifications.reset_id))
      .limit(1);

    if (!resetCode) {
      return res.status(404).json({
        message: "No existe un código de recuperación para este usuario",
      });
    }

    if (new Date(resetCode.expires_at).getTime() < Date.now()) {
      return res.status(400).json({
        message: "El código de recuperación expiró",
      });
    }

    if (resetCode.code !== String(code).trim()) {
      return res.status(400).json({
        message: "Código inválido",
      });
    }

    const hashedPassword = await hashPassword(String(newPassword));

    await db
      .update(users)
      .set({ password: hashedPassword })
      .where(eq(users.user_id, user.user_id));

    await db
      .delete(resetVerifications)
      .where(eq(resetVerifications.user_id, user.user_id));

    await db
      .delete(loginVerifications)
      .where(eq(loginVerifications.user_id, user.user_id));

    return res.status(200).json({
      message: "Contraseña actualizada correctamente",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      message: "No se pudo restablecer la contraseña",
    });
  }
};

// Controlador para verificar el código de recuperación
export const verifyResetCode = async (req: Request, res: Response) => {
    try {
        const { email, code } = req.body ?? {};

        if (!email || !code) {
            return res.status(400).json({
                message: "El correo y el código son requeridos",
            });
        }

        const normalizedEmail = normalizeEmail(String(email));

        const [user] = await db
            .select()
            .from(users)
            .where(
                sql`LOWER(${users.email}) = LOWER(${normalizedEmail})`
            )
            .limit(1);

        if (!user) {
            return res.status(404).json({
                message: "Usuario no encontrado",
            });
        }

        const [resetCode] = await db
            .select()
            .from(resetVerifications)
            .where(eq(resetVerifications.user_id, user.user_id))
            .orderBy(desc(resetVerifications.reset_id))
            .limit(1);

        if (!resetCode) {
            return res.status(404).json({
                message: "No existe un código de recuperación para este usuario",
            });
        }

        // Verificar si el código expiró
        if (new Date(resetCode.expires_at).getTime() < Date.now()) {
            return res.status(400).json({
                message: "El código de recuperación expiró",
            });
        }

        // Comparar código
        if (resetCode.code !== String(code).trim()) {
            return res.status(400).json({
                message: "Código inválido",
            });
        }

        return res.status(200).json({
            message: "Código válido",
        });
    } catch (error) {
        console.error("Verify reset code error:", error);

        return res.status(500).json({
            message: "No se pudo verificar el código",
        });
    }
};

//controlador para reenviar el reset code al correo
export const resendResetCode = async (req: Request, res: Response) => {
  try {
    const { email } = req.body ?? {};

    if (!email) {
      return res.status(400).json({
        message: "El correo es requerido",
      });
    }

    const normalizedEmail = normalizeEmail(email);

    // Generar un nuevo código
    const verificationCode = generateVerificationCode();

    // El nuevo código tendrá una duración de 10 minutos
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Actualizar el código y la fecha de expiración
    await db
      .update(resetVerifications)
      .set({
        code: verificationCode,
        expires_at: expiresAt,
      })
      .where(
        eq(
          resetVerifications.user_id,
          sql`(SELECT user_id FROM users WHERE LOWER(email) = LOWER(${normalizedEmail}))`
        )
      );

    // Enviar el nuevo código al correo
    try {
      await sendVerificationEmail({
      to: normalizeEmail(normalizedEmail),
      code: verificationCode,
      });
    } catch (error) {
      console.error(
        "Error al enviar el código de verificación:",
        error
      );

      return res.status(500).json({
        message:
          "No se pudo enviar el código de verificación al correo",
      });
    }

    const response: {
      message: string;
      verificationCode?: string;
    } = {
      message: "Se envió un nuevo código de verificación",
    };

    // Código de desarrollo si SMTP no está configurado
     if (!isProd() && !isSmtpConfigured()) {
  response.verificationCode = verificationCode;
}

    return res.status(200).json(response);
  } catch (error) {
    console.error("Resend verification error:", error);

    return res.status(500).json({
      message: "No se pudo reenviar el código de verificación",
    });
  }
};




//controaldor para obtener los datos de un perfil
export const getProfile = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({
        message: "No autenticado",
      });
    }

    const [user] = await db
      .select({
        userId: users.user_id,
        firstName: users.first_name,
        lastName: users.last_name,
        email: users.email,
        roleId: users.role_id,
      })
      .from(users)
      .where(eq(users.user_id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        message: "Usuario no encontrado",
      });
    }

    return res.status(200).json({
      user,
    });
  } catch (error) {
    console.error("Get profile error:", error);

    return res.status(500).json({
      message: "No se pudo obtener el perfil",
    });
  }
};





//controldor para editar la informacion del perfil (nombre, apellido, correo, contraseña) del usuario
export const editProfile = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    // Obtenemos el ID del usuario desde el token JWT.
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({
        message: "No autenticado",
      });
    }

    // Recibimos únicamente los datos editables del perfil.
    const { first_name, last_name, email } = req.body ?? {};

    // Verificamos que se haya enviado al menos un campo.
    if (
      first_name === undefined &&
      last_name === undefined &&
      email === undefined
    ) {
      return res.status(400).json({
        message: "No hay datos para actualizar",
      });
    }

    // Campos que se modificarán en la base de datos.
    const edits: Partial<typeof users.$inferInsert> = {};
let emailChanged=false;

    // Actualizar nombre si fue enviado.
    if (first_name !== undefined) {
      if (String(first_name).trim().length < 2) {
        return res.status(400).json({
          message: "El nombre debe tener al menos 2 caracteres",
        });
      }

      edits.first_name = String(first_name).trim();
    }

    // Actualizar apellido si fue enviado.
    if (last_name !== undefined) {
      if (String(last_name).trim().length < 2) {
        return res.status(400).json({
          message: "El apellido debe tener al menos 2 caracteres",
        });
      }

      edits.last_name = String(last_name).trim();
    }

    // Actualizar correo si fue enviado.
    if (email !== undefined) {
      const normalizedEmail = normalizeEmail(String(email));

      // Comprobar que el correo no pertenezca a otro usuario.
      const [existingUser] = await db
        .select({
          user_id: users.user_id,
        })
        .from(users)
        .where(
          sql`LOWER(${users.email}) = LOWER(${normalizedEmail})
              AND ${users.user_id} <> ${userId}`
        )
        .limit(1);

      if (existingUser) {
        return res.status(409).json({
          message: "Este correo ya está registrado",
        });
      }

      const [currentUser] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.user_id, userId))
        .limit(1);

      if (currentUser && normalizeEmail(currentUser.email) !== normalizedEmail) {
        edits.email = normalizedEmail;
        emailChanged = true;
      }
    }

    // Guardamos los cambios del perfil.
    const [updatedUser] = await db
      .update(users)
      .set(edits)
      .where(eq(users.user_id, userId))
      .returning({
        userId: users.user_id,
        firstName: users.first_name,
        lastName: users.last_name,
        email: users.email,
        roleId: users.role_id,
      });

    if (!updatedUser) {
      return res.status(404).json({
        message: "Usuario no encontrado",
      });
    }

 // Si cambió el email, forzar re-verificación
    if (emailChanged) {
      try {
        await createOrUpdateVerification(userId, updatedUser.email);
      } catch (error) {
        console.error("Error al reenviar verificación de correo:", error);
        return res.status(500).json({
          message: "Perfil actualizado, pero no se pudo enviar la verificación al nuevo correo",
        });
      }
    }

    return res.status(200).json({
  message: "Perfil actualizado correctamente",
  user: updatedUser,
  requiresEmailVerification: emailChanged,
});
  } catch (error) {
    console.error("Update profile error:", error);

    return res.status(500).json({
      message: "No se pudo actualizar el perfil",
    });
  }
};

//Controlador para cambiar la contraseña del usuario dentro de su perfil debe poner su contraseña actual y la nueva contraseña y confirmar la nueva contraseña

export const changePassword = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId){
      return res.status(401).json({
        message: "No autenticado"
      });
    }
    const {
      currentPassword,
      newPassword, 
      confirmPassword,
    }= req.body ??{};
    
    if (!currentPassword || !newPassword || !confirmPassword){
      return res.status(400).json({
        message: "Todos los campos son requeridos"
      });
    }

    const passwordError = validatePasswordStrength(String(newPassword));
if (passwordError) {
  return res.status(400).json({ message: passwordError });
}

    if (String(newPassword) !== String(confirmPassword)){
      return res.status(400).json({
        message: "Las contraseñas no coinciden"
      });
    }

    const [user] = await db.select({
      user_id: users.user_id,
      password: users.password,
    })
    .from(users)
    .where(eq(users.user_id, userId))
    .limit(1);

    if (!user){
      return res.status(404).json({
        message: "Usuario no encontrado"
      });
    }

    const isCurrentPasswordValid = await comparePassword( 
    String(currentPassword), user.password
  );

  if (!isCurrentPasswordValid){
    return res.status(400).json({
      message: "La contraseña actual es incorrecta"
    });
  }


const isSamePassword = await comparePassword(String(newPassword), user.password);
if (isSamePassword){
  return res.status(400).json({
    message:"La nueva contraseña debe ser diferente a la actual",
  });
}

  const hashedPassword = await hashPassword(String(newPassword));

  await db.update(users)
  .set({ password: hashedPassword })
  .where(eq(users.user_id, userId));

  await db
  .delete(loginVerifications)
  .where(eq(loginVerifications.user_id, userId));

  return res.status(200).json({
      message: "Contraseña cambiada correctamente",
    });
  } catch (error) {
    console.error("Change password error:", error);

    return res.status(500).json({
      message: "No se pudo cambiar la contraseña",
    });
  }
};
