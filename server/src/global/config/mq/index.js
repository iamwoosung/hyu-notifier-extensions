const amqplib = require('amqplib');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../modules/logger');

const EXCHANGE = 'hyu.notifier';
const RECONNECT_INTERVAL = 5000; // 5초

let channel = null;

async function initWithRetry(attempt = 1) {
  const url = process.env.MQ_URL || 'amqp://guest:guest@localhost:5672';

  try {
    const conn = await amqplib.connect(url);
    channel = await conn.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    logger.info('RabbitMQ Connection : success');

    conn.on('error', (err) => {
      logger.error(`[MQ] 연결 오류: ${err.message}`);
    });

    conn.on('close', () => {
      logger.warn('[MQ] 연결 종료. 5초 후 재연결 시도...');
      channel = null;
      setTimeout(() => initWithRetry(attempt + 1), RECONNECT_INTERVAL);
    });

  } catch (err) {
    logger.error(`RabbitMQ Connection : error ${err.message} (시도 ${attempt})`);
    logger.warn(`${RECONNECT_INTERVAL / 1000}초 후 재시도...`);
    await new Promise(resolve => setTimeout(resolve, RECONNECT_INTERVAL));
    return await initWithRetry(attempt + 1);
  }
}

async function publish(routingKey, payload) {
  if (!channel) {
    throw new Error('MQ channel not initialized');
  }

  const message = {
    type: routingKey.toUpperCase().replace(/\./g, '_'),
    messageId: uuidv4(),
    timestamp: new Date().toISOString(),
    payload,
  };

  try {
    channel.publish(
      EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      { persistent: true }
    );
    logger.info(`[MQ PUBLISH] ${routingKey} | messageId: ${message.messageId}`);
    return message.messageId;
  } catch (err) {
    logger.error(`[MQ PUBLISH ERROR] ${routingKey} | ${err.message}`);
    throw err;
  }
}

module.exports = { init: initWithRetry, publish };
