# x402 Any‑Asset Routing (AAR) — v0.1 Design Document

## 0. Abstract

x402 enables pay‑per‑request over HTTP via the `402 Payment Required` status code. Today, merchants usually price their offers in a single asset (e.g., USDC on Base). Buyers, however, often hold _other_ assets. **Any‑Asset Routing (AAR)** is a minimal, composable extension that lets a buyer **“pay with what they have”** while the protocol **deterministically routes and settles** to the merchant’s desired asset.

AAR defines a standard handshake between client, facilitator (router), and merchant so that:

- Clients can present a `RouteRequest` describing **what they hold** and the **offer they want to satisfy**.
- Facilitators respond with a signed `RouteQuote` defining **how to convert** the buyer’s asset into the merchant’s accepted asset(s) within explicit constraints (amount, slippage, deadline).
- x402 receipts bind `offerId` + `quoteId` + `amountOut` so merchants can **verify locally** without bespoke integration.
- Optional staking and reputation create incentives for high‑quality routing while preserving permissionless participation.

The result: **higher conversion, lower integration cost**, and a foundation for further protocol‑level features like split payouts, refunds, and streaming‑402.

---

## 1. Goals & Non‑Goals

### 1.1 Goals

- **Universal pay-in:** Allow buyers to satisfy a 402 offer using any asset the facilitator can route, without the merchant needing to support that asset natively.
- **Deterministic verification:** Make it trivial for a merchant to verify an AAR‑assisted payment offline or with a single helper library.
- **Composable:** Work with existing x402 flows (basic, splits, streaming, refunds) without breaking changes.
- **Wallet- & chain-agnostic:** Avoid entangling the spec with any single wallet or chain architecture.

### 1.2 Non‑Goals (v0.1)

- Cross‑domain compliance policy standardization (we only provide hooks).
- Price discovery auctions (see “Dutch‑402” as a separate extension).
- Cross‑L1 bridging specifics (facilitators may support, but out of this spec’s scope).

---

## 2. System Model & Actors

- **Client**: Wants to obtain a resource protected by x402. Holds one or more assets.
- **Merchant**: Serves the resource. Publishes an x402 offer priced in one or more **accepted assets**.
- **Facilitator (Router)**: Provides routes (quotes) to convert the client’s **haveAsset** into a **wantAsset** acceptable to the merchant, then executes settlement.
- **Receipt Verifier**: Logic/library embedded in merchant infra to validate that the settlement matches the `RouteQuote` bound to the x402 `offerId`.

Threat model highlights: MEV/price drift, quote tampering, replay, facilitator dishonesty, partial fill, settlement failure.

---

## 3. Offer Extension (Merchant → Client)

A merchant returns `402 Payment Required` with the standard x402 headers plus **AAR hints**.

**Required new header (compact JSON, base64url encoded):**

- `X-402-AAR-OFFER`

**Decoded JSON fields (v0.1):**

```json
{
  "offerId": "0xabc123...",
  "acceptedAssets": [
    {
      "chain": "base",
      "asset": "0xa0b86991...",
      "symbol": "USDC",
      "decimals": 6
    },
    {
      "chain": "base",
      "asset": "0xyourtoken...",
      "symbol": "YTK",
      "decimals": 18
    }
  ],
  "routeURI": "https://router.example/aar/quote",
  "minSettleWindowMs": 15000,
  "policy": {
    "denyAssets": [],
    "maxSlippageBps": 100,
    "deadlineMs": 30000
  }
}
```

- `offerId`: Merchant’s unique identifier for the price/terms snapshot.
- `acceptedAssets[]`: Assets that settle the offer without routing (baseline x402) **and** target assets for AAR routes.
- `routeURI`: Optional convenience endpoint for `RouteRequest`; clients may use other facilitators.
- `policy`: Soft hints for wallets/clients (can be enforced by merchant during verification).

> **Note:** The canonical x402 pricing and terms continue to live in the normal x402 offer header. AAR only adds routing hints.

---

## 4. Client → Facilitator: `RouteRequest`

The client asks a facilitator for a route to satisfy the offer:

```json
{
  "spec": "x402-aar/v0.1",
  "offerId": "0xabc123...",
  "merchant": {
    "chain": "base",
    "acceptedAssets": [
      { "asset": "0xa0b86991...", "decimals": 6 },
      { "asset": "0xyourtoken...", "decimals": 18 }
    ]
  },
  "have": {
    "chain": "base",
    "asset": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "symbol": "ETH",
    "amountInMax": "1000000000000000"
  },
  "constraints": {
    "minOut": null,
    "maxSlippageBps": 80,
    "deadlineTs": 1730083200
  },
  "payer": "0xBuyerAddress",
  "payTo": "0xMerchantTreasuryOrSplitter",
  "extras": {
    "policyProfileURI": null,
    "nettingWindowId": null
  }
}
```

Key fields:

- `have.amountInMax`: the _maximum_ amount of the payer’s asset they’re willing to spend.
- `constraints.minOut`: optional lower bound (in merchant asset units) for deterministic verification.
- `payTo`: merchant’s settlement address (can be a splitter contract).

---

## 5. Facilitator → Client: `RouteQuote` (Signed)

The facilitator responds with a signed quote the client can execute.

```json
{
  "spec": "x402-aar/v0.1",
  "quoteId": "0xdef456...",
  "offerId": "0xabc123...",
  "route": {
    "chain": "base",
    "path": [{ "asset": "ETH" }, { "asset": "USDC" }],
    "executionData": "0xabcdef...",
    "amountIn": "900000000000000",
    "amountOut": "2500",
    "assetOut": "0xa0b86991...",
    "payTo": "0xMerchantTreasuryOrSplitter"
  },
  "limits": {
    "deadlineTs": 1730083200,
    "maxSlippageBps": 80
  },
  "facilitator": {
    "address": "0xRouter",
    "domain": "router.example",
    "feeBps": 5,
    "feeAsset": "0xa0b86991..."
  },
  "signature": {
    "algo": "eip191",
    "domain": "X402-AAR-QUOTE",
    "messageHash": "0x...",
    "sig": "0x..."
  }
}
```

**Verification invariants (merchant-side):**

- `offerId` matches the current/accepted x402 offer.
- `quoteId` and `amountOut` are bound into the payment receipt.
- `assetOut` ∈ `acceptedAssets`.
- `payTo` is controlled by the merchant (or an approved splitter).
- `deadlineTs` not expired; `maxSlippageBps` within policy.

---

## 6. Settlement & Receipt Binding

After the client executes the route (swap + pay), the x402 **payment receipt** (the header the client sends on retry) MUST embed the AAR binding:

```json
{
  "receipt": {
    "type": "x402-aar/v0.1",
    "offerId": "0xabc123...",
    "quoteId": "0xdef456...",
    "chain": "base",
    "asset": "0xa0b86991...",
    "amountOut": "2500",
    "payTo": "0xMerchantTreasuryOrSplitter",
    "txHash": "0x...",
    "blockNumber": 12345678,
    "settlementProof": "0x...",
    "payer": "0xBuyerAddress"
  }
}
```

The merchant’s verifier checks on‑chain (or via a trusted light client/facilitator) that:

1. `txHash` effects match `asset`, `amountOut`, and `payTo`.
2. Event logs (or calldata) link back to the **facilitator’s quote** (e.g., `quoteId` emitted).
3. `amountOut ≥ constraints.minOut` if provided.
4. `deadlineTs` not violated; slippage within bounds.

---

## 7. Error Codes & Failure Modes

AAR introduces additional standardized error codes for quote and route issues. When a client retries after paying fails, the merchant may return `402` again with one of these in `X-402-AAR-ERROR` (base64url compact JSON).

| Code | Name                   | Description                                               | Client Action                       |
| ---- | ---------------------- | --------------------------------------------------------- | ----------------------------------- |
| `Q1` | `QUOTE_EXPIRED`        | `deadlineTs` passed.                                      | Request a fresh quote.              |
| `Q2` | `QUOTE_MISMATCH`       | `quoteId` unknown or not bound to `offerId`.              | Refresh route with current offer.   |
| `S1` | `SETTLEMENT_UNDERPAID` | `amountOut` below `minOut` or merchant-required amount.   | Increase `amountInMax` / new quote. |
| `S2` | `WRONG_ASSET_OUT`      | Settled asset not in `acceptedAssets`.                    | Use correct route.                  |
| `S3` | `WRONG_PAYTO`          | Funds not sent to merchant’s `payTo`.                     | Re-route to correct address.        |
| `R1` | `REFUND_REQUIRED`      | Merchant indicates refund path (see refunds subprotocol). | Follow refund flow.                 |

---

## 8. Security Considerations

- **MEV / Slippage:** Quotes must include `deadlineTs` & `maxSlippageBps`. Merchants enforce bounds at receipt verification.
- **Replay:** Receipts bind `offerId` + `quoteId`; merchants maintain short‑lived offer windows and idempotency keys.
- **Tampering:** `RouteQuote` is signed; merchants verify signature against known facilitator keys or a staked registry.
- **Phishing:** Wallets should display `payTo`, `assetOut`, `amountOut`, and `deadlineTs` prominently.
- **Partial Fill:** Either disallowed (default) or opt‑in where receipts encode partials plus PoD for delivered bytes.
- **Privacy:** Payer address visible in v0.1; future zk‑receipt mode can hide it while proving constraints.

---

## 9. Economic Model & Token Utility (Optional but Recommended)

Introduce a **protocol token** to align incentives without taxing users excessively:

- **Stake‑to‑Route:** Facilitators post stake; misbehavior (invalid quotes, failed execution) can be slashed via watcher proofs.
- **Fee Rebates:** A share of routing fees is rebated to stakers and power users (tiered by stake/usage).
- **Grants & Fee Switch:** A small protocol fee (bps) funds audits, reference clients, and grants; optionally partial burns.
- **Reputation:** Route success rate, speed, and slashing history roll into a public score merchants can filter on.

---

## 10. Reference Flows

### 10.1 Happy Path (ETH → USDC on Base)

1. Client requests resource → Merchant returns `402 + AAR-OFFER`.
2. Client sends `RouteRequest` (ETH → USDC) to facilitator.
3. Facilitator returns signed `RouteQuote` (amountIn, amountOut, deadline).
4. Client executes the route (DEX swap) and transfers `amountOut` USDC to `payTo`, emitting `quoteId`.
5. Client retries GET with `X-402-PAYMENT` including AAR receipt.
6. Merchant verifies receipt and returns `200 OK` with content.

### 10.2 Quote Expiry

- Steps 1–3 as above; client delays; `deadlineTs` passes.
- Merchant rejects with `Q1 QUOTE_EXPIRED`. Client re‑quotes and retries.

---

## 11. Minimal Schemas (JSON Schema Draft‑07)

**RouteRequest**

```json
{
  "$id": "https://spec.x402.dev/aar/v0.1/RouteRequest.json",
  "type": "object",
  "required": ["spec", "offerId", "have", "payTo"],
  "properties": {
    "spec": { "const": "x402-aar/v0.1" },
    "offerId": { "type": "string" },
    "merchant": { "type": "object" },
    "have": {
      "type": "object",
      "required": ["chain", "asset", "amountInMax"],
      "properties": {
        "chain": { "type": "string" },
        "asset": { "type": "string" },
        "amountInMax": { "type": "string" }
      }
    },
    "constraints": { "type": "object" },
    "payer": { "type": "string" },
    "payTo": { "type": "string" },
    "extras": { "type": "object" }
  }
}
```

**RouteQuote**

```json
{
  "$id": "https://spec.x402.dev/aar/v0.1/RouteQuote.json",
  "type": "object",
  "required": [
    "spec",
    "quoteId",
    "offerId",
    "route",
    "limits",
    "facilitator",
    "signature"
  ],
  "properties": {
    "spec": { "const": "x402-aar/v0.1" },
    "quoteId": { "type": "string" },
    "offerId": { "type": "string" },
    "route": {
      "type": "object",
      "required": ["chain", "amountIn", "amountOut", "assetOut", "payTo"],
      "properties": {
        "chain": { "type": "string" },
        "path": { "type": "array" },
        "executionData": { "type": "string" },
        "amountIn": { "type": "string" },
        "amountOut": { "type": "string" },
        "assetOut": { "type": "string" },
        "payTo": { "type": "string" }
      }
    },
    "limits": { "type": "object" },
    "facilitator": { "type": "object" },
    "signature": { "type": "object" }
  }
}
```

**AAR Receipt Binding (embedded in x402 payment header)**

```json
{
  "$id": "https://spec.x402.dev/aar/v0.1/ReceiptBinding.json",
  "type": "object",
  "required": [
    "type",
    "offerId",
    "quoteId",
    "chain",
    "asset",
    "amountOut",
    "payTo",
    "txHash"
  ],
  "properties": {
    "type": { "const": "x402-aar/v0.1" },
    "offerId": { "type": "string" },
    "quoteId": { "type": "string" },
    "chain": { "type": "string" },
    "asset": { "type": "string" },
    "amountOut": { "type": "string" },
    "payTo": { "type": "string" },
    "txHash": { "type": "string" },
    "blockNumber": { "type": "integer" },
    "settlementProof": { "type": "string" },
    "payer": { "type": "string" }
  }
}
```

---

## 12. Integration with x402 Headers

- **Offer:** Add `X-402-AAR-OFFER` (base64url JSON) alongside the standard x402 pricing header.
- **Payment Retry:** `X-402-PAYMENT` carries the normal receipt envelope; include the AAR receipt binding under `receipt`.
- **Errors:** `X-402-AAR-ERROR` when AAR‑specific validation fails.

**Example (illustrative):**

```http
HTTP/1.1 402 Payment Required
X-402-OFFER: <base64url(x402-offer-json)>
X-402-AAR-OFFER: <base64url(aar-offer-json)>
Content-Type: application/json
```

Client retry with payment:

```http
GET /resource
X-402-PAYMENT: <base64url({
  "receipt": { ... AAR binding ... },
  "signature": "0x..."
})>
```

---

## 13. Reference Components (Open‑Source Targets)

- **Facilitator Router:** Single‑chain (Base) first, Uniswap‑style paths, signed quotes, REST + EIP‑191 signatures.
- **Merchant Verifier Lib:** Node/TS + Rust versions; validates quotes, assets, receipts, and on‑chain events.
- **Wallet Shim:** Auto‑detect `X-402-AAR-OFFER`, fetch quote, construct the transaction bundle, then retry with receipt.
- **Sim Test Harness:** Deterministic scenarios (expiry, underpay, wrong asset) for CI.

---

## 14. Roadmap

- **v0.1 (this doc):** JSON schemas, headers, happy‑path reference, error codes.
- **v0.2:** Multi‑quote best‑of selection, netting windows, PoD hook, partial‑fill streaming option.
- **v0.3:** Staked facilitator registry, zk‑receipt mode, cross‑chain routes.
- **v1.0:** Finalized EIP(s) for quote signature domain and receipt verification interface.

---

## 15. FAQ

**Q: Why not just accept USDC only?**  
A: You should—but buyers often don’t have it at hand. AAR removes conversion friction without bespoke per‑merchant logic.

**Q: What if the facilitator lies?**  
A: Merchants only trust _verifiable outcomes_—the receipt + on‑chain settlement. Staking/slashing and reputation are added incentives.

**Q: Does AAR require changes to existing x402 servers?**  
A: Minimal: add the AAR offer header, verify the AAR fields inside the receipt, and enforce policy bounds.

**Q: How does this relate to split payouts?**  
A: Orthogonal. AAR decides **how** to arrive at the merchant asset. Split payouts decide **who** gets paid once the asset arrives.

---

## 16. License

This specification is offered under the **Apache‑2.0** license unless otherwise stated.
