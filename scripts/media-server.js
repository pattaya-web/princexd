// Serveur de medias, isole du dashboard.
//
// Les modeles d'image de KIE vont CHERCHER les fichiers sur internet : ils ne
// savent pas lire un fichier local. Ce serveur expose donc `data/media`, et
// rien d'autre, pour qu'un tunnel puisse le rendre accessible sans jamais
// exposer le CRM, les leads ni les cles d'API du dashboard.
//
// Lecture seule, un seul dossier, aucun listing.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.MEDIA_PORT) || 3002;
const ROOT = path.resolve(__dirname, '..', 'data', 'media');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

fs.mkdirSync(ROOT, { recursive: true });

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }

  const name = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
  if (!name) {
    res.writeHead(404).end('Not Found');
    return;
  }

  // Le nom demande doit designer un fichier PLAT du dossier : pas de
  // sous-chemin, pas de remontee. On resout puis on verifie l'appartenance.
  const target = path.resolve(ROOT, path.basename(name));
  if (path.dirname(target) !== ROOT) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  const ext = path.extname(target).toLowerCase();
  if (!MIME[ext]) {
    res.writeHead(415).end('Unsupported Media Type');
    return;
  }

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404).end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext],
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=3600',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(target).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Medias servis sur http://localhost:${PORT} depuis ${ROOT}`);
});
