const { program } = require('commander');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const mysql = require('mysql2/promise'); 
require('dotenv').config();


program
  .option('-h, --host <address>', 'Адреса сервера')
  .option('-p, --port <number>', 'Порт сервера')
  .option('-c, --cache <path>', 'Шлях до директорії кешу');

program.parse(process.argv);
const opts = program.opts();

const host = opts.host || process.env.HOST || '0.0.0.0';
const port = opts.port || process.env.PORT || 3000;
const cache = opts.cache || process.env.CACHE_DIR || './cache';

const cachePath = path.resolve(cache);

const pool = mysql.createPool({
  host: process.env.DB_HOST,       
  user: process.env.DB_USER,       
  password: process.env.DB_PASSWORD, 
  database: process.env.DB_NAME,   
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function waitForDB() {
  let retries = 10; 
  while (retries > 0) {
    try {
      const conn = await pool.getConnection();
      console.log("✅ Успішне з'єднання з Базою Даних!");
      conn.release();
      return; 
    } catch (err) {
      console.log(`⏳ База ще завантажується... Чекаємо 5 секунд. (Залишилось спроб: ${retries})`);
      retries -= 1;
      await new Promise(res => setTimeout(res, 5000)); 
    }
  }
  console.error("❌ Не вдалося підключитися до БД. Вимикаємо сервер.");
  process.exit(1);
}

waitForDB();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, cachePath),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

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
app.post('/register', upload.single('photo'), async (req, res) => {
  const { inventory_name, description } = req.body;

  if (!inventory_name) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).send('inventory_name is required');
  }

  try {
    const [result] = await pool.execute(
      "INSERT INTO inventory (inventory_name, description, photo) VALUES (?, ?, ?)",
      [inventory_name, description || '', req.file ? req.file.filename : null]
    );

    const newItem = {
      id: result.insertId,
      inventory_name,
      description: description || '',
      photo: req.file ? req.file.filename : null,
    };

    res.status(201).json(newItem);

  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  }
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
app.get('/inventory', async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM inventory");

    const result = rows.map(item => ({
      ...item,
      photoUrl: item.photo ? `/inventory/${item.id}/photo` : null
    }));

    res.json(result);

  } catch (err) {
    res.status(500).send('Database error');
  }
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
app.get('/inventory/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM inventory WHERE id = ?", [req.params.id]);

    if (rows.length === 0) return res.status(404).send('Not found');

    const item = rows[0];

    res.json({
      ...item,
      photoUrl: item.photo ? `/inventory/${item.id}/photo` : null
    });

  } catch (err) {
    res.status(500).send('Database error');
  }
});


app.put('/inventory/:id', async (req, res) => {
  const { inventory_name, description } = req.body;

  try {
    const [result] = await pool.execute(
      "UPDATE inventory SET inventory_name=?, description=? WHERE id=?",
      [inventory_name, description, req.params.id]
    );

    if (result.affectedRows === 0) return res.status(404).send('Not found');

    res.json({ id: req.params.id, inventory_name, description });

  } catch (err) {
    console.error(err); 
    res.status(500).send('Database error');
  }
});


app.delete('/inventory/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT photo FROM inventory WHERE id=?", [req.params.id]);

    if (rows.length === 0) return res.status(404).send('Not found');

    const photo = rows[0].photo;

    if (photo) {
      const p = path.join(cachePath, photo);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    await pool.execute("DELETE FROM inventory WHERE id=?", [req.params.id]);

    res.send('Deleted');

  } catch (err) {
    res.status(500).send('Database error');
  }
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
app.get('/inventory/:id/photo', async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT photo FROM inventory WHERE id=?", [req.params.id]);

    if (!rows.length || !rows[0].photo) return res.status(404).send('Photo not found');

    const filepath = path.join(cachePath, rows[0].photo);
    if (!fs.existsSync(filepath)) return res.status(404).send('File missing');

    res.sendFile(filepath);

  } catch (err) {
    res.status(500).send('Database error');
  }
});


app.put('/inventory/:id/photo', upload.single('photo'), async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT photo FROM inventory WHERE id=?", [req.params.id]);
    if (!rows.length) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).send('Item not found');
    }

    if (!req.file) return res.status(400).send('No file uploaded');

    const oldPhoto = rows[0].photo;
    if (oldPhoto) {
      const oldPath = path.join(cachePath, oldPhoto);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    await pool.execute(
      "UPDATE inventory SET photo=? WHERE id=?",
      [req.file.filename, req.params.id]
    );

    res.send('Photo updated');

  } catch (err) {
    res.status(500).send('Database error');
  }
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

async function performSearch(res, id, hasPhoto) {
  if (!id) return res.status(400).send('ID is required');

  try {
    const [rows] = await pool.execute("SELECT * FROM inventory WHERE id=?", [id]);

    if (!rows.length) return res.status(404).send('Not Found');

    const item = rows[0];

    const result = {
      id: item.id,
      inventory_name: item.inventory_name,
      description: item.description,
    };

    if (hasPhoto && item.photo)
      result.photoUrl = `/inventory/${item.id}/photo`;

    res.json(result);

  } catch (err) {
    res.status(500).send('Database error');
  }
}


app.use((req, res) => res.status(404).send('Not Found'));

const server = http.createServer(app);

server.listen(port, host, () => {
  console.log(`Server is     running at http://${host}:${port}`);
  console.log(`Swagger Docs available at http://${host}:${port}/docs`);
});