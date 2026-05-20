const TelegramBot = require('node-telegram-bot-api');
const Razorpay = require('razorpay');
const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(express.json());

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const subSchema = new mongoose.Schema({
  userId: String,
  username: String,
  expiry: Date,
  paid: Boolean,
});
const Sub = mongoose.model('Sub', subSchema);

mongoose.connect(process.env.MONGO_URI);

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  await bot.sendPhoto(chatId, process.env.PHOTO_1, {
    caption: '🔥 Sample Preview 1'
  });

  await bot.sendPhoto(chatId, process.env.PHOTO_2, {
    caption: '🔥 Sample Preview 2'
  });

  await bot.sendMessage(chatId,
    `✨ *Exclusive AI Content Channel*\n\n` +
    `📸 Daily premium AI photos\n` +
    `🔒 Private members only\n` +
    `💎 Only ₹299/month\n\n` +
    `👇 Click below to subscribe now!`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '💳 Subscribe ₹299/month', callback_data: 'subscribe' }
        ]]
      }
    }
  );
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const username = query.from.username || query.from.first_name;

  if (query.data === 'subscribe') {
    try {
      const paymentLink = await razorpay.paymentLink.create({
        amount: 29900,
        currency: 'INR',
        description: 'Monthly Subscription',
        customer: { name: username },
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: { telegram_user_id: String(userId) },
      });

      await bot.sendMessage(chatId,
        `💳 *Your Payment Link Ready!*\n\n` +
        `Amount: ₹299\n\n` +
        `👇 Click to pay via UPI:\n${paymentLink.short_url}\n\n` +
        `✅ After payment you will get channel access automatically!`,
        { parse_mode: 'Markdown' }
      );

      await Sub.findOneAndUpdate(
        { userId: String(userId) },
        { userId: String(userId), username, paid: false },
        { upsert: true }
      );

    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, '❌ Error creating payment. Please try again.');
    }
  }
});

app.post('/razorpay-webhook', async (req, res) => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const signature = req.headers['x-razorpay-signature'];
  const crypto = require('crypto');

  const hmac = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hmac !== signature) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (req.body.event === 'payment_link.paid') {
    const notes = req.body.payload.payment_link.entity.notes;
    const userId = notes.telegram_user_id;

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);

    await Sub.findOneAndUpdate(
      { userId },
      { paid: true, expiry },
      { upsert: true }
    );

    const invite = await bot.createChatInviteLink(
      process.env.CHANNEL_ID,
      { member_limit: 1 }
    );

    await bot.sendMessage(userId,
      `🎉 *Payment Successful! Welcome!*\n\n` +
      `👇 Your private channel link (one time use):\n${invite.invite_link}\n\n` +
      `📅 Valid for 30 days.`,
      { parse_mode: 'Markdown' }
    );
  }

  res.json({ status: 'ok' });
});

async function kickExpiredUsers() {
  const expired = await Sub.find({ paid: true, expiry: { $lt: new Date() } });
  for (const user of expired) {
    try {
      await bot.banChatMember(process.env.CHANNEL_ID, user.userId);
      await bot.unbanChatMember(process.env.CHANNEL_ID, user.userId);
      await bot.sendMessage(user.userId,
        `⏰ Subscription expired.\n\nRenew for ₹299 → /start`
      );
      await Sub.findOneAndUpdate({ userId: user.userId }, { paid: false });
    } catch (e) {
      console.error(e);
    }
  }
}

setInterval(kickExpiredUsers, 24 * 60 * 60 * 1000);

app.listen(3000, () => console.log('Bot running!'));
