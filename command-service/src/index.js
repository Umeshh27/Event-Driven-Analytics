require('dotenv').config();
const express = require('express');
const db = require('./db');
const { startPublisher } = require('./publisher');

const app = express();
app.use(express.json());
app.get('/health', (req, res) => res.status(200).send('OK'));

app.post('/api/products', async (req, res) => {
  const { name, category, price, stock } = req.body;
  if (!name || !category || price === undefined || stock === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await db.query(
      'INSERT INTO products (name, category, price, stock) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, category, price, stock]
    );
    const productId = result.rows[0].id;
    
    const payload = {
      eventType: 'ProductCreated',
      productId, name, category, price, stock,
      timestamp: new Date().toISOString()
    };
    await db.query(`INSERT INTO outbox (topic, payload) VALUES ($1, $2)`, ['product-events', payload]);

    res.status(201).json({ productId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/orders', async (req, res) => {
  const { customerId, items } = req.body;
  if (!customerId || !items || !items.length) {
    return res.status(400).json({ error: 'Missing customerId or items' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    let total = 0;
    const enrichedItems = [];
    
    for (const item of items) {
      const prodRes = await client.query('SELECT name, category, stock, price FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
      if (prodRes.rows.length === 0) {
        throw new Error(`Product ${item.productId} not found`);
      }
      const product = prodRes.rows[0];
      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for product ${item.productId}`);
      }
      
      const itemPrice = item.price !== undefined ? parseFloat(item.price) : parseFloat(product.price);
      total += itemPrice * item.quantity;
      
      enrichedItems.push({
        productId: item.productId,
        quantity: item.quantity,
        price: itemPrice,
        category: product.category
      });
      
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.productId]);
    }

    const orderRes = await client.query(
      'INSERT INTO orders (customer_id, total, status) VALUES ($1, $2, $3) RETURNING id, created_at',
      [customerId, total, 'COMPLETED']
    );
    const order = orderRes.rows[0];
    const orderId = order.id;

    for (const item of enrichedItems) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [orderId, item.productId, item.quantity, item.price]
      );
    }

    const payload = {
      eventType: 'OrderCreated',
      orderId,
      customerId,
      items: enrichedItems,
      total,
      timestamp: order.created_at.toISOString()
    };
    
    await client.query('INSERT INTO outbox (topic, payload) VALUES ($1, $2)', ['order-events', payload]);

    await client.query('COMMIT');
    res.status(201).json({ orderId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Command Service running on port ${PORT}`);
  startPublisher();
});
