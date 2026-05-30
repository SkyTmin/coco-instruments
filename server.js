import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the built Vite app (run `npm run build` first to produce dist/).
const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir));

// SPA fallback: any non-asset route returns index.html so client-side routing works.
app.get('*', (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
