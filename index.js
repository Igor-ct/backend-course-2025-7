const { program } = require('commander');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

program
  .requiredOption('-h, --host <address>', 'Адреса сервера')
  .requiredOption('-p, --port <number>', 'Порт сервера')
  .requiredOption('-c, --cache <path>', 'Шлях до директорії кешу');

program.parse(process.argv);
const { host, port, cache } = program.opts();

const cachePath = path.resolve(cache);

try {
  if (!fs.existsSync(cachePath)) {
    fs.mkdirSync(cachePath, { recursive: true });
  }
} catch (err) {
  console.error(`Не вдалося створити директорію кешу: ${err.message}`);
  process.exit(1);
}

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, cachePath),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Inventory API',
      version: '1.0.0',
      description: 'API Documentation',
    },
    servers: [{ url: `http://localhost:${port}` }],
  },
  apis: [__filename],
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

let inventory = [];
let idCounter = 1;

app.route('/RegisterForm.html')
  .get((req, res) => res.sendFile(path.join(__dirname, 'RegisterForm.html')))
  .all((req, res) => res.sendStatus(405));

app.route('/SearchForm.html')
  .get((req, res) => res.sendFile(path.join(__dirname, 'SearchForm.html')))
  .all((req, res) => res.sendStatus(405));
  
/**
 * @swagger
 * components:
 *   schemas:
 *     Item:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         inventory_name:
 *           type: string
 *         description:
 *           type: string
 *         photo:
 *           type: string
 *         photoUrl:
 *           type: string
 */

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Реєстрація нового пристрою
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *               description:
 *                 type: string
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: Bad Request
 */
app.post('/register', upload.single('photo'), (req, res) => {
  const { inventory_name, description } = req.body;

  if (!inventory_name) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).send('inventory_name is required');
  }

  const newItem = {
    id: idCounter++,
    inventory_name,
    description: description || '',
    photo: req.file ? req.file.filename : null,
  };

  inventory.push(newItem);
  res.status(201).json(newItem);
});

/**
 * @swagger
 * /inventory:
 *   get:
 *     summary: Отримання списку всіх речей
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Item'
 */
app.get('/inventory', (req, res) => {
  const result = inventory.map(item => ({
    ...item,
    photoUrl: item.photo ? `/inventory/${item.id}/photo` : null,
  }));
  res.status(200).json(result);
});

/**
 * @swagger
 * /inventory/{id}:
 *   get:
 *     summary: Отримання інформації про річ
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: OK
 *       404:
 *         description: Not found
 *
 *   put:
 *     summary: Оновлення імені або опису
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated
 *       404:
 *         description: Not found
 *
 *   delete:
 *     summary: Видалення речі
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
app.route('/inventory/:id')
  .get((req, res) => {
    const item = inventory.find(i => i.id === parseInt(req.params.id));
    if (!item) return res.status(404).send('Not found');

    res.status(200).json({
      ...item,
      photoUrl: item.photo ? `/inventory/${item.id}/photo` : null,
    });
  })

  .put((req, res) => {
    const item = inventory.find(i => i.id === parseInt(req.params.id));
    if (!item) return res.status(404).send('Not found');

    if (req.body.inventory_name) item.inventory_name = req.body.inventory_name;
    if (req.body.description) item.description = req.body.description;

    res.status(200).json(item);
  })

  .delete((req, res) => {
    const idx = inventory.findIndex(i => i.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).send('Not found');

    const item = inventory[idx];
    if (item.photo) {
      const p = path.join(cachePath, item.photo);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    inventory.splice(idx, 1);
    res.status(200).send('Deleted');
  });

/**
 * @swagger
 * /inventory/{id}/photo:
 *   get:
 *     summary: Отримання фото
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Image
 *       404:
 *         description: Not found
 *
 *   put:
 *     summary: Оновлення фото
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Updated
 *       404:
 *         description: Not found
 */
app.route('/inventory/:id/photo')
  .get((req, res) => {
    const item = inventory.find(i => i.id === parseInt(req.params.id));
    if (!item || !item.photo) return res.status(404).send('Photo not found');

    const p = path.join(cachePath, item.photo);
    if (fs.existsSync(p)) return res.sendFile(p);

    res.status(404).send('File missing');
  })

  .put(upload.single('photo'), (req, res) => {
    const item = inventory.find(i => i.id === parseInt(req.params.id));
    if (!item) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).send('Item not found');
    }

    if (!req.file) return res.status(400).send('No file uploaded');

    if (item.photo) {
      const oldP = path.join(cachePath, item.photo);
      if (fs.existsSync(oldP)) fs.unlinkSync(oldP);
    }

    item.photo = req.file.filename;
    res.status(200).send('Photo updated');
  });

/**
 * @swagger
 * /search:
 *   post:
 *     summary: Пошук речі
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *               has_photo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Found
 *       404:
 *         description: Not found
 */
app.route('/search')
  .post((req, res) => {
    const id = parseInt(req.body.id);
    const hasPhoto = req.body.has_photo === 'true' || req.body.has_photo === 'on';
    performSearch(res, id, hasPhoto);
  })
  .get((req, res) => {
    const id = parseInt(req.query.id);
    const hasPhoto = req.query.includePhoto === 'on' || req.query.includePhoto === 'true';
    performSearch(res, id, hasPhoto);
  })
  .all((req, res) => res.sendStatus(405));

function performSearch(res, id, hasPhoto) {
  if (!id) return res.status(400).send('ID is required');

  const item = inventory.find(i => i.id === id);

  if (!item) return res.status(404).send('Not Found');

  const responseData = {
    id: item.id,
    inventory_name: item.inventory_name,
    description: item.description
  };

  if (hasPhoto && item.photo) {
    responseData.photoUrl = `/inventory/${item.id}/photo`;
  }

  res.status(200).json(responseData);
}

app.use((req, res) => res.status(404).send('Not Found'));

const server = http.createServer(app);

server.listen(port, host, () => {
  console.log(`Server is running at http://${host}:${port}`);
  console.log(`Swagger Docs available at http://${host}:${port}/docs`);
});