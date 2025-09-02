# CMI Payment Integration API

A Node.js API for integrating with CMI (Credit Mutuel du Maroc) payment gateway, designed to work with Bubble.io applications.

## Features

- ✅ CMI Payment Gateway Integration
- ✅ Secure hash verification
- ✅ Bubble.io webhook notifications
- ✅ Transaction status tracking
- ✅ CORS support for web applications
- ✅ Health check endpoint

## API Endpoints

### Create Payment
```
POST /api/payments/create
```

**Request Body:**
```json
{
  "amount": 100.00,
  "email": "customer@example.com",
  "phone": "+212600000000",
  "name": "John Doe",
  "description": "Payment for services"
}
```

**Response:**
```json
{
  "success": true,
  "transactionId": "TXN_1234567890_abc123",
  "paymentForm": "<form>...</form>"
}
```

### Payment Callback
```
POST /api/payments/callback
```
*This endpoint is called by CMI after payment processing*

### Get Transaction Status
```
GET /api/payments/status/:transactionId
```

**Response:**
```json
{
  "transactionId": "TXN_1234567890_abc123",
  "status": "completed",
  "amount": 100.00,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "completedAt": "2024-01-01T00:05:00.000Z"
}
```

### Health Check
```
GET /health
```

## Environment Variables

Copy `.env.example` to `.env` and configure the following variables:

- `CMI_STORE_KEY`: Your CMI store key
- `CMI_CLIENT_ID`: Your CMI client ID
- `SHOP_URL`: Your application URL
- `OK_URL`: Success page URL
- `FAIL_URL`: Failure page URL
- `CALLBACK_URL`: Callback endpoint URL
- `BUBBLE_ENDPOINT_URL`: Your Bubble.io webhook endpoint
- `BUBBLE_API_KEY`: Your Bubble.io API key (if required)
- `PORT`: Server port (default: 3000)

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your actual values
```

3. Start the development server:
```bash
npm run dev
```

4. Start the production server:
```bash
npm start
```

## Deployment

### Vercel

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel
```

3. Set environment variables in Vercel dashboard or via CLI:
```bash
vercel env add CMI_STORE_KEY
vercel env add CMI_CLIENT_ID
# ... add all other environment variables
```

### Manual Deployment

1. Build the project:
```bash
npm install --production
```

2. Start the server:
```bash
npm start
```

## Security Features

- ✅ Hash verification for all CMI callbacks
- ✅ Secure environment variable handling
- ✅ Input validation
- ✅ Error handling and logging

## Transaction Statuses

- `pending`: Payment created, waiting for processing
- `completed`: Payment successful
- `failed`: Payment failed or rejected

## Bubble.io Integration

The API automatically notifies your Bubble.io application when:
- Payment is successful
- Payment fails
- Security verification fails

## License

MIT

## Support

For issues and questions, please contact the development team.
