# CMI Payment Integration API

A Node.js API for integrating with CMI (Credit Mutuel du Maroc) payment gateway, designed to work with Bubble.io applications.

## Features

- ✅ CMI Payment Gateway Integration
- ✅ Secure SHA-512 hash verification
- ✅ Redis data storage with automatic expiration
- ✅ Bubble.io webhook notifications with custom data
- ✅ Vercel deployment ready

## API Endpoints

### Create Payment

```
POST /api/payments/create
```

**Request Body:**

```json
{
  "amount": 100.0,
  "email": "customer@example.com",
  "phone": "+212600000000",
  "name": "John Doe",
  "description": "Payment for services",
  "guest_id": "1234567890",
  "donated_to": "Test Donation",
  "donation_amount": 5,
  "access_price": 50
}
```

**Required Fields:**

- `amount` - Payment amount in MAD
- `email` - Customer email
- `phone` - Customer phone number
- `name` - Customer name

**Optional Custom Fields:**

- `description` - Payment description
- `guest_id` - Guest identifier
- `donated_to` - Donation recipient
- `donation_amount` - Donation amount
- `access_price` - Access price

**Response:**

```json
{
  "success": true,
  "transactionId": "TXN_1234567890_abc123",
  "paymentForm": "<form>...</form>"
}
```

### Get Transaction Status

```
GET /api/payments/status/:transactionId
```

### Health Check

```
GET /health
```

## Environment Variables

Create a `.env` file with the following variables:

```env
# CMI Configuration
CMI_STORE_KEY=your_cmi_store_key_here
CMI_CLIENT_ID=your_cmi_client_id_here

# Redis Configuration
REDIS_URL=redis://localhost:6379

# Bubble.io Integration
BUBBLE_ENDPOINT_URL=https://your-app.bubbleapps.io/version-test/api/1.1/wf/cmi-callback/initialize
BUBBLE_API_KEY=your_bubble_api_key_here

# URLs (update for production)
SHOP_URL=http://localhost:3000
OK_URL=http://localhost:3000/success
FAIL_URL=http://localhost:3000/failure
CALLBACK_URL=http://localhost:3000/api/payments/callback

# Server
PORT=3000
```

## Local Development

1. **Install dependencies:**

```bash
npm install
```

2. **Set up Redis:**

```bash
# Install Redis locally or use a cloud service
redis-server
```

3. **Configure environment variables:**

```bash
# Copy .env.example to .env and fill in your values
cp .env.example .env
```

4. **Start development server:**

```bash
npm run dev
```

## Vercel Deployment

1. **Install Vercel CLI:**

```bash
npm i -g vercel
```

2. **Deploy:**

```bash
vercel
```

3. **Set environment variables:**

```bash
vercel env add CMI_STORE_KEY
vercel env add CMI_CLIENT_ID
vercel env add REDIS_URL
vercel env add BUBBLE_ENDPOINT_URL
vercel env add BUBBLE_API_KEY
vercel env add SHOP_URL
vercel env add OK_URL
vercel env add FAIL_URL
vercel env add CALLBACK_URL
```

4. **Redeploy:**

```bash
vercel --prod
```

## Bubble.io Integration

The API automatically sends webhook notifications to your Bubble.io application with the following data:

```json
{
  "transactionId": "TXN_1234567890_abc123",
  "amount": 100.0,
  "email": "customer@example.com",
  "name": "John Doe",
  "phone": "+212600000000",
  "description": "Payment for services",
  "status": "success|failed|security_failed",
  "completedAt": "2024-01-01T00:05:00.000Z",
  "failedAt": "2024-01-01T00:05:00.000Z",
  "cmiResponse": {
    /* CMI response data */
  },
  "guest_id": "1234567890",
  "donated_to": "Test Donation",
  "donation_amount": 5,
  "access_price": 50
}
```

## Hash Verification & Custom Data

### How Hash Verification Works

The API uses SHA-512 hash verification to ensure payment security:

1. **Hash Calculation Process:**

   - All POST parameters from CMI are collected
   - Parameters are sorted alphabetically (case-insensitive)
   - Each parameter value is URL-decoded and escaped
   - Values are concatenated with `|` separator
   - Store key is appended at the end
   - SHA-512 hash is calculated and converted to base64

2. **Excluded Fields:**
   - `hash` - The hash field itself
   - `encoding` - Encoding parameter
   - **Custom data fields are NOT sent to CMI** - they're stored separately in Redis

### Custom Data Handling

**Why Custom Data is Excluded from Hash Verification:**

- Custom fields (`guest_id`, `donated_to`, `donation_amount`, `access_price`) are **NOT sent to CMI**
- They are stored separately in Redis with the transaction data
- This prevents hash verification issues since CMI doesn't know about these fields
- Custom data is included in Bubble.io webhook notifications after payment completion

**Security Benefits:**

- Hash verification only includes fields that CMI actually sends
- Custom data remains secure in Redis storage
- No hash mismatches due to unknown custom fields
- Clean separation between payment processing and custom business logic

## Redis Storage

- Transactions are stored with 1-hour expiration
- Custom data is preserved and sent to Bubble.io webhooks
- Automatic cleanup prevents data accumulation
- Redis connection is required for the API to function

## License

MIT
