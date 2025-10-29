# x402 Any-Asset Routing (AAR) — Demo Repo

A tiny, GitHub-ready starter showing how to integrate **x402** with the **Any-Asset Routing (AAR)** extension.
It includes:
- A minimal **Express** server that returns **HTTP 402** with an x402 offer + AAR hints
- A **verifier stub** that checks AAR binding fields on the retry
- **JSON Schemas** for RouteRequest, RouteQuote, and ReceiptBinding (v0.1, draft)
- QuickStart with `curl` to see the full 402 → pay (simulated) → verify → 200 flow

> For the full v0.1 design doc/spec, see: [`x402-any-asset-routing.md`](./x402-any-asset-routing.md).

---

## ✨ What this shows
- How to emit `X-402-OFFER` and `X-402-AAR-OFFER` headers (base64url JSON)
- How a client would retry with `X-402-PAYMENT` including an **AAR receipt binding**
- Where a merchant would verify fields like `offerId`, `quoteId`, `asset`, `amountOut`, `payTo`, etc.

> On-chain settlement verification is mocked. You can replace the verifier with your chain client or a facilitator callback.

---

## 🧱 Project Structure
```
x402-aar-demo/
  ├─ server/
  │   ├─ index.js              # Express server (402 + AAR offer, then verify on retry)
  │   └─ package.json
  ├─ verifier/
  │   └─ index.js              # Minimal AAR receipt verifier stub
  ├─ schemas/
  │   ├─ RouteRequest.json
  │   ├─ RouteQuote.json
  │   └─ ReceiptBinding.json
  └─ x402-any-asset-routing.md # The full spec/design (from previous step)
```

---

## 🚀 QuickStart

### 1) Install & run
```bash
cd server
npm install
npm start
```

Server starts on http://127.0.0.1:8787

### 2) Request a protected resource (expect 402)
```bash
curl -i http://127.0.0.1:8787/resource
```

You should see `HTTP/1.1 402 Payment Required` plus:
- `X-402-OFFER`
- `X-402-AAR-OFFER`

### 3) Simulate a payment + retry (mocked)
Copy the `X-402-AAR-OFFER` base64 payload and note the `offerId` and `acceptedAssets` (the server also prints these to the console).  
Now send a retry with a **mock** `X-402-PAYMENT` header that embeds AAR receipt fields:

```bash
curl -i http://127.0.0.1:8787/resource   -H 'X-402-PAYMENT: eyJyZWNlaXB0Ijp7InR5cGUiOiJ4NDAyLWFhci92MC4xIiwib2ZmZXJJZCI6IjB4YWJjMTIzIiwicXVvdGVJZCI6IjB4ZGVmNDU2IiwiY2hhaW4iOiJiYXNlIiwiYXNzZXQiOiIweGFjY2VwdGVkX2Fzc2V0IiwiYW1vdW50T3V0IjoiMjUwMCIsInBheVRvIjoiMHhNRVJDSEFOVCIsInR4SGFzaCI6IjB4VEVTVFRIQVNIIiwiYmxvY2tOdW1iZXIiOjEyMzQ1NiwicGF5ZXIiOiIweEJ1eWVyIn19'
```

> The payload above is intentionally fake & compact. The server only checks that fields exist and match the (mock) offer; it does **not** hit a chain.

If all fields pass, you’ll get `200 OK` with a small JSON body. If not, you’ll get `402` again with `X-402-AAR-ERROR` indicating what failed.

---

## 🔧 Swap in a real verifier
- Replace `verifier/index.js` with logic that checks a real on-chain transfer or a facilitator’s signed receipt.  
- Typical checks:
  - `asset` and `amountOut` match logs
  - `payTo` correct (merchant or splitter)
  - `quoteId` emitted by the facilitator
  - `deadlineTs` not expired; slippage bounds respected

---

## 📄 License
Apache-2.0
