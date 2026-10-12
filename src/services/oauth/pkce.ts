import * as Crypto from 'expo-crypto';
import { base64ToBase64Url, bytesToBase64Url } from '../http';

export interface PkcePair {
  verifier: string;
  challenge: string;
  state: string;
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = bytesToBase64Url(Crypto.getRandomBytes(32));
  const state = bytesToBase64Url(Crypto.getRandomBytes(24));
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return { verifier, challenge: base64ToBase64Url(digest), state };
}
