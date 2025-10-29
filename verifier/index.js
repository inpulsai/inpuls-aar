// verifier/index.js
// Minimal AAR receipt verifier (stub). Replace with chain checks or facilitator verification.
function base64urlDecode(b64u) {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const pad = '==='.slice((b64.length + 3) % 4);
  return Buffer.from(b64 + pad, 'base64').toString('utf8');
}

function parsePaymentHeader(headerValue) {
  try {
    const json = JSON.parse(base64urlDecode(headerValue));
    return json;
  } catch (e) {
    return null;
  }
}

/**
 * verifyAARReceipt
 * @param {object} opts
 * @param {string} opts.paymentHeader - base64url JSON from X-402-PAYMENT
 * @param {object} opts.offer - decoded AAR offer JSON sent in X-402-AAR-OFFER
 * @returns {{ok: boolean, reason?: string}}
 */
function verifyAARReceipt({ paymentHeader, offer }) {
  const parsed = parsePaymentHeader(paymentHeader);
  if (!parsed) return { ok: false, reason: 'INVALID_PAYMENT_HEADER_JSON' };
  const rcpt = parsed.receipt;
  if (!rcpt) return { ok: false, reason: 'MISSING_RECEIPT' };

  // Basic field checks
  const required = ['type','offerId','quoteId','chain','asset','amountOut','payTo','txHash'];
  for (const k of required) {
    if (rcpt[k] == null) return { ok: false, reason: 'MISSING_' + k.toUpperCase() };
  }
  if (rcpt.type !== 'x402-aar/v0.1') return { ok: false, reason: 'BAD_TYPE' };

  // Offer binding
  if (offer.offerId && rcpt.offerId !== offer.offerId) {
    return { ok: false, reason: 'OFFER_ID_MISMATCH' };
  }

  // Accepted asset check
  const accepted = new Set((offer.acceptedAssets || []).map(a => (a.asset || '').toLowerCase()));
  if (accepted.size && !accepted.has((rcpt.asset || '').toLowerCase())) {
    return { ok: false, reason: 'WRONG_ASSET_OUT' };
  }

  // AmountOut sanity
  if (String(rcpt.amountOut).match(/[^0-9]/)) {
    return { ok: false, reason: 'BAD_AMOUNT_OUT' };
  }

  // payTo check (optional due to demo)
  if (offer.payTo && rcpt.payTo && (rcpt.payTo.toLowerCase() !== offer.payTo.toLowerCase())) {
    // Uncomment to enforce:
    // return { ok: false, reason: 'WRONG_PAYTO' };
  }

  // NOTE: Real implementation would:
  // 1) Fetch tx by rcpt.txHash on rcpt.chain
  // 2) Confirm transfer logs: asset -> payTo, amountOut
  // 3) Confirm facilitator quoteId emitted (if using a router contract)
  // 4) Enforce deadline/slippage bounds

  return { ok: true };
}

module.exports = { verifyAARReceipt, parsePaymentHeader, base64urlDecode };
