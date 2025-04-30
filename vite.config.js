import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import basicSsl from '@vitejs/plugin-basic-ssl';
// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), basicSsl()],
    server: {
        host: true, // Expõe o servidor para acesso via rede
        port: 5173 // Porta padrão do Vite
    }
});
