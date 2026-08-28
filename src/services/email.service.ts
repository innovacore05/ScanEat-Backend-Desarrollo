//Este archivo contiene la lógica para enviar correos electrónicos de verificación.
// Si no se configuran las variables de entorno SMTP, los códigos de verificación se imprimirán en la consola.

import nodemailer from 'nodemailer';

function createTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

export async function sendVerificationEmail({ to, code }: { to: string; code: string }) {
  const transporter = createTransporter();

  if (!transporter) {
    console.log(`\n[Garabatos Scan] codigo de verificación para ${to}: ${code}\n`);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'Garabatos Scan - Código de verificación',
    text: `Tu código de verificación para Garabatos Scan es: ${code}. Expira en 10 minutos.`,
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h2>Garabatos Scan</h2>
        <p>Tu código de verificación es:</p>
        <h1 style="letter-spacing: 8px;">${code}</h1>
        <p>Este código expira en 10 minutos.</p>
        <p>Si no solicitaste este código, por favor ignóralo.</p>
      </div>
    `,
  });


transporter.verify((error, success) => {
    if (error) {
        console.error("SMTP ERROR:", error);
    } else {
        console.log("SMTP READY:", success);
    }
});

}
