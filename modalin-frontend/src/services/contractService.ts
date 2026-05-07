import { ethers, BrowserProvider, Contract, JsonRpcSigner } from "ethers";

import contractAddresses from "../abis/contract-addresses.json";
import SoulboundTokenABI   from "../abis/SoulboundToken.json";
import GuildSBTABI         from "../abis/GuildSBT.json";
import VouchRegistryABI    from "../abis/VouchRegistry.json";
import ReputationEngineABI from "../abis/ReputationEngine.json";
import InterestRateModelABI from "../abis/InterestRateModel.json";
import LoanEscrowABI       from "../abis/LoanEscrow.json";

// ─────────────────────────────────────────────────────────────
// TYPES (derived from actual contract ABIs)
// ─────────────────────────────────────────────────────────────

export interface CreditProfile {
  tokenId:             bigint;
  reputationScore:     bigint;
  totalLoansBorrowed:  bigint;
  totalLoansRepaid:    bigint;
  totalAmountBorrowed: bigint;
  totalAmountRepaid:   bigint;
  lastUpdated:         bigint;
  isActive:            boolean;
}

export interface CreditGroup {
  groupId:              bigint;
  name:                 string;
  members:              string[];
  collectiveScore:      bigint;
  tier:                 number;   // 0=Bronze, 1=Silver, 2=Gold
  totalGroupLoans:      bigint;
  totalGroupRepayments: bigint;
  createdAt:            bigint;
  lastUpdated:          bigint;
  isActive:             boolean;
}

export interface Loan {
  loanId:        bigint;
  borrower:      string;
  principal:     bigint;
  interestAmount:bigint;
  totalDue:      bigint;
  aprBasisPoints:bigint;
  durationDays:  bigint;
  fundedAt:      bigint;
  dueDate:       bigint;
  amountRepaid:  bigint;
  status:        number; // 0=Pending, 1=Active, 2=Repaid, 3=Defaulted
}

export interface LenderContribution {
  lender:    string;
  amount:    bigint;
  loanId:    bigint;
  withdrawn: boolean;
}

export interface CompositeScore {
  paymentScore:   bigint;
  vouchScore:     bigint;
  attestScore:    bigint;
  compositeScore: bigint;
}

export interface APRBreakdown {
  base:               bigint;
  groupPremium:       bigint;
  reputationDiscount: bigint;
  finalAPR:           bigint;
}

export const LOAN_STATUS: Record<number, string> = {
  0: "Pending",
  1: "Active",
  2: "Repaid",
  3: "Defaulted",
};

export const GUILD_TIER: Record<number, string> = {
  0: "Bronze",
  1: "Silver",
  2: "Gold",
};

const HARDHAT_CHAIN_ID     = 31337;
const HARDHAT_CHAIN_ID_HEX = "0x7A69";

// ─────────────────────────────────────────────────────────────
// WALLET
// ─────────────────────────────────────────────────────────────

function getProvider(): BrowserProvider {
  if (!window.ethereum) throw new Error("MetaMask tidak ditemukan!");
  return new BrowserProvider(window.ethereum);
}

export async function connectWallet(): Promise<{
  address: string;
  balance: string;
  chainId: number;
}> {
  const provider = getProvider();

  const network = await provider.getNetwork();
  if (Number(network.chainId) !== HARDHAT_CHAIN_ID) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: HARDHAT_CHAIN_ID_HEX }],
      });
    } catch (err: any) {
      if (err.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: HARDHAT_CHAIN_ID_HEX,
            chainName: "Hardhat Local",
            rpcUrls: ["http://127.0.0.1:8545"],
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          }],
        });
      } else throw err;
    }
  }

  await provider.send("eth_requestAccounts", []);
  const signer  = await provider.getSigner();
  const address = await signer.getAddress();
  const balance = ethers.formatEther(await provider.getBalance(address));
  const chainId = Number((await provider.getNetwork()).chainId);

  return { address, balance, chainId };
}

async function getSigner(): Promise<JsonRpcSigner> {
  const provider = getProvider();
  await provider.send("eth_requestAccounts", []);
  return provider.getSigner();
}

export async function getWalletBalance(address: string): Promise<string> {
  const provider = getProvider();
  return ethers.formatEther(await provider.getBalance(address));
}

// ─────────────────────────────────────────────────────────────
// CONTRACT INSTANCES
// ─────────────────────────────────────────────────────────────

async function getSoulboundToken()    { return new Contract(contractAddresses.SoulboundToken,    SoulboundTokenABI,    await getSigner()); }
async function getGuildSBT()          { return new Contract(contractAddresses.GuildSBT,          GuildSBTABI,          await getSigner()); }
async function getVouchRegistry()     { return new Contract(contractAddresses.VouchRegistry,     VouchRegistryABI,     await getSigner()); }
async function getReputationEngine()  { return new Contract(contractAddresses.ReputationEngine,  ReputationEngineABI,  await getSigner()); }
async function getInterestRateModel() { return new Contract(contractAddresses.InterestRateModel, InterestRateModelABI, await getSigner()); }
async function getLoanEscrow()        { return new Contract(contractAddresses.LoanEscrow,        LoanEscrowABI,        await getSigner()); }

// ─────────────────────────────────────────────────────────────
// SOULBOUND TOKEN
// ─────────────────────────────────────────────────────────────

/** Cek apakah address sudah punya SBT */
export async function hasSBT(address: string): Promise<boolean> {
  const contract = await getSoulboundToken();
  return contract.hasSBT(address);
}

/** Issue SBT ke address (hanya authorized updater) */
export async function issueSBT(to: string): Promise<ethers.ContractTransactionReceipt> {
  const contract = await getSoulboundToken();
  const tx = await contract.issueSBT(to);
  return tx.wait();
}

/** Ambil profil kredit lengkap milik address */
export async function getCreditProfile(address: string): Promise<CreditProfile> {
  const contract = await getSoulboundToken();
  return contract.getProfile(address);
}

/** Ambil skor reputasi address (angka 0–1000) */
export async function getReputationScore(address: string): Promise<bigint> {
  const contract = await getSoulboundToken();
  return contract.getReputationScore(address);
}

/** Ambil repayment rate address (persentase 0–100) */
export async function getRepaymentRate(address: string): Promise<bigint> {
  const contract = await getSoulboundToken();
  return contract.getRepaymentRate(address);
}

// ─────────────────────────────────────────────────────────────
// GUILD SBT (Kelompok Kredit)
// ─────────────────────────────────────────────────────────────

/** Buat kelompok kredit baru */
export async function createGroup(name: string): Promise<ethers.ContractTransactionReceipt> {
  const contract = await getGuildSBT();
  const tx = await contract.createGroup(name);
  return tx.wait();
}

/** Bergabung ke kelompok berdasarkan ID */
export async function joinGroup(groupId: number): Promise<ethers.ContractTransactionReceipt> {
  const contract = await getGuildSBT();
  const tx = await contract.joinGroup(groupId);
  return tx.wait();
}

/** Ambil info kelompok berdasarkan ID */
export async function getGroup(groupId: number): Promise<CreditGroup> {
  const contract = await getGuildSBT();
  return contract.getGroup(groupId);
}

/** Ambil info kelompok berdasarkan alamat anggota */
export async function getGroupByMember(memberAddress: string): Promise<CreditGroup> {
  const contract = await getGuildSBT();
  return contract.getGroupByMember(memberAddress);
}

/** Ambil daftar anggota kelompok */
export async function getGroupMembers(groupId: number): Promise<string[]> {
  const contract = await getGuildSBT();
  return contract.getGroupMembers(groupId);
}

/** Ambil skor kolektif kelompok */
export async function getGroupScore(groupId: number): Promise<bigint> {
  const contract = await getGuildSBT();
  return contract.getGroupScore(groupId);
}

/** Ambil tier kelompok (0=Bronze, 1=Silver, 2=Gold) */
export async function getGroupTier(groupId: number): Promise<number> {
  const contract = await getGuildSBT();
  return contract.getGroupTier(groupId);
}

/** Cek apakah address adalah anggota kelompok */
export async function isGroupMember(address: string): Promise<boolean> {
  const contract = await getGuildSBT();
  return contract.isGroupMember(address);
}

// ─────────────────────────────────────────────────────────────
// VOUCH REGISTRY (Jaminan Sosial)
// ─────────────────────────────────────────────────────────────

/**
 * Vouch untuk borrower dengan stake ETH
 * @param borrower   - Alamat yang dijamin
 * @param voucherScore - Skor yang diberikan voucher (0–100)
 * @param stakeEth   - Jumlah ETH yang di-stake sebagai jaminan (misal "0.01")
 */
export async function vouch(
  borrower: string,
  voucherScore: number,
  stakeEth: string
): Promise<ethers.ContractTransactionReceipt> {
  const contract = await getVouchRegistry();
  const tx = await contract.vouch(borrower, voucherScore, {
    value: ethers.parseEther(stakeEth),
  });
  return tx.wait();
}

/** Cabut vouch untuk borrower tertentu */
export async function revokeVouch(borrower: string): Promise<ethers.ContractTransactionReceipt> {
  const contract = await getVouchRegistry();
  const tx = await contract.revokeVouch(borrower);
  return tx.wait();
}

/** Ambil vouch score total untuk borrower */
export async function getVouchScore(borrower: string): Promise<bigint> {
  const contract = await getVouchRegistry();
  return contract.getVouchScore(borrower);
}

/** Ambil jumlah vouch aktif untuk borrower */
export async function getActiveVouchCount(borrower: string): Promise<bigint> {
  const contract = await getVouchRegistry();
  return contract.getActiveVouchCount(borrower);
}

// ─────────────────────────────────────────────────────────────
// REPUTATION ENGINE
// ─────────────────────────────────────────────────────────────

/** Ambil composite score dari semua komponen */
export async function getCompositeScore(address: string): Promise<CompositeScore> {
  const contract = await getReputationEngine();
  const [paymentScore, vouchScore, attestScore, compositeScore] =
    await contract.getCompositeScore(address);
  return { paymentScore, vouchScore, attestScore, compositeScore };
}

/** Trigger recalculate score on-chain */
export async function recalculateScore(address: string): Promise<ethers.ContractTransactionReceipt> {
  const contract = await getReputationEngine();
  const tx = await contract.recalculateScore(address);
  return tx.wait();
}

// ─────────────────────────────────────────────────────────────
// INTEREST RATE MODEL
// ─────────────────────────────────────────────────────────────

/** Hitung APR untuk borrower (dalam basis points, misal 1000 = 10%) */
export async function calculateAPR(borrower: string): Promise<bigint> {
  const contract = await getInterestRateModel();
  return contract.calculateAPR(borrower);
}

/**
 * Hitung bunga untuk pinjaman tertentu
 * @param borrower     - Alamat peminjam
 * @param principalWei - Jumlah pinjaman dalam wei
 * @param durationDays - Durasi pinjaman dalam hari
 */
export async function calculateInterest(
  borrower: string,
  principalWei: bigint,
  durationDays: number
): Promise<bigint> {
  const contract = await getInterestRateModel();
  return contract.calculateInterest(borrower, principalWei, durationDays);
}

/** Ambil rincian APR (base + premium - discount = final) */
export async function getAPRBreakdown(borrower: string): Promise<APRBreakdown> {
  const contract = await getInterestRateModel();
  const [base, groupPremium, reputationDiscount, finalAPR] =
    await contract.getAPRBreakdown(borrower);
  return { base, groupPremium, reputationDiscount, finalAPR };
}

// ─────────────────────────────────────────────────────────────
// LOAN ESCROW (Pinjaman)
// ─────────────────────────────────────────────────────────────

/**
 * Ajukan pinjaman baru
 * @param principalEth - Jumlah pinjaman dalam ETH (misal "0.5")
 * @param durationDays - Durasi pinjaman dalam hari (misal 30)
 * @returns loanId sebagai bigint
 */
export async function requestLoan(
  principalEth: string,
  durationDays: number
): Promise<{ receipt: ethers.ContractTransactionReceipt; loanId: bigint }> {
  const contract = await getLoanEscrow();
  const principal = ethers.parseEther(principalEth);
  const tx = await contract.requestLoan(principal, durationDays);
  const receipt = await tx.wait();

  // Ambil loanId dari event LoanRequested
  const iface = new ethers.Interface(LoanEscrowABI);
  let loanId = 0n;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "LoanRequested") {
        loanId = parsed.args.loanId;
        break;
      }
    } catch {}
  }
  return { receipt, loanId };
}

/**
 * Dana pinjaman sebagai lender
 * @param loanId    - ID pinjaman yang akan didanai
 * @param amountEth - Jumlah ETH yang ingin didanai
 */
export async function fundLoan(
  loanId: bigint,
  amountEth: string
): Promise<ethers.ContractTransactionReceipt> {
  const contract = await getLoanEscrow();
  const tx = await contract.fundLoan(loanId, {
    value: ethers.parseEther(amountEth),
  });
  return tx.wait();
}

/**
 * Bayar cicilan / lunas pinjaman
 * @param loanId    - ID pinjaman yang dibayar
 * @param amountEth - Jumlah ETH yang dibayar
 */
export async function repayLoan(
  loanId: bigint,
  amountEth: string
): Promise<ethers.ContractTransactionReceipt> {
  const contract = await getLoanEscrow();
  const tx = await contract.repayLoan(loanId, {
    value: ethers.parseEther(amountEth),
  });
  return tx.wait();
}

/** Ambil detail pinjaman berdasarkan ID */
export async function getLoan(loanId: bigint): Promise<Loan> {
  const contract = await getLoanEscrow();
  return contract.getLoan(loanId);
}

/** Ambil semua loan ID milik borrower */
export async function getBorrowerLoans(borrower: string): Promise<bigint[]> {
  const contract = await getLoanEscrow();
  return contract.getBorrowerLoans(borrower);
}

/** Ambil semua kontribusi lender untuk sebuah pinjaman */
export async function getLoanContributions(loanId: bigint): Promise<LenderContribution[]> {
  const contract = await getLoanEscrow();
  return contract.getLoanContributions(loanId);
}

/**
 * Tarik dana lender setelah pinjaman selesai
 * @param loanId            - ID pinjaman
 * @param contributionIndex - Index kontribusi di array loanContributions
 */
export async function withdrawLenderFunds(
  loanId: bigint,
  contributionIndex: number
): Promise<ethers.ContractTransactionReceipt> {
  const contract = await getLoanEscrow();
  const tx = await contract.withdrawLenderFunds(loanId, contributionIndex);
  return tx.wait();
}

/** Tandai pinjaman sebagai default (hanya owner) */
export async function markDefault(loanId: bigint): Promise<ethers.ContractTransactionReceipt> {
  const contract = await getLoanEscrow();
  const tx = await contract.markDefault(loanId);
  return tx.wait();
}

// ─────────────────────────────────────────────────────────────
// HELPERS & FORMATTERS
// ─────────────────────────────────────────────────────────────

/** Konversi bigint wei ke string ETH */
export function weiToEth(wei: bigint): string {
  return ethers.formatEther(wei);
}

/** Konversi string ETH ke bigint wei */
export function ethToWei(eth: string): bigint {
  return ethers.parseEther(eth);
}

/** Konversi basis points ke persentase (1000 bps = 10%) */
export function bpsToPercent(bps: bigint): string {
  return (Number(bps) / 100).toFixed(2) + "%";
}

/** Konversi unix timestamp ke Date */
export function toDate(timestamp: bigint): Date {
  return new Date(Number(timestamp) * 1000);
}

/** Ambil label status pinjaman */
export function getLoanStatusLabel(status: number): string {
  return LOAN_STATUS[status] ?? "Unknown";
}

/** Ambil label tier guild */
export function getGuildTierLabel(tier: number): string {
  return GUILD_TIER[tier] ?? "Unknown";
}

// ─────────────────────────────────────────────────────────────
// WINDOW.ETHEREUM TYPE DECLARATION
// ─────────────────────────────────────────────────────────────

declare global {
  interface Window {
    ethereum?: any;
  }
}