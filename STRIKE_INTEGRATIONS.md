# LimitLeague — Strike Integrations

## Primary integration surface
Strike Finance Perpetuals API and public data endpoints.

## Base URLs
- Production API: `https://api.strikefinance.org`
- Testnet API: `https://api-v2-testnet.strikefinance.org`
- Docs: [https://docs.strikefinance.org](https://docs.strikefinance.org)
- llms.txt: [https://docs.strikefinance.org/llms.txt](https://docs.strikefinance.org/llms.txt)

## Authentication
API Wallet (Ed25519).  
Docs: [https://docs.strikefinance.org/api/getting-started](https://docs.strikefinance.org/api/getting-started)

Required headers for authenticated requests:
- `X-API-Wallet-Public-Key`
- `X-API-Wallet-Signature`
- `X-API-Wallet-Timestamp`
- `X-API-Wallet-Nonce`

API wallets can trade but cannot withdraw.

## Key endpoints used or relevant
- Copy trader discovery: `GET /v2/copy/discover`  
  Docs: [https://docs.strikefinance.org/api/copy-trading/copy-trader-discovery-public](https://docs.strikefinance.org/api/copy-trading/copy-trader-discovery-public)
- Copy trading public: [https://docs.strikefinance.org/api/copy-trading/copy-trading-public](https://docs.strikefinance.org/api/copy-trading/copy-trading-public)
- Copy trading authenticated: [https://docs.strikefinance.org/api/copy-trading/copy-trading-authenticated](https://docs.strikefinance.org/api/copy-trading/copy-trading-authenticated)
- Portfolio / positions / history (public selector supported on many endpoints)
- Order placement (authenticated)

## Skills
Install Strike agent skills:
```bash
npx strike-finance-skills install
