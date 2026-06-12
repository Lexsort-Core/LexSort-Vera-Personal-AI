#!/usr/bin/env node
// scripts/setup-stripe-resources.js
// Sets up the Stripe Product and Price according to the Managed Payments blueprint.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error('\n❌ Error: STRIPE_SECRET_KEY is not defined in .env or .env.local.');
  console.log('Please obtain your Secret key from the Stripe Dashboard and configure it in your environment.\n');
  process.exit(1);
}

const stripe = require('stripe')(stripeKey);

async function run() {
  console.log('\n💳 Setting up Stripe Managed Payments Product...');
  console.log('━'.repeat(60));

  try {
    const product = await stripe.products.create({
      name: "Basic subscription",
      description: "A basic subscription to our service",
      tax_code: "txcd_10103100",
      default_price_data: {
        unit_amount: 1000,
        currency: "usd",
        recurring: {
          interval: "month"
        }
      }
    }, {
      apiVersion: '2026-02-25.preview'
    });

    console.log('✅ Product and Default Price created successfully!');
    console.log(`Product ID:       ${product.id}`);
    console.log(`Default Price ID: ${product.default_price}`);
    console.log(`Tax Code:         ${product.tax_code}`);
    console.log('━'.repeat(60));
    console.log('Please save these IDs and update your Netlify environment variables.');
    console.log('Specifically, set:');
    console.log(`STRIPE_PRO_PRICE_ID_MONTHLY=${product.default_price}`);
    console.log('');
  } catch (error) {
    console.error('❌ Failed to create product:', error.message);
    process.exit(1);
  }
}

run();
