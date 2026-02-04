import { createPublicClient, erc20Abi, formatUnits, http, parseUnits } from "viem";
import browser from "webextension-polyfill";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

export type WalletStatus = {
  hasWallet: boolean;
  address: string | null;
  createdAt: number | null;
  chainId: number;
};

type WalletRecord = {
  privateKey: `0x${string}`;
  address: `0x${string}`;
  createdAt: number;
  chainId: number;
};

const STORAGE_KEY = "veyrun_wallet";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const loadRecord = async (): Promise<WalletRecord | null> => {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result?.[STORAGE_KEY] as WalletRecord) ?? null;
};

const saveRecord = async (record: WalletRecord) => {
  await browser.storage.local.set({ [STORAGE_KEY]: record });
};

export const ensureWallet = async () => {
  const record = await loadRecord();
  if (record) return record;
  return createWallet();
};

export const getStatus = async (): Promise<WalletStatus> => {
  const record = await loadRecord();
  return {
    hasWallet: Boolean(record),
    address: record?.address ?? null,
    createdAt: record?.createdAt ?? null,
    chainId: record?.chainId ?? baseSepolia.id
  };
};

export const getPrivateKey = async () => {
  const record = await loadRecord();
  return record?.privateKey ?? null;
};

export const getAccount = async () => {
  const record = await loadRecord();
  if (!record) return null;
  return privateKeyToAccount(record.privateKey);
};

export const createWallet = async () => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const record: WalletRecord = {
    privateKey,
    address: account.address,
    createdAt: Date.now(),
    chainId: baseSepolia.id
  };
  await saveRecord(record);
  return record;
};

export const importWallet = async (privateKey: string) => {
  if (!privateKey.startsWith("0x") || privateKey.length !== 66) {
    throw new Error("Private key must be a 32-byte hex string.");
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const record: WalletRecord = {
    privateKey: privateKey as `0x${string}`,
    address: account.address,
    createdAt: Date.now(),
    chainId: baseSepolia.id
  };
  await saveRecord(record);
  return record;
};

export const signPayload = async (payload: string) => {
  const record = await loadRecord();
  if (!record) {
    throw new Error("No wallet found.");
  }
  const account = privateKeyToAccount(record.privateKey);
  return account.signMessage({ message: payload });
};

export const getChain = async () => {
  return {
    id: baseSepolia.id,
    name: baseSepolia.name,
    rpcUrl: "https://sepolia.base.org"
  };
};

export const getUsdcBalance = async (address: string) => {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http("https://sepolia.base.org")
  });

  const [decimals, balance] = await Promise.all([
    client.readContract({
      address: USDC_BASE_SEPOLIA,
      abi: erc20Abi,
      functionName: "decimals"
    }),
    client.readContract({
      address: USDC_BASE_SEPOLIA,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as `0x${string}`]
    })
  ]);

  return formatUnits(balance, decimals);
};

export const buildUsdcTransfer = (amount: string) => {
  return parseUnits(amount, 6);
};

export const getUsdcAddress = () => USDC_BASE_SEPOLIA;
