require('dotenv').config();
const express = require('express');
const db = require('./db');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/api/analytics/products/:productId/sales', async (req, res) => {
  const { productId } = req.params;
  try {
    const result = await db.query(
      'SELECT product_id, total_quantity_sold, total_revenue, order_count FROM product_sales_view WHERE product_id = $1',
      [productId]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        productId: parseInt(productId),
        totalQuantitySold: 0,
        totalRevenue: 0,
        orderCount: 0
      });
    }

    const row = result.rows[0];
    res.status(200).json({
      productId: parseInt(row.product_id),
      totalQuantitySold: parseInt(row.total_quantity_sold),
      totalRevenue: parseFloat(row.total_revenue),
      orderCount: parseInt(row.order_count)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/analytics/categories/:category/revenue', async (req, res) => {
  const { category } = req.params;
  try {
    const result = await db.query(
      'SELECT category_name, total_revenue, total_orders FROM category_metrics_view WHERE category_name = $1',
      [category]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        category,
        totalRevenue: 0,
        totalOrders: 0
      });
    }

    const row = result.rows[0];
    res.status(200).json({
      category: row.category_name,
      totalRevenue: parseFloat(row.total_revenue),
      totalOrders: parseInt(row.total_orders)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/analytics/customers/:customerId/lifetime-value', async (req, res) => {
  const { customerId } = req.params;
  try {
    const result = await db.query(
      'SELECT customer_id, total_spent, order_count, last_order_date FROM customer_ltv_view WHERE customer_id = $1',
      [customerId]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        customerId: parseInt(customerId),
        totalSpent: 0,
        orderCount: 0,
        lastOrderDate: null
      });
    }

    const row = result.rows[0];
    res.status(200).json({
      customerId: parseInt(row.customer_id),
      totalSpent: parseFloat(row.total_spent),
      orderCount: parseInt(row.order_count),
      lastOrderDate: row.last_order_date ? new Date(row.last_order_date).toISOString() : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/analytics/sync-status', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT processed_at FROM processed_events ORDER BY processed_at DESC LIMIT 1'
    );
    
    let lastProcessedEventTimestamp = null;
    let lagSeconds = 0;

    if (result.rows.length > 0) {
      const lastProcessedAt = new Date(result.rows[0].processed_at);
      lastProcessedEventTimestamp = lastProcessedAt.toISOString();
      lagSeconds = Math.max(0, (new Date() - lastProcessedAt) / 1000);
    }

    res.status(200).json({
      lastProcessedEventTimestamp,
      lagSeconds
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
  console.log(`Query Service running on port ${PORT}`);
});
