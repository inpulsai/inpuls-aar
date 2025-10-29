// server/index.js
const express = require('express');
const { verifyAARReceipt } = require('../verifier/index.js');

const app = express();
const PORT = 8787;

// Demo merchant config (mock)
const offerId = '0xabc123';
const aarOffer = {
  offerId,
  acceptedAssets: [
    { chain: 'base', asset: '0xaccepted_asset', symbol: 'USDC', decimals: 6 },
    { chain: 'base', asset: '0xyourtoken', symbol: 'YTK', decimals: 18 }
  ],
  routeURI: 'https://router.example/aar/quote',
  minSettleWindowMs: 15000,
  policy: { denyAssets: [], maxSlippageBps: 100, deadlineMs: 30000 },
  // Optional: merchant treasury (for verifier hint)
  payTo: '0xMERCHANT'
};

function b64url(obj) {
  const json = JSON.stringify(obj);
  return Buffer.from(json).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

app.get('/resource', (req, res) => {
  const paymentHeader = req.header('X-402-PAYMENT');

  if (paymentHeader) {
    const { ok, reason } = verifyAARReceipt({ paymentHeader, offer: aarOffer });
    if (ok) {
      return res.status(200).json({
        ok: true,
        message: 'Payment verified (mock). Delivering resource.',
        offerId
      });
    }
    res.setHeader('X-402-AAR-ERROR', b64url({ code: 'VERIFY_FAIL', reason }));
    return res.status(402).json({ ok: false, error: 'Payment verification failed', reason });
  }

  // No payment: return 402 with standard and AAR headers
  const standardOffer = {
    offerId,
    description: 'Demo resource pay-per-request',
    amount: '2500',
    asset: '0xaccepted_asset',
    chain: 'base',
    payTo: '0xMERCHANT',
    nonce: Date.now()
  };
  const aarHeader = aarOffer;

  console.log('[x402] Returning 402 with offerId=%s', offerId);
  console.log('[x402] AAR acceptedAssets:', aarHeader.acceptedAssets);

  res.setHeader('X-402-OFFER', b64url(standardOffer));
  res.setHeader('X-402-AAR-OFFER', b64url(aarHeader));
  return res.status(402).json({
    ok: false,
    message: 'Payment Required. Use x402 AAR flow.',
    offerId
  });
});

app.listen(PORT, () => {
  console.log(`x402 AAR demo server listening on http://127.0.0.1:${PORT}`);
});
