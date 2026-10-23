import { TradeProposal } from "@/lib/types";

type StrikeExecutionConfig = {
  baseUrl: string;
  publicKey: string;
  sign: (payload: string) => Promise<string>;
};

/** The only module permitted to forward an already-allowed proposal to Strike. */
export async function submitAllowedOrder(proposal: TradeProposal, config: StrikeExecutionConfig) {
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const body = JSON.stringify({ market: proposal.market, side: proposal.side, notionalUsd: proposal.notionalUsd, clientOrderId: nonce });
  const signature = await config.sign([timestamp, nonce, body].join("."));
  const response = await fetch(new URL("/v2/orders", config.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-Wallet-Public-Key": config.publicKey, "X-API-Wallet-Signature": signature, "X-API-Wallet-Timestamp": timestamp, "X-API-Wallet-Nonce": nonce },
    body
  });
  if (!response.ok) throw new Error("Strike order rejected: " + response.status);
  return response.json();
}
