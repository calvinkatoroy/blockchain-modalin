// ─── Loan ─────────────────────────────────────────────────────────────────────

/**
 * Status pinjaman dari kontrak LoanEscrow.
 * Kontrak mengembalikan angka (0–3), label ini untuk keperluan UI.
 */
export type LoanStatus = 'Pending' | 'Active' | 'Repaid' | 'Defaulted';

export const LOAN_STATUS_MAP: Record<number, LoanStatus> = {
  0: 'Pending',
  1: 'Active',
  2: 'Repaid',
  3: 'Defaulted',
};

/**
 * Representasi Loan di frontend.
 * Semua field bigint dari kontrak dikonversi ke string (via formatEther / toString)
 * agar mudah ditampilkan di UI.
 */
export interface Loan {
  loanId:        string;   // bigint → string
  borrower:      string;
  principal:     string;   // ETH string, misal "0.5"
  interestAmount:string;   // ETH string
  totalDue:      string;   // ETH string
  aprBasisPoints:number;   // basis points, misal 1155 = 11.55%
  durationDays:  number;
  fundedAt:      number;   // unix timestamp
  dueDate:       number;   // unix timestamp
  amountRepaid:  string;   // ETH string
  status:        LoanStatus;
  statusCode:    number;   // angka asli dari kontrak (0-3)
}

// ─── Credit Profile (SoulboundToken) ─────────────────────────────────────────

export interface CreditProfile {
  tokenId:             string;   // bigint → string
  reputationScore:     number;   // 0–1000
  totalLoansBorrowed:  number;
  totalLoansRepaid:    number;
  totalAmountBorrowed: string;   // ETH string
  totalAmountRepaid:   string;   // ETH string
  lastUpdated:         number;   // unix timestamp
  isActive:            boolean;
}

// ─── Reputation Score (ReputationEngine) ─────────────────────────────────────

export interface CompositeScore {
  paymentScore:   number;
  vouchScore:     number;
  attestScore:    number;
  compositeScore: number;
}

// ─── APR Breakdown (InterestRateModel) ───────────────────────────────────────

export interface APRBreakdown {
  base:               number;   // basis points
  groupPremium:       number;   // basis points
  reputationDiscount: number;   // basis points
  finalAPR:           number;   // basis points
}

// ─── Guild Group (GuildSBT) ───────────────────────────────────────────────────

export type GuildTier = 'Bronze' | 'Silver' | 'Gold';

export const GUILD_TIER_MAP: Record<number, GuildTier> = {
  0: 'Bronze',
  1: 'Silver',
  2: 'Gold',
};

export interface CreditGroup {
  groupId:              string;
  name:                 string;
  members:              string[];
  collectiveScore:      number;
  tier:                 GuildTier;
  totalGroupLoans:      number;
  totalGroupRepayments: number;
  createdAt:            number;
  lastUpdated:          number;
  isActive:             boolean;
}

// ─── Vouch (VouchRegistry) ───────────────────────────────────────────────────

export interface VouchInfo {
  voucher:      string;
  borrower:     string;
  stakeAmount:  string;   // ETH string
  vouchScore:   number;
  timestamp:    number;
  isActive:     boolean;
  slashed:      boolean;
}

// ─── Lender Contribution (LoanEscrow) ────────────────────────────────────────

export interface LenderContribution {
  lender:    string;
  amount:    string;   // ETH string
  loanId:    string;
  withdrawn: boolean;
}

// ─── Wallet State ─────────────────────────────────────────────────────────────

export interface WalletState {
  address:     string;
  balance:     string;   // ETH string
  isConnected: boolean;
  chainId:     number;
}

// ─── EAS Attestation ─────────────────────────────────────────────────────────

export interface EASAttestation {
  id:        string;
  schema:    string;
  attester:  string;
  recipient: string;
  time:      number;
  data:      Record<string, any>;
}

// ─── TX State (untuk loading UI) ─────────────────────────────────────────────

export type TxStatus = 'idle' | 'pending' | 'success' | 'error';

export interface TxState {
  status: TxStatus;
  hash?:  string;
  error?: string;
}