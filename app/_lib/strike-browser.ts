export const STRIKE_API = "https://api.strikefinance.org";

const hexBytes = (value: string) => {
  const pairs = value.match(/.{1,2}/g);
  if (!pairs) throw new Error("That key does not look right.");
  return new Uint8Array(pairs.map((pair) => Number.parseInt(pair, 16)));
};
const bytesHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Turns the pasted trading key into a signing key that cannot be read back out of the browser. */
export async function importStrikeKey(publicKey: string, privateKey: string) {
  const normalizedPublic = publicKey.trim().toLowerCase();
  const normalizedPrivate = privateKey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedPublic) || !/^(?:[0-9a-f]{64}|[0-9a-f]{128})$/.test(normalizedPrivate))
    throw new Error("Paste both keys exactly as Strike shows them.");
  const prefix = hexBytes("302e020100300506032b657004220420");
  const seed = hexBytes(normalizedPrivate.slice(0, 64));
  const pkcs8 = new Uint8Array(prefix.length + seed.length);
  pkcs8.set(prefix);
  pkcs8.set(seed, prefix.length);
  const signingKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
  return { publicKey: normalizedPublic, signingKey };
}

export async function strikeHeaders(publicKey: string, signingKey: CryptoKey, method: string, path: string, body = "") {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const bodyHash = bytesHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  const message = `${method}:${path}:${timestamp}:${nonce}:${bodyHash}`;
  const signature = bytesHex(await crypto.subtle.sign("Ed25519", signingKey, new TextEncoder().encode(message)));
  return {
    "X-API-Wallet-Public-Key": publicKey,
    "X-API-Wallet-Signature": signature,
    "X-API-Wallet-Timestamp": String(timestamp),
    "X-API-Wallet-Nonce": nonce,
  };
}
