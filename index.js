require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const cors = require("cors");


const app = express();

const corsOptions = {
  origin: ["exp://10.158.61.81:8081", "http://localhost:8081"], // Add your Expo app URL and local dev URL
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
app.use(cors(corsOptions));


// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Swagger options
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Bill Generator API",
      version: "1.0.0",
      description: "API for Bill Generator application connected to Neon PostgreSQL"
    },
    servers: [
      { url: "https://bill-generator-backend-sooty.vercel.app" },
      { url: `http://localhost:${process.env.PORT || 3000}` }
    ]
  },
  apis: ["./index.js"],
};


const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Helper function for pagination
const getPaginationParams = (req) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

/**
 * @swagger
 * components:
 *   schemas:
 *     Product:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         price:
 *           type: number
 *         mrp:
 *           type: number
 *         image_url:
 *           type: string
 *         sku:
 *           type: string
 *         category:
 *           type: string
 */

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Get products with search and pagination
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of products
 */
app.get("/api/products", async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req);
    const search = req.query.search || '';
    
    let query = "SELECT * FROM products";
    let countQuery = "SELECT COUNT(*) FROM products";
    let queryParams = [];
    
    if (search) {
      query += " WHERE name ILIKE $1 OR sku ILIKE $1";
      countQuery += " WHERE name ILIKE $1 OR sku ILIKE $1";
      queryParams.push(`%${search}%`);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);
    
    const [products, totalResult] = await Promise.all([
      pool.query(query, queryParams),
      pool.query(countQuery, search ? [`%${search}%`] : [])
    ]);
    
    res.json({
      items: products.rows,
      total: parseInt(totalResult.rows[0].count),
      page,
      limit
    });
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Get product by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product details
 */
app.get("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM products WHERE id = $1", [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    
    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create a new product
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - price
 *               - mrp
 *             properties:
 *               name:
 *                 type: string
 *               price:
 *                 type: number
 *               mrp:
 *                 type: number
 *               image_url:
 *                 type: string
 *               sku:
 *                 type: string
 *               category:
 *                 type: string
 *     responses:
 *       201:
 *         description: Product created
 */
app.post("/api/products", async (req, res) => {
  try {
    const { name, price, mrp, image_url, sku, category } = req.body;
    
    if (!name || !price || !mrp) {
      return res.status(400).json({ error: "Name, price, and MRP are required" });
    }
    
    const result = await pool.query(`
      INSERT INTO products (name, price, mrp, image_url, sku, category, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `, [name, price, mrp, image_url, sku, category]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error creating product:", err);
    if (err.code === '23505') { // Unique constraint violation
      res.status(400).json({ error: "SKU already exists" });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * @swagger
 * /api/products/{id}:
 *   put:
 *     summary: Update product
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Product updated
 */
app.put("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const allowedFields = ['name', 'price', 'mrp', 'image_url', 'sku', 'category'];
    const fields = Object.keys(updates).filter(key => 
      allowedFields.includes(key) && updates[key] !== undefined
    );
    
    if (fields.length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    const values = [id, ...fields.map(field => updates[field])];
    
    const result = await pool.query(`
      UPDATE products 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 
      RETURNING *
    `, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating product:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/products/{id}:
 *   delete:
 *     summary: Delete product
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product deleted
 */
app.delete("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM products WHERE id = $1 RETURNING *", [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error("Error deleting product:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/bills:
 *   post:
 *     summary: Create a new bill with items
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *               - total_amount
 *               - total_mrp
 *               - total_savings
 *               - created_by
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     product_id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     price:
 *                       type: number
 *                     mrp:
 *                       type: number
 *                     quantity:
 *                       type: integer
 *               total_amount:
 *                 type: number
 *               total_mrp:
 *                 type: number
 *               total_savings:
 *                 type: number
 *               created_by:
 *                 type: string
 *     responses:
 *       201:
 *         description: Bill created
 */
app.post("/api/bills", async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { items, total_amount, total_mrp, total_savings, created_by } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items array is required" });
    }
    
    // Create the bill
    const billResult = await client.query(`
      INSERT INTO bills (total_amount, total_mrp, total_savings, created_by, created_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      RETURNING *
    `, [total_amount, total_mrp, total_savings, created_by]);
    
    const billId = billResult.rows[0].id;
    
    // Create bill items
    for (const item of items) {
      await client.query(`
        INSERT INTO bill_items (bill_id, product_id, name, price, mrp, quantity)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [billId, item.product_id, item.name, item.price, item.mrp, item.quantity]);
    }
    
    await client.query('COMMIT');
    
    // Fetch the complete bill with items
    const completeBill = await pool.query(`
      SELECT 
        b.*,
        json_agg(
          json_build_object(
            'id', bi.id,
            'product_id', bi.product_id,
            'name', bi.name,
            'price', bi.price,
            'mrp', bi.mrp,
            'quantity', bi.quantity
          )
        ) as items
      FROM bills b
      LEFT JOIN bill_items bi ON b.id = bi.bill_id
      WHERE b.id = $1
      GROUP BY b.id
    `, [billId]);
    
    res.status(201).json(completeBill.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error creating bill:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/bills:
 *   get:
 *     summary: Get bills with date range and pagination
 *     parameters:
 *       - in: query
 *         name: start
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of bills with items
 */
app.get("/api/bills", async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req);
    const { start, end } = req.query;
    
    let query = `
      SELECT 
        b.*,
        json_agg(
          json_build_object(
            'id', bi.id,
            'product_id', bi.product_id,
            'name', bi.name,
            'price', bi.price,
            'mrp', bi.mrp,
            'quantity', bi.quantity
          )
        ) as items
      FROM bills b
      LEFT JOIN bill_items bi ON b.id = bi.bill_id
    `;
    let countQuery = "SELECT COUNT(*) FROM bills";
    let queryParams = [];
    
    if (start || end) {
      const conditions = [];
      if (start) {
        conditions.push(`b.created_at::date >= $${queryParams.length + 1}`);
        queryParams.push(start);
      }
      if (end) {
        conditions.push(`b.created_at::date <= $${queryParams.length + 1}`);
        queryParams.push(end);
      }
      const whereClause = ` WHERE ${conditions.join(' AND ')}`;
      query += whereClause;
      // countQuery should not use the alias "b."
      countQuery += whereClause.replace(/b\./g, '');
    }
    
    query += ` GROUP BY b.id ORDER BY b.created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    const finalParams = [...queryParams, limit, offset];
    
    const [bills, totalResult] = await Promise.all([
      pool.query(query, finalParams),
      pool.query(countQuery, queryParams)
    ]);
    
    res.json({
      items: bills.rows,
      total: parseInt(totalResult.rows[0].count),
      page,
      limit
    });
  } catch (err) {
    console.error("Error fetching bills:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/bills/{id}:
 *   get:
 *     summary: Get bill by ID with items
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Bill details with items
 */
app.get("/api/bills/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT 
        b.*,
        json_agg(
          json_build_object(
            'id', bi.id,
            'product_id', bi.product_id,
            'name', bi.name,
            'price', bi.price,
            'mrp', bi.mrp,
            'quantity', bi.quantity
          )
        ) as items
      FROM bills b
      LEFT JOIN bill_items bi ON b.id = bi.bill_id
      WHERE b.id = $1
      GROUP BY b.id
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Bill not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching bill:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/sales/summary:
 *   get:
 *     summary: Get sales summary and analytics
 *     parameters:
 *       - in: query
 *         name: start
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [product, day, month]
 *     responses:
 *       200:
 *         description: Sales summary
 */
app.get("/api/sales/summary", async (req, res) => {
  try {
    const { start, end, groupBy } = req.query;
    
    let whereClause = "";
    let queryParams = [];
    
    if (start || end) {
      const conditions = [];
      if (start) {
        conditions.push(`b.created_at::date >= $${queryParams.length + 1}`);
        queryParams.push(start);
      }
      if (end) {
        conditions.push(`b.created_at::date <= $${queryParams.length + 1}`);
        queryParams.push(end);
      }
      whereClause = ` WHERE ${conditions.join(' AND ')}`;
    }
    
    // Basic summary (no alias in FROM)
    const summaryResult = await pool.query(`
      SELECT 
        COUNT(*) as total_bills,
        SUM(total_amount) as total_sales,
        SUM(total_savings) as total_savings,
        SUM(total_mrp) as total_mrp
      FROM bills
      ${whereClause ? whereClause.replace(/b\./g, '') : ''}
    `, queryParams);
    
    // Total items sold
    const itemsResult = await pool.query(`
      SELECT SUM(bi.quantity) as total_items_sold
      FROM bills b
      JOIN bill_items bi ON b.id = bi.bill_id
      ${whereClause}
    `, queryParams);
    
    // Top products
    const topProductsResult = await pool.query(`
      SELECT 
        bi.name as product_name,
        SUM(bi.quantity) as total_quantity,
        SUM(bi.price * bi.quantity) as total_revenue,
        SUM(bi.mrp * bi.quantity) as total_mrp_value
      FROM bills b
      JOIN bill_items bi ON b.id = bi.bill_id
      ${whereClause}
      GROUP BY bi.name, bi.product_id
      ORDER BY total_revenue DESC
      LIMIT 10
    `, queryParams);
    
    const summary = summaryResult.rows[0] || {
      total_bills: 0, total_sales: 0, total_savings: 0, total_mrp: 0
    };
    summary.total_items_sold = (itemsResult.rows[0] && itemsResult.rows[0].total_items_sold) || 0;
    
    res.json({
      ...summary,
      top_products: topProductsResult.rows
    });
  } catch (err) {
    console.error("Error fetching sales summary:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get user/shop details
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User details
 */
app.get("/api/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching user:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Update user/shop details
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: User updated
 */
app.put("/api/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const allowedFields = ['name', 'shop_name', 'shop_address', 'phone', 'email', 'gst', 'avatar_url', 'settings'];
    const fields = Object.keys(updates).filter(key => 
      allowedFields.includes(key) && updates[key] !== undefined
    );
    
    if (fields.length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    const values = [id, ...fields.map(field => updates[field])];
    
    const result = await pool.query(`
      UPDATE users 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 
      RETURNING *
    `, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating user:", err);
    res.status(500).json({ error: err.message });
  }
});

// Placeholder for image upload endpoint
/**
 * @swagger
 * /api/uploads/image:
 *   post:
 *     summary: Upload image (placeholder)
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Image uploaded
 */
app.post("/api/uploads/image", (req, res) => {
  // This is a placeholder - you'll need to implement actual file upload
  // using multer and cloud storage (AWS S3, Google Cloud Storage, etc.)
  res.json({ 
    message: "Image upload endpoint - implement with multer and cloud storage",
    url: "https://example.com/placeholder-image.jpg"
  });
});

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: Get current user profile
 *     responses:
 *       200:
 *         description: User profile
 */
app.get("/api/users/profile", async (req, res) => {
  try {
    // You'll need to implement authentication middleware to get current user ID
    // For now, using a placeholder user ID - replace with actual auth logic
    const userId = req.user?.id || 'your-default-user-id'; 
    
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching user profile:", err);
    res.status(500).json({ error: err.message });
  }
});


// Legacy endpoint for compatibility
app.get("/users", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users");
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  const port = process.env.PORT || 3000;
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📄 Swagger UI available at http://localhost:${port}/api-docs`);
});
