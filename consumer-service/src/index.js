require('dotenv').config();
const amqp = require('amqplib');
const crypto = require('crypto');
const db = require('./db');

async function handleOrderCreated(payload, eventId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    const checkRes = await client.query('SELECT 1 FROM processed_events WHERE event_id = $1', [eventId]);
    if (checkRes.rows.length > 0) {
      console.log(`Event ${eventId} already processed, skipping.`);
      await client.query('ROLLBACK');
      return;
    }
    
    await client.query('INSERT INTO processed_events (event_id, processed_at) VALUES ($1, NOW())', [eventId]);

    const { orderId, customerId, items, total, timestamp } = payload;
    const orderDate = new Date(timestamp);
    const hourTimestamp = new Date(Date.UTC(orderDate.getUTCFullYear(), orderDate.getUTCMonth(), orderDate.getUTCDate(), orderDate.getUTCHours())).toISOString();

    await client.query(`
      INSERT INTO customer_ltv_view (customer_id, total_spent, order_count, last_order_date) 
      VALUES ($1, $2, 1, $3)
      ON CONFLICT (customer_id) DO UPDATE SET 
        total_spent = customer_ltv_view.total_spent + $2,
        order_count = customer_ltv_view.order_count + 1,
        last_order_date = GREATEST(customer_ltv_view.last_order_date, EXCLUDED.last_order_date)
    `, [customerId, total, timestamp]);

    await client.query(`
      INSERT INTO hourly_sales_view (hour_timestamp, total_orders, total_revenue)
      VALUES ($1, 1, $2)
      ON CONFLICT (hour_timestamp) DO UPDATE SET
        total_orders = hourly_sales_view.total_orders + 1,
        total_revenue = hourly_sales_view.total_revenue + $2
    `, [hourTimestamp, total]);

    for (const item of items) {
      const { productId, quantity, price, category } = item;
      const itemRevenue = quantity * price;

      await client.query(`
        INSERT INTO product_sales_view (product_id, total_quantity_sold, total_revenue, order_count)
        VALUES ($1, $2, $3, 1)
        ON CONFLICT (product_id) DO UPDATE SET
          total_quantity_sold = product_sales_view.total_quantity_sold + $2,
          total_revenue = product_sales_view.total_revenue + $3,
          order_count = product_sales_view.order_count + 1
      `, [productId, quantity, itemRevenue]);

      if (category) {
        await client.query(`
          INSERT INTO category_metrics_view (category_name, total_revenue, total_orders)
          VALUES ($1, $2, 1)
          ON CONFLICT (category_name) DO UPDATE SET
            total_revenue = category_metrics_view.total_revenue + $2,
            total_orders = category_metrics_view.total_orders + 1
        `, [category, itemRevenue]);
      }
    }

    await client.query('COMMIT');
    console.log(`Successfully processed OrderCreated event ${eventId} for order ${orderId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Failed to process OrderCreated event ${eventId}`, err);
    throw err;
  } finally {
    client.release();
  }
}

async function start() {
  try {
    const connection = await amqp.connect(process.env.BROKER_URL);
    const channel = await connection.createChannel();
    const queue = 'order-events';

    await channel.assertQueue(queue, { durable: true });
    channel.prefetch(1);

    console.log('Consumer Service connected to RabbitMQ. Waiting for messages in %s.', queue);

    channel.consume(queue, async (msg) => {
      if (msg !== null) {
        try {
          const event = JSON.parse(msg.content.toString());
          let payload = event;
          const eventId = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

          if (payload.eventType === 'OrderCreated') {
            const generateUUID = (str) => {
               const md5 = crypto.createHash('md5').update(str).digest('hex');
               return md5.slice(0, 8) + '-' + md5.slice(8, 12) + '-4' + md5.slice(13, 16) + '-a' + md5.slice(17, 20) + '-' + md5.slice(20, 32);
            };
            const computedEventId = generateUUID(payload.orderId + '-' + payload.eventType);
            
            await handleOrderCreated(payload, computedEventId);
          } else {
            console.log(`Unknown event type ${payload.eventType}, ignoring.`);
          }

          channel.ack(msg);
        } catch (err) {
          console.error('Error processing message, requeuing...', err);
          channel.nack(msg, false, true); 
          await new Promise(res => setTimeout(res, 1000));
        }
      }
    });

  } catch (err) {
    console.error('Failed to start consumer, retrying in 5s...', err);
    setTimeout(start, 5000);
  }
}

start();
