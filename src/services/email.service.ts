
//Esto de aca NO BORRAR, es parael hosting , actualizacion

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
        <div style="margin: 0; padding: 0; background-color: #f3f6f4; font-family: Arial, Helvetica, sans-serif; color: #26332d;">

          <div style="max-width: 520px; margin: 0 auto; padding: 35px 20px;">

            <div style="background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e1e9e3;">

              <!-- Encabezado -->
              <div style="background-color: #61AD9E; padding: 28px 20px; text-align: center;">
            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold; letter-spacing: 0.5px;">
          Scan n'eat
        </h1>
         <p style="margin: 8px 0 0; color: #d8f3e3; font-size: 14px;">
           Tu experiencia, más fácil.
         </p>
      </div>

       <!-- Contenido -->
       <div style="padding: 32px 25px; text-align: center;">

        <h2 style="margin: 0 0 14px; color: #26332d; font-size: 22px;">
          Verifica tu correo electrónico
        </h2>

        <p style="margin: 0 0 24px; color: #5d6b63; font-size: 15px; line-height: 1.7;">
          ¡Hola! Utiliza el siguiente código para verificación.
        </p>

        <!-- Código de verificación -->
        <div style="margin: 0 auto 24px; padding: 20px 10px; background-color: #edf7f0; border: 1px solid #d4eadb; border-radius: 12px;">
           <p style="margin: 0 0 10px; color: #52715e; font-size: 12px; font-weight: bold; letter-spacing: 1.5px; text-transform: uppercase;">
             Tu código de verificación
           </p>

           <h1 style="margin: 0; color: #61AD9E; font-size: 34px; letter-spacing: 8px; font-weight: bold;">
             ${code}
           </h1>
         </div>

        <p style="margin: 0 0 10px; color: #37483d; font-size: 14px; line-height: 1.6;">
           <strong>Este código vence en 10 minutos.</strong>
         </p>

         <p style="margin: 0; color: #718078; font-size: 13px; line-height: 1.7;">
           Si no solicitaste este código, puedes ignorar este correo. No compartas tu código con otras personas.
         </p>

       </div>

      <!-- Pie del correo -->
      <div style="padding: 18px 20px; background-color: #f8faf8; border-top: 1px solid #e8eee9; text-align: center;">
         <p style="margin: 0; color: #7b8980; font-size: 12px; line-height: 1.6;">
           Este es un correo automático. Por favor, no respondas a este mensaje.
         </p>
         <p style="margin: 8px 0 0; color: #61AD9E; font-size: 12px; font-weight: bold;">
           Scan n'eat
         </p>
       </div>

     </div>

   </div>
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