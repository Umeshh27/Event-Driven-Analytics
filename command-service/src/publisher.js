const amqp = require('amqplib');
const db = require('./db');

let channel = null;
let connection = null;

async function connectRabbitMQ() {
  try {
    connection = await amqp.connect(process.env.BROKER_URL);
    channel = await connection.createChannel();
    console.log('Connected to RabbitMQ');
    
    await channel.assertQueue('order-events', { durable: true });
    await channel.assertQueue('product-events', { durable: true });
  } catch (err) {
    console.error('Failed to connect to RabbitMQ, retrying in 5s...', err);
    setTimeout(connectRabbitMQ, 5000);
  }
}

async function pollOutbox() {
  if (!channel) return;

  try {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      const result = await client.query(
        `SELECT id, topic, payload FROM outbox WHERE published_at IS NULL ORDER BY created_at ASC LIMIT 50 FOR UPDATE SKIP LOCKED`
      );

      const events = result.rows;
      if (events.length > 0) {
        for (const event of events) {
          const success = channel.sendToQueue(event.topic, Buffer.from(JSON.stringify(event.payload)), { persistent: true });
          
          if (success) {
            await client.query(`UPDATE outbox SET published_at = NOW() WHERE id = $1`, [event.id]);
          }
        }
      }
      
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('Error processing outbox:', e);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Outbox poll error:', err);
  }
}

function startPublisher() {
  connectRabbitMQ().then(() => {
    setInterval(pollOutbox, 2000);
  });
}

module.exports = { startPublisher };
