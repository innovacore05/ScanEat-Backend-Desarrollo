//Este archivo contiene la lógica para enviar correos electrónicos de verificación.
// Si no se configuran las variables de entorno SMTP, los códigos de verificación se imprimirán en la consola.

//  import nodemailer from 'nodemailer';

// function createTransporter() {
//   if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
//     return null;
//   }

//   return nodemailer.createTransport({
//     host: process.env.SMTP_HOST,
//     port: Number(process.env.SMTP_PORT || 587),
//    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true', 
//     connectionTimeout: 10000,
//     greetingTimeout: 10000,
//     socketTimeout: 10000,
//     auth: {
//       user: process.env.SMTP_USER,
//       pass: process.env.SMTP_PASSWORD,
//     },
//   });
// }

// export async function sendVerificationEmail({ to, code }:
//    { to: string; code: string }) {
//   const transporter = createTransporter();

//   if (!transporter) {
//     console.log(`\n[Scan n' Eat] codigo de verificación para ${to}: ${code}\n`);
//     return;
//   }

//   await transporter.sendMail({
//     from: process.env.SMTP_FROM || process.env.SMTP_USER,
//     to,
//     subject: "Scan n' Eat - Código de verificación",
//     text: `Tu código de verificación para Scann'Eat es: ${code}. Expira en 10 minutos.`,
//     html: `
//       <div style="font-family: Arial, sans-serif;">
//         <h2>Scann'Eat</h2>
//         <p>Tu código de verificación es:</p>
//         <h1 style="letter-spacing: 8px;">${code}</h1>
//         <p>Este código expira en 10 minutos.</p>
//         <p>Si no solicitaste este código, por favor ignóralo.</p>
//       </div>
//     `,
//   });
// }

// Esto de aca NO BORRAR, es parael hosting , actualizacion
//actualziacion para ver qsi mejora 
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BRAND = "Scann'Eat";
const CODE_EXPIRY_MINUTES = 10;
const BREVO_TIMEOUT_MS = 10_000;

console.log('[BREVO CONFIG]', {
apiKeyExists: !!process.env.BREVO_API_KEY,
from: process.env.MAIL_FROM,
});

export async function sendVerificationEmail({ to, code }:
 { to: string; code: string }) {
const apiKey = process.env.BREVO_API_KEY;
  const mailFrom = process.env.MAIL_FROM;

  if (!apiKey || !mailFrom) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${BRAND}] código de verificación para ${to}: ${code}`);
      return;
    }
    throw new Error('Falta configurar el servicio de correo');
  }

 const start = Date.now();


  let response: Response;
  try {
    response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': apiKey,
      },
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
      body: JSON.stringify({
        sender: { name: BRAND, email: mailFrom },
        to: [{ email: to }],
        subject: `${BRAND} - Código de verificación`,
        textContent: `Tu código de verificación para ${BRAND} es: ${code}. Expira en ${CODE_EXPIRY_MINUTES} minutos.`,
        htmlContent: `
          <div style="font-family: Arial, sans-serif;">
            <h2>${BRAND}</h2>
            <p>Tu código de verificación es:</p>
            <h1 style="letter-spacing: 8px;">${code}</h1>
            <p>Este código expira en ${CODE_EXPIRY_MINUTES} minutos.</p>
            <p>Si no solicitaste este código, por favor ignóralo.</p>
          </div>
        `,
      }),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'error de red';
    console.error(`[Brevo] ${reason} tras ${Date.now() - start}ms`, err);
    throw new Error(`No se pudo contactar a Brevo (${reason})`);
  }

  console.log(`[Brevo] respuesta ${response.status} en ${Date.now() - start}ms`);

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[Brevo] error al enviar código:', response.status, errorBody);
    throw new Error(`Brevo API error: ${response.status}`);
  }
}
