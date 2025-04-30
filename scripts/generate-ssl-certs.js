import mkcert from 'mkcert';
import fs from 'fs';
import path from 'path';

async function generateCerts() {
  // Criar uma nova autoridade certificadora
  const ca = await mkcert.createCA({
    organization: 'Baxus Local CA',
    countryCode: 'BR',
    state: 'Local',
    locality: 'Development',
    validityDays: 365
  });

  // Criar um certificado assinado pela CA
  const cert = await mkcert.createCert({
    domains: ['localhost', '127.0.0.1'],
    validityDays: 365,
    caKey: ca.key,
    caCert: ca.cert
  });

  // Criar diretório .cert se não existir
  const certDir = path.resolve('.cert');
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  // Salvar os arquivos de certificado
  fs.writeFileSync(path.resolve('.cert', 'cert.pem'), cert.cert);
  fs.writeFileSync(path.resolve('.cert', 'key.pem'), cert.key);

  console.log('Certificados SSL gerados com sucesso!');
}

generateCerts().catch(console.error);