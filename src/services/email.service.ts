// //Este archivo contiene la lógica para enviar correos electrónicos de verificación.
// // Si no se configuran las variables de entorno SMTP, los códigos de verificación se imprimirán en la consola.

// import nodemailer from 'nodemailer';

// function createTransporter() {
//   if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
//     return null;
//   }

//   return nodemailer.createTransport({
//     host: process.env.SMTP_HOST,
//     port: Number(process.env.SMTP_PORT || 587),
//     secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    
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

//revision de backend


const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

console.log('[BREVO CONFIG]', {
  apiKeyExists: !!process.env.BREVO_API_KEY,
  from: process.env.MAIL_FROM,
});

export async function sendVerificationEmail({ to, code }:
   { to: string; code: string }) {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    console.log(`\n[ScanEat] codigo de verificación para ${to}: ${code}\n`);
    return;
  }

  const response = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: {
        name: "Scann'Eat",
        email: process.env.MAIL_FROM || 'innovacore05@gmail.com',
      },
      to: [{ email: to }],
      subject: "ScannEat - Código de verificación",
      textContent: `Tu código de verificación para Scann'Eat es: ${code}. Expira en 10 minutos.`,
      htmlContent: `
        <div style="font-family: Arial, sans-serif;">
          <h2>Scann'Eat</h2>
          <p>Tu código de verificación es:</p>
          <h1 style="letter-spacing: 8px;">${code}</h1>
          <p>Este código expira en 10 minutos.</p>
          <p>Si no solicitaste este código, por favor ignóralo.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Error al enviar código de verificación (Brevo API):', response.status, errorBody);
    throw new Error(`Brevo API error: ${response.status}`);
  }
}