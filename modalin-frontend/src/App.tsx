import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ethers } from 'ethers';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Shield,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  APRBreakdown,
  CompositeScore,
  CreditGroup,
  CreditProfile,
  GUILD_TIER_MAP,
  GuildTier,
  LOAN_STATUS_MAP,
  Loan,
  TxState,
  WalletState,
} from './types';
import {
  connectWallet as connectWalletService,
  createGroup as createGroupService,
  fastForwardTime,
  getBlockTimestamp,
  fundLoan as fundLoanService,
  getAPRBreakdown,
  getActiveVouchCount,
  getBorrowerLoans,
  getCompositeScore,
  getCreditProfile,
  getGroupByMember,
  getLoan,
  getLoanContributions,
  getWalletBalance,
  hasSBT,
  isGroupMember as checkIsGroupMember,
  joinGroup as joinGroupService,
  markDefault as markDefaultService,
  recalculateScore,
  repayLoan as repayLoanService,
  requestLoan as requestLoanService,
  selfRegister,
  vouch as vouchService,
  withdrawLenderFunds,
} from './services/contractService';

type TabKey = 'borrow' | 'lend' | 'reputation';

const IS_LOCAL = import.meta.env.VITE_NETWORK === 'local';

const CONTRACT_ERRORS: Record<string, string> = {
  AlreadyHasSBT: 'Akun ini sudah memiliki identitas kredit (SBT).',
  NoSBT: 'Akun belum memiliki identitas kredit. Hubungkan ulang dompet.',
  NotAuthorized: 'Akun tidak memiliki izin untuk melakukan aksi ini.',
  TransferNotAllowed: 'Token identitas kredit tidak dapat dipindahtangankan.',
  InvalidLoanStatus: 'Status pinjaman tidak sesuai untuk aksi ini.',
  InsufficientRepayment: 'Jumlah pembayaran kurang dari total tagihan.',
  LoanNotDefaulted: 'Pinjaman belum melewati batas waktu gagal bayar.',
  AlreadyMember: 'Akun sudah terdaftar di kelompok kredit.',
  GroupFull: 'Kelompok sudah penuh (maksimal 10 anggota).',
  SelfVouchNotAllowed: 'Tidak bisa memberikan vouch ke diri sendiri.',
  user_rejected: 'Transaksi dibatalkan oleh pengguna.',
  'User denied': 'Transaksi dibatalkan oleh pengguna.',
};

function friendlyError(err: any): string {
  const raw: string = err?.reason ?? err?.message ?? String(err);
  for (const [key, msg] of Object.entries(CONTRACT_ERRORS)) {
    if (raw.includes(key)) return msg;
  }
  if (raw.length > 120) return raw.slice(0, 120) + '…';
  return raw;
}

const KNOWN_ACCOUNTS: Record<string, string> = {
  '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266': 'Akun #0 · Peminjam',
  '0x70997970c51812dc3a010c7d01b50e0d17dc79c8': 'Akun #1 · Pendana',
  '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc': 'Akun #2',
  '0x90f79bf6eb2c4f870365e785982e1f101e93b906': 'Akun #3',
};

const TAB_ITEMS: Array<{ key: TabKey; label: string }> = [
  { key: 'borrow', label: 'Pinjam' },
  { key: 'lend', label: 'Danai' },
  { key: 'reputation', label: 'Reputasi' },
];

function formatLoan(raw: any): Loan {
  return {
    loanId: raw.loanId.toString(),
    borrower: raw.borrower,
    principal: ethers.formatEther(raw.principal),
    interestAmount: ethers.formatEther(raw.interestAmount),
    totalDue: ethers.formatEther(raw.totalDue),
    aprBasisPoints: Number(raw.aprBasisPoints),
    durationDays: Number(raw.durationDays),
    fundedAt: Number(raw.fundedAt),
    dueDate: Number(raw.dueDate),
    amountRepaid: ethers.formatEther(raw.amountRepaid),
    status: LOAN_STATUS_MAP[Number(raw.status)],
    statusCode: Number(raw.status),
  };
}

function formatProfile(raw: any): CreditProfile {
  return {
    tokenId: raw.tokenId.toString(),
    reputationScore: Number(raw.reputationScore),
    totalLoansBorrowed: Number(raw.totalLoansBorrowed),
    totalLoansRepaid: Number(raw.totalLoansRepaid),
    totalAmountBorrowed: ethers.formatEther(raw.totalAmountBorrowed),
    totalAmountRepaid: ethers.formatEther(raw.totalAmountRepaid),
    lastUpdated: Number(raw.lastUpdated),
    isActive: raw.isActive,
  };
}

function formatGroup(raw: any): CreditGroup {
  return {
    groupId: raw.groupId.toString(),
    name: raw.name,
    members: raw.members,
    collectiveScore: Number(raw.collectiveScore),
    tier: GUILD_TIER_MAP[Number(raw.tier)] ?? 'Bronze',
    totalGroupLoans: Number(raw.totalGroupLoans),
    totalGroupRepayments: Number(raw.totalGroupRepayments),
    createdAt: Number(raw.createdAt),
    lastUpdated: Number(raw.lastUpdated),
    isActive: raw.isActive,
  };
}

function getTierBadgeClass(tier: GuildTier) {
  if (tier === 'Gold') return 'border-yellow-300 bg-yellow-50 text-yellow-800';
  if (tier === 'Silver') return 'border-slate-300 bg-slate-100 text-slate-700';
  return 'border-amber-300 bg-amber-50 text-amber-800';
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function bps(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}

function eth(value: string | number, digits = 4) {
  return `${Number(value).toFixed(digits)} ETH`;
}

function formatDate(timestamp: number) {
  if (!timestamp) return '-';
  return new Date(timestamp * 1000).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getAccountLabel(address: string) {
  return KNOWN_ACCOUNTS[address.toLowerCase()] ?? shortAddress(address);
}

function getStatusLabel(status: Loan['status']) {
  const labels: Record<Loan['status'], string> = {
    Requested: 'Menunggu Dana',
    Funded: 'Didanai',
    Active: 'Berjalan',
    Repaid: 'Lunas',
    Defaulted: 'Gagal Bayar',
  };
  return labels[status] ?? status;
}

function getStatusBadgeClass(status: Loan['status']) {
  const classes: Record<Loan['status'], string> = {
    Requested: 'border-blue-200 bg-blue-50 text-blue-700',
    Funded: 'border-amber-200 bg-amber-50 text-amber-700',
    Active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    Repaid: 'border-slate-200 bg-slate-100 text-slate-700',
    Defaulted: 'border-red-200 bg-red-50 text-red-700',
  };
  return classes[status] ?? 'border-border bg-muted text-foreground';
}

function getScoreLabel(score?: number | null) {
  if (score == null) return '-';
  if (score >= 800) return 'Sangat baik';
  if (score >= 650) return 'Baik';
  if (score >= 500) return 'Cukup';
  return 'Perlu ditingkatkan';
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-primary">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/35 px-5 py-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-muted-foreground shadow-sm">
        {icon}
      </div>
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('borrow');
  const [wallet, setWallet] = useState<WalletState>({
    address: '',
    balance: '0',
    isConnected: false,
    chainId: 0,
  });
  const [profile, setProfile] = useState<CreditProfile | null>(null);
  const [myLoans, setMyLoans] = useState<Loan[]>([]);
  const [allLoans, setAllLoans] = useState<Loan[]>([]);
  const [aprBreakdown, setAprBreakdown] = useState<APRBreakdown | null>(null);
  const [compositeScore, setCompositeScore] = useState<CompositeScore | null>(null);
  const [groupInfo, setGroupInfo] = useState<CreditGroup | null>(null);
  const [isInGroup, setIsInGroup] = useState(false);
  const [activeVouchCount, setActiveVouchCount] = useState(0);
  const [groupName, setGroupName] = useState('');
  const [joinGroupId, setJoinGroupId] = useState('');
  const [vouchAddress, setVouchAddress] = useState('');
  const [vouchAmount, setVouchAmount] = useState('');
  const [loanPrincipal, setLoanPrincipal] = useState('');
  const [loanDuration, setLoanDuration] = useState('');
  const [fundAmounts, setFundAmounts] = useState<Record<string, string>>({});
  const [txState, setTxState] = useState<TxState>({ status: 'idle' });
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isForwarding, setIsForwarding] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isLoadingLoans, setIsLoadingLoans] = useState(false);

  const setSuccess = useCallback((hash: string) => {
    setTxState({ status: 'success', hash });
    setTimeout(() => setTxState((s) => (s.status === 'success' ? { status: 'idle' } : s)), 4000);
  }, []);

  const setError = useCallback((err: any) => {
    setTxState({ status: 'error', error: friendlyError(err) });
  }, []);

  const requestedLoans = allLoans.filter((loan) => loan.status === 'Requested');
  const repaidLoansForWithdraw = allLoans.filter(
    (loan) => loan.status === 'Repaid' && loan.borrower.toLowerCase() !== wallet.address.toLowerCase()
  );

  const loadAllLoans = useCallback(async () => {
    const loans: Loan[] = [];
    let id = 1n;

    while (true) {
      try {
        const raw = await getLoan(id);
        if (Number(raw.principal) === 0) break;
        loans.push(formatLoan(raw));
        id += 1n;
      } catch {
        break;
      }
    }

    setAllLoans(loans);
  }, []);

  const loadUserData = useCallback(
    async (address: string) => {
      setIsLoadingProfile(true);
      setIsLoadingLoans(true);

      try {
        try {
          const rawProfile = await getCreditProfile(address);
          setProfile(formatProfile(rawProfile));
        } catch {
          setProfile(null);
        }

        try {
          const loanIds: bigint[] = await getBorrowerLoans(address);
          const loanDetails = await Promise.all(loanIds.map((id) => getLoan(id)));
          setMyLoans(loanDetails.map(formatLoan));
        } catch {
          setMyLoans([]);
        }

        try {
          const apr = await getAPRBreakdown(address);
          setAprBreakdown({
            base: Number(apr.base),
            groupPremium: Number(apr.groupPremium),
            reputationDiscount: Number(apr.reputationDiscount),
            finalAPR: Number(apr.finalAPR),
          });
        } catch {
          setAprBreakdown(null);
        }

        try {
          const score = await getCompositeScore(address);
          setCompositeScore({
            paymentScore: Number(score.paymentScore),
            vouchScore: Number(score.vouchScore),
            attestScore: Number(score.attestScore),
            compositeScore: Number(score.compositeScore),
          });
        } catch {
          setCompositeScore(null);
        }

        try {
          const inGroup = await checkIsGroupMember(address);
          setIsInGroup(inGroup);
          if (inGroup) {
            const rawGroup = await getGroupByMember(address);
            setGroupInfo(formatGroup(rawGroup));
          } else {
            setGroupInfo(null);
          }
        } catch {
          setIsInGroup(false);
          setGroupInfo(null);
        }

        try {
          const count = await getActiveVouchCount(address);
          setActiveVouchCount(Number(count));
        } catch {
          setActiveVouchCount(0);
        }
      } finally {
        setIsLoadingProfile(false);
        setIsLoadingLoans(false);
      }

      await loadAllLoans();
    },
    [loadAllLoans]
  );

  const ensureRegistered = useCallback(async (address: string, silent = false) => {
    const registered = await hasSBT(address);
    if (registered) return false;

    if (!silent) {
      setTxState({ status: 'pending' });
    }
    try {
      const receipt = await selfRegister();
      if (!silent) {
        setTxState({ status: 'success', hash: receipt.hash });
      }
    } catch (err: any) {
      // Ignore if another concurrent call already registered this address
      const msg = err?.reason ?? err?.message ?? '';
      if (!msg.includes('AlreadyHasSBT')) throw err;
    }
    return true;
  }, []);

  const handleConnectWallet = async () => {
    try {
      const result = await connectWalletService();
      setWallet({ ...result, isConnected: true });
      setTxState({ status: 'idle' });
      await ensureRegistered(result.address, true);
      await loadUserData(result.address);
    } catch (error: any) {
      console.error('Gagal menghubungkan dompet:', error.message);
      setTxState({ status: 'error', error: error.message });
    }
  };

  useEffect(() => {
    if (!window.ethereum) return;

    const onAccountChange = async (accounts: string[]) => {
      if (accounts.length === 0) {
        setWallet({ address: '', balance: '0', isConnected: false, chainId: 0 });
        setProfile(null);
        setMyLoans([]);
        setAprBreakdown(null);
        setCompositeScore(null);
        setGroupInfo(null);
        setIsInGroup(false);
        setActiveVouchCount(0);
        return;
      }

      const balance = await getWalletBalance(accounts[0]);
      setWallet((prev) => ({ ...prev, address: accounts[0], balance, isConnected: true }));
      setTxState({ status: 'idle' });
      await ensureRegistered(accounts[0], true);
      await loadUserData(accounts[0]);
    };

    window.ethereum.on('accountsChanged', onAccountChange);
    window.ethereum.on('chainChanged', () => window.location.reload());

    return () => {
      window.ethereum?.removeAllListeners('accountsChanged');
      window.ethereum?.removeAllListeners('chainChanged');
    };
  }, [ensureRegistered, loadUserData]);

  const handleRecalculate = async () => {
    if (!wallet.address) return;
    setIsRecalculating(true);

    try {
      await recalculateScore(wallet.address);
      await loadUserData(wallet.address);
    } catch (error: any) {
      setError(error);
    } finally {
      setIsRecalculating(false);
    }
  };

  const handleFastForward = async (days: number) => {
    setIsForwarding(true);
    try {
      await fastForwardTime(days * 24 * 60 * 60 + 15);
      await loadAllLoans();
      if (wallet.address) await loadUserData(wallet.address);
    } catch (error: any) {
      setError(error);
    } finally {
      setIsForwarding(false);
    }
  };

  const handleMarkDefault = async (loan: Loan) => {
    setTxState({ status: 'pending' });
    try {
      const GRACE_PERIOD = 10; // seconds, must match LoanEscrow.sol
      const now = await getBlockTimestamp();
      const requiredTime = loan.dueDate + GRACE_PERIOD + 1;
      if (now <= requiredTime) {
        setIsForwarding(true);
        await fastForwardTime(requiredTime - now + 5);
        setIsForwarding(false);
      }
      const receipt = await markDefaultService(BigInt(loan.loanId));
      setSuccess(receipt.hash);
      await loadAllLoans();
      if (wallet.address) await loadUserData(wallet.address);
    } catch (error: any) {
      setIsForwarding(false);
      setError(error);
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) return;
    setTxState({ status: 'pending' });
    try {
      const receipt = await createGroupService(groupName.trim());
      setSuccess(receipt.hash);
      setGroupName('');
      await loadUserData(wallet.address);
    } catch (error: any) {
      setError(error);
    }
  };

  const handleJoinGroup = async () => {
    const id = Number(joinGroupId);
    if (!joinGroupId || isNaN(id) || id < 1) {
      setTxState({ status: 'error', error: 'Masukkan ID kelompok yang valid (angka positif).' });
      return;
    }
    setTxState({ status: 'pending' });
    try {
      const receipt = await joinGroupService(id);
      setSuccess(receipt.hash);
      setJoinGroupId('');
      await loadUserData(wallet.address);
    } catch (error: any) {
      setError(error);
    }
  };

  const handleVouch = async () => {
    if (!vouchAddress || !vouchAmount) return;
    if (!/^0x[0-9a-fA-F]{40}$/.test(vouchAddress)) {
      setTxState({ status: 'error', error: 'Format alamat tidak valid. Gunakan format 0x...' });
      return;
    }
    if (vouchAddress.toLowerCase() === wallet.address.toLowerCase()) {
      setTxState({ status: 'error', error: 'Tidak bisa memberikan vouch ke diri sendiri.' });
      return;
    }
    if (isNaN(Number(vouchAmount)) || Number(vouchAmount) < 0.001) {
      setTxState({ status: 'error', error: 'Jumlah vouch minimum 0.001 ETH.' });
      return;
    }
    setTxState({ status: 'pending' });
    try {
      const voucherScore = profile?.reputationScore ?? 500;
      const receipt = await vouchService(vouchAddress, voucherScore, vouchAmount);
      setSuccess(receipt.hash);
      setVouchAddress('');
      setVouchAmount('');
      await loadUserData(wallet.address);
    } catch (error: any) {
      setError(error);
    }
  };

  const handleRequestLoan = async () => {
    const principal = Number(loanPrincipal);
    const duration = Number(loanDuration);
    if (!loanPrincipal || isNaN(principal) || principal <= 0) {
      setTxState({ status: 'error', error: 'Masukkan jumlah pinjaman yang valid (ETH > 0).' });
      return;
    }
    if (!loanDuration || isNaN(duration) || duration < 1 || !Number.isInteger(duration)) {
      setTxState({ status: 'error', error: 'Durasi pinjaman minimal 1 hari (angka bulat).' });
      return;
    }
    setTxState({ status: 'pending' });
    try {
      const { receipt } = await requestLoanService(loanPrincipal, duration);
      setSuccess(receipt.hash);
      setLoanPrincipal('');
      setLoanDuration('');
      await loadUserData(wallet.address);
    } catch (error: any) {
      setError(error);
    }
  };

  const handleRepayLoan = async (loan: Loan) => {
    setTxState({ status: 'pending' });
    try {
      const receipt = await repayLoanService(BigInt(loan.loanId), loan.totalDue);
      setSuccess(receipt.hash);
      await loadUserData(wallet.address);
    } catch (error: any) {
      setError(error);
    }
  };

  const handleFundLoan = async (loanId: string) => {
    const amount = fundAmounts[loanId];
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setTxState({ status: 'error', error: 'Masukkan jumlah pendanaan yang valid.' });
      return;
    }
    setTxState({ status: 'pending' });
    try {
      const receipt = await fundLoanService(BigInt(loanId), amount);
      setSuccess(receipt.hash);
      setFundAmounts((prev) => ({ ...prev, [loanId]: '' }));
      await loadUserData(wallet.address);
    } catch (error: any) {
      setError(error);
    }
  };

  const handleWithdraw = async (loanId: string) => {
    setTxState({ status: 'pending' });
    try {
      const contributions = await getLoanContributions(BigInt(loanId));
      const myIndex = contributions.findIndex(
        (item: any) => item.lender.toLowerCase() === wallet.address.toLowerCase() && !item.withdrawn
      );
      if (myIndex === -1) throw new Error('Akun ini tidak memiliki kontribusi yang bisa ditarik dari pinjaman ini.');
      const receipt = await withdrawLenderFunds(BigInt(loanId), myIndex);
      setSuccess(receipt.hash);
      await loadUserData(wallet.address);
    } catch (error: any) {
      setError(error);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-primary">ModalIn</h1>
              {/* <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[11px]">
                Demo
              </Badge> */}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Platform pinjaman mikro berbasis reputasi on-chain.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-2">
              {TAB_ITEMS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'rounded-full px-4 py-2 text-sm transition-colors',
                    activeTab === tab.key
                      ? 'bg-primary text-white'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {wallet.isConnected ? (
              <div className="rounded-2xl border border-border bg-muted/40 px-4 py-2.5">
                <p className="text-xs font-medium text-foreground">{getAccountLabel(wallet.address)}</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{shortAddress(wallet.address)}</span>
                  <span>•</span>
                  <span>{eth(wallet.balance)}</span>
                </div>
              </div>
            ) : (
              <Button onClick={handleConnectWallet} className="rounded-full px-5">
                <Wallet className="mr-2 h-4 w-4" />
                Hubungkan Dompet
              </Button>
            )}
          </div>
        </div>
      </header>

      <AnimatePresence>
        {txState.status !== 'idle' && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className={cn(
              'fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border px-4 py-3 shadow-lg',
              txState.status === 'pending' && 'border-blue-200 bg-blue-50 text-blue-800',
              txState.status === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
              txState.status === 'error' && 'border-red-200 bg-red-50 text-red-800'
            )}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                {txState.status === 'pending' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : txState.status === 'success' ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {txState.status === 'pending' && 'Transaksi sedang diproses'}
                  {txState.status === 'success' && 'Transaksi berhasil'}
                  {txState.status === 'error' && 'Transaksi gagal'}
                </p>
                {txState.hash ? <p className="mt-1 truncate text-xs">{txState.hash}</p> : null}
                {txState.error ? <p className="mt-1 text-xs">{txState.error}</p> : null}
                {txState.status !== 'pending' ? (
                  <button
                    onClick={() => setTxState({ status: 'idle' })}
                    className="mt-2 text-xs underline underline-offset-2"
                  >
                    Tutup
                  </button>
                ) : null}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
        <AnimatePresence mode="wait">
          {activeTab === 'borrow' && (
            <motion.div
              key="borrow"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="contents"
            >
              <div className="space-y-6">
                <SectionCard
                  title="Ringkasan Kredit"
                  description="Profil singkat untuk menilai kesiapan pinjaman."
                >
                  {!wallet.isConnected ? (
                    <EmptyState
                      icon={<Wallet className="h-5 w-5" />}
                      title="Dompet belum terhubung"
                      description="Hubungkan dompet untuk melihat profil kredit dan riwayat pinjaman."
                    />
                  ) : isLoadingProfile ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : !profile ? (
                    <EmptyState
                      icon={<Shield className="h-5 w-5" />}
                      title="Profil kredit belum tersedia"
                      description="Akun ini belum memiliki profil kredit. Coba hubungkan ulang dompet untuk memicu pendaftaran otomatis."
                    />
                  ) : (
                    <div className="space-y-5">
                      <div className="flex items-end justify-between gap-4 rounded-xl bg-muted/45 p-5">
                        <div>
                          <p className="text-sm text-muted-foreground">Skor reputasi</p>
                          <p className="mt-1 text-4xl font-semibold text-primary">{profile.reputationScore}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{getScoreLabel(profile.reputationScore)}</p>
                        </div>
                        <Button
                          variant="outline"
                          onClick={handleRecalculate}
                          disabled={isRecalculating}
                          className="rounded-full"
                        >
                          {isRecalculating ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-2 h-4 w-4" />
                          )}
                          Perbarui Skor
                        </Button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-border p-4">
                          <p className="text-sm text-muted-foreground">Total pinjaman</p>
                          <p className="mt-1 text-xl font-semibold">{profile.totalLoansBorrowed}</p>
                        </div>
                        <div className="rounded-xl border border-border p-4">
                          <p className="text-sm text-muted-foreground">Pinjaman lunas</p>
                          <p className="mt-1 text-xl font-semibold">{profile.totalLoansRepaid}</p>
                        </div>
                        <div className="rounded-xl border border-border p-4">
                          <p className="text-sm text-muted-foreground">Total dipinjam</p>
                          <p className="mt-1 text-xl font-semibold">{eth(profile.totalAmountBorrowed)}</p>
                        </div>
                        <div className="rounded-xl border border-border p-4">
                          <p className="text-sm text-muted-foreground">Total dibayar</p>
                          <p className="mt-1 text-xl font-semibold">{eth(profile.totalAmountRepaid)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  title="Pinjaman Saya"
                  description="Daftar pinjaman yang diajukan dari akun aktif."
                >
                  {isLoadingLoans ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : myLoans.length === 0 ? (
                    <EmptyState
                      icon={<ArrowUpRight className="h-5 w-5" />}
                      title="Belum ada pinjaman"
                      description="Ajukan pinjaman baru untuk melihat riwayat di sini."
                    />
                  ) : (
                    <div className="space-y-3">
                      {myLoans.map((loan) => (
                        <div key={loan.loanId} className="rounded-xl border border-border p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium">Pinjaman #{loan.loanId}</p>
                                <Badge
                                  variant="outline"
                                  className={cn('rounded-full px-2.5 py-0.5 text-[11px]', getStatusBadgeClass(loan.status))}
                                >
                                  {getStatusLabel(loan.status)}
                                </Badge>
                              </div>
                              <p className="mt-2 text-2xl font-semibold text-primary">{eth(loan.principal)}</p>
                            </div>

                            {loan.status === 'Active' ? (
                              <Button
                                onClick={() => handleRepayLoan(loan)}
                                disabled={txState.status === 'pending'}
                                className="rounded-full"
                              >
                                {txState.status === 'pending' ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <ArrowUpRight className="mr-2 h-4 w-4" />
                                )}
                                Bayar Sekarang
                              </Button>
                            ) : null}
                          </div>

                          <div className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
                            <div>
                              <p>APR</p>
                              <p className="mt-1 font-medium text-foreground">{bps(loan.aprBasisPoints)}</p>
                            </div>
                            <div>
                              <p>Jatuh tempo</p>
                              <p className="mt-1 font-medium text-foreground">{formatDate(loan.dueDate)}</p>
                            </div>
                            <div>
                              <p>Total tagihan</p>
                              <p className="mt-1 font-medium text-foreground">{eth(loan.totalDue)}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>

              <div className="space-y-6">
                <SectionCard
                  title="Ajukan Pinjaman"
                  description="Form sederhana untuk membuat permintaan pinjaman baru."
                >
                  {!wallet.isConnected ? (
                    <div className="rounded-xl border border-dashed border-border bg-muted/35 px-5 py-8 text-center">
                      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-muted-foreground shadow-sm">
                        <Wallet className="h-5 w-5" />
                      </div>
                      <p className="font-medium text-foreground">Hubungkan dompet terlebih dahulu</p>
                      <p className="mt-1 text-sm text-muted-foreground">Klik tombol <strong>Hubungkan Dompet</strong> di pojok kanan atas untuk mulai.</p>
                      <Button onClick={handleConnectWallet} className="mt-4 rounded-full px-6">
                        <Wallet className="mr-2 h-4 w-4" />
                        Hubungkan Dompet
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Jumlah pinjaman (ETH)</label>
                        <Input
                          placeholder="Contoh: 0.1"
                          value={loanPrincipal}
                          onChange={(event) => setLoanPrincipal(event.target.value)}
                          className="h-11 rounded-xl"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Durasi (hari)</label>
                        <Input
                          type="number"
                          placeholder="Contoh: 30"
                          value={loanDuration}
                          onChange={(event) => setLoanDuration(event.target.value)}
                          className="h-11 rounded-xl"
                        />
                      </div>

                      <Button
                        onClick={handleRequestLoan}
                        disabled={!loanPrincipal || !loanDuration || txState.status === 'pending'}
                        className="h-11 w-full rounded-xl"
                      >
                        {txState.status === 'pending' ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        Ajukan Pinjaman
                      </Button>
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  title="Simulasi APR"
                  description="Ringkasan bunga berdasarkan profil reputasi akun aktif."
                >
                  {!wallet.isConnected || !aprBreakdown ? (
                    <EmptyState
                      icon={<Shield className="h-5 w-5" />}
                      title="APR belum tersedia"
                      description="Hubungkan dompet untuk melihat simulasi suku bunga."
                    />
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Suku bunga dasar</span>
                        <span className="font-medium">{bps(aprBreakdown.base)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Premium grup</span>
                        <span className="font-medium">+{bps(aprBreakdown.groupPremium)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Diskon reputasi</span>
                        <span className="font-medium text-emerald-700">-{bps(aprBreakdown.reputationDiscount)}</span>
                      </div>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">APR akhir</span>
                        <span className="text-lg font-semibold text-primary">{bps(aprBreakdown.finalAPR)}</span>
                      </div>
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Akun Aktif" description="Informasi ringkas dompet yang sedang digunakan.">
                  {wallet.isConnected ? (
                    <div className="space-y-2 text-sm">
                      <p className="font-medium text-foreground">{getAccountLabel(wallet.address)}</p>
                      <p className="break-all text-muted-foreground">{wallet.address}</p>
                      <p className="text-muted-foreground">Saldo: {eth(wallet.balance)}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Belum ada dompet yang terhubung.</p>
                  )}
                </SectionCard>
              </div>
            </motion.div>
          )}

          {activeTab === 'lend' && (
            <motion.div
              key="lend"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="contents"
            >
              <div className="space-y-6">
                <SectionCard
                  title="Ringkasan Pasar"
                  description={`Gambaran cepat kondisi pinjaman pada ${IS_LOCAL ? 'jaringan lokal' : 'Ethereum Sepolia Testnet'}.`}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border p-4">
                      <p className="text-sm text-muted-foreground">Total pinjaman</p>
                      <p className="mt-1 text-2xl font-semibold">{allLoans.length}</p>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <p className="text-sm text-muted-foreground">Menunggu dana</p>
                      <p className="mt-1 text-2xl font-semibold">{requestedLoans.length}</p>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <p className="text-sm text-muted-foreground">Sedang berjalan</p>
                      <p className="mt-1 text-2xl font-semibold">{allLoans.filter((loan) => loan.status === 'Active').length}</p>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <p className="text-sm text-muted-foreground">Sudah lunas</p>
                      <p className="mt-1 text-2xl font-semibold">{allLoans.filter((loan) => loan.status === 'Repaid').length}</p>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard
                  title="Tarik Dana"
                  description="Gunakan bagian ini untuk mengambil dana dan bunga dari pinjaman yang sudah lunas."
                >
                  {repaidLoansForWithdraw.length === 0 ? (
                    <EmptyState
                      icon={<ArrowDownLeft className="h-5 w-5" />}
                      title="Belum ada dana untuk ditarik"
                      description="Dana akan muncul di sini setelah pinjaman lunas dan Anda memiliki kontribusi di dalamnya."
                    />
                  ) : (
                    <div className="space-y-3">
                      {repaidLoansForWithdraw.map((loan) => (
                        <div key={loan.loanId} className="rounded-xl border border-border p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm font-medium">Pinjaman #{loan.loanId}</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                Total pengembalian {eth(loan.totalDue)}
                              </p>
                            </div>
                            <Button
                              onClick={() => handleWithdraw(loan.loanId)}
                              disabled={txState.status === 'pending'}
                              className="rounded-full"
                            >
                              {txState.status === 'pending' ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <ArrowDownLeft className="mr-2 h-4 w-4" />
                              )}
                              Tarik Dana
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>

              <div className="space-y-6">
                <SectionCard
                  title="Daftar Pinjaman"
                  description="Pilih pinjaman yang masih membutuhkan pendanaan."
                >
                  {requestedLoans.length === 0 ? (
                    <EmptyState
                      icon={<Wallet className="h-5 w-5" />}
                      title="Belum ada permintaan aktif"
                      description="Coba ajukan pinjaman dari akun peminjam untuk mengisi daftar ini."
                    />
                  ) : (
                    <div className="space-y-3">
                      {requestedLoans.map((loan) => (
                        <div key={loan.loanId} className="rounded-xl border border-border p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium">Pinjaman #{loan.loanId}</p>
                                <Badge
                                  variant="outline"
                                  className={cn('rounded-full px-2.5 py-0.5 text-[11px]', getStatusBadgeClass(loan.status))}
                                >
                                  {getStatusLabel(loan.status)}
                                </Badge>
                              </div>
                              <p className="mt-2 text-2xl font-semibold text-primary">{eth(loan.principal)}</p>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
                            <div>
                              <p>APR</p>
                              <p className="mt-1 font-medium text-foreground">{bps(loan.aprBasisPoints)}</p>
                            </div>
                            <div>
                              <p>Durasi</p>
                              <p className="mt-1 font-medium text-foreground">{loan.durationDays} hari</p>
                            </div>
                            <div>
                              <p>Peminjam</p>
                              <p className="mt-1 font-medium text-foreground">{shortAddress(loan.borrower)}</p>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                            <Input
                              placeholder={`Maksimal ${Number(loan.principal).toFixed(4)} ETH`}
                              value={fundAmounts[loan.loanId] ?? ''}
                              onChange={(event) =>
                                setFundAmounts((prev) => ({ ...prev, [loan.loanId]: event.target.value }))
                              }
                              className="h-11 rounded-xl"
                            />
                            <Button
                              onClick={() => handleFundLoan(loan.loanId)}
                              disabled={!wallet.isConnected || !fundAmounts[loan.loanId] || txState.status === 'pending'}
                              className="rounded-xl sm:min-w-40"
                            >
                              {txState.status === 'pending' ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <ArrowDownLeft className="mr-2 h-4 w-4" />
                              )}
                              Danai
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Pinjaman Aktif" description="Pinjaman yang sedang berjalan. Gunakan Dev Tools di bawah untuk menguji skenario gagal bayar.">
                  {allLoans.filter((l) => l.status === 'Active').length === 0 ? (
                    <EmptyState
                      icon={<ArrowDownLeft className="h-5 w-5" />}
                      title="Belum ada pinjaman aktif"
                      description="Pinjaman berstatus Berjalan akan muncul di sini setelah didanai penuh."
                    />
                  ) : (
                    <div className="space-y-3">
                      {allLoans.filter((l) => l.status === 'Active').map((loan) => (
                        <div key={loan.loanId} className="rounded-xl border border-border p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium">Pinjaman #{loan.loanId}</p>
                                <Badge
                                  variant="outline"
                                  className={cn('rounded-full px-2.5 py-0.5 text-[11px]', getStatusBadgeClass(loan.status))}
                                >
                                  {getStatusLabel(loan.status)}
                                </Badge>
                              </div>
                              <p className="mt-2 text-xl font-semibold text-primary">{eth(loan.principal)}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Peminjam: {getAccountLabel(loan.borrower)} · Jatuh tempo: {formatDate(loan.dueDate)}
                              </p>
                            </div>
                            {IS_LOCAL && (
                              <Button
                                variant="outline"
                                onClick={() => handleMarkDefault(loan)}
                                disabled={txState.status === 'pending' || isForwarding}
                                className="rounded-full border-red-200 text-red-700 hover:bg-red-50"
                              >
                                {txState.status === 'pending' || isForwarding ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : null}
                                Simulasi Gagal Bayar
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                {IS_LOCAL && <SectionCard title="Dev Tools" description="Simulasi percepatan waktu untuk menguji skenario gagal bayar tanpa menunggu.">
                  <div className="space-y-4">
                    <div>
                      <p className="mb-3 text-sm text-muted-foreground">Majukan waktu blockchain lokal:</p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { label: '+1 hari', days: 1 },
                          { label: '+7 hari', days: 7 },
                          { label: '+30 hari', days: 30 },
                        ].map(({ label, days }) => (
                          <Button
                            key={days}
                            variant="outline"
                            size="sm"
                            onClick={() => handleFastForward(days)}
                            disabled={isForwarding}
                            className="rounded-full"
                          >
                            {isForwarding ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                            {label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 space-y-1">
                      <p className="font-medium">Cara uji skenario gagal bayar:</p>
                      <p>1. Peminjam ajukan pinjaman (min 0.0001 ETH, min 1 hari)</p>
                      <p>2. Pendana danai penuh → otomatis aktif</p>
                      <p>3. Klik majukan waktu melebihi durasi pinjaman</p>
                      <p>4. Klik "Tandai Gagal Bayar" di pinjaman aktif di atas</p>
                      <p>5. Vouch terpangkas + reputasi peminjam terpotong 50%</p>
                    </div>
                  </div>
                </SectionCard>}
              </div>
            </motion.div>
          )}

          {activeTab === 'reputation' && (
            <motion.div
              key="reputation"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="contents"
            >
              <div className="space-y-6">
                <SectionCard
                  title="Skor Reputasi"
                  description="Komponen pembentuk reputasi akun aktif."
                >
                  {!wallet.isConnected || !compositeScore ? (
                    <EmptyState
                      icon={<Shield className="h-5 w-5" />}
                      title="Data reputasi belum tersedia"
                      description="Hubungkan dompet untuk melihat rincian skor reputasi."
                    />
                  ) : (
                    <div className="space-y-5">
                      <div className="rounded-xl bg-muted/45 p-5">
                        <p className="text-sm text-muted-foreground">Skor komposit</p>
                        <p className="mt-1 text-4xl font-semibold text-primary">{compositeScore.compositeScore}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {getScoreLabel(compositeScore.compositeScore)}
                        </p>
                      </div>

                      {[
                        { label: 'Skor pembayaran (50%)', value: compositeScore.paymentScore },
                        { label: 'Skor vouch (30%)', value: compositeScore.vouchScore },
                        { label: 'Skor atestasi (20%)', value: compositeScore.attestScore },
                      ].map((item) => (
                        <div key={item.label} className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">{item.label}</span>
                            <span className="font-medium text-foreground">{item.value}</span>
                          </div>
                          <Progress value={item.value / 10} className="h-2" />
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  title="Identitas Akun"
                  description="Ringkasan akun yang sedang dipakai untuk perhitungan reputasi."
                >
                  {wallet.isConnected ? (
                    <div className="space-y-2 text-sm">
                      <p className="font-medium text-foreground">{getAccountLabel(wallet.address)}</p>
                      <p className="break-all text-muted-foreground">{wallet.address}</p>
                      <p className="text-muted-foreground">Saldo: {eth(wallet.balance)}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Hubungkan dompet untuk melihat identitas akun.</p>
                  )}
                </SectionCard>

                <SectionCard
                  title="Kelompok Kredit"
                  description="Tier grup mempengaruhi premium APR pinjaman."
                >
                  {!wallet.isConnected ? (
                    <EmptyState
                      icon={<Shield className="h-5 w-5" />}
                      title="Belum terhubung"
                      description="Hubungkan dompet untuk melihat atau membuat kelompok kredit."
                    />
                  ) : isInGroup && groupInfo ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <Badge
                          variant="outline"
                          className={cn('rounded-full px-3 py-1 text-sm font-semibold', getTierBadgeClass(groupInfo.tier))}
                        >
                          {groupInfo.tier}
                        </Badge>
                        <div>
                          <p className="font-medium text-foreground">{groupInfo.name}</p>
                          <p className="text-xs text-muted-foreground">Grup #{groupInfo.groupId}</p>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3 text-sm">
                        <div className="rounded-xl border border-border p-3">
                          <p className="text-muted-foreground">Skor kolektif</p>
                          <p className="mt-1 text-xl font-semibold">{groupInfo.collectiveScore}</p>
                        </div>
                        <div className="rounded-xl border border-border p-3">
                          <p className="text-muted-foreground">Anggota</p>
                          <p className="mt-1 text-xl font-semibold">{groupInfo.members.length}</p>
                        </div>
                        <div className="rounded-xl border border-border p-3">
                          <p className="text-muted-foreground">Pinjaman grup</p>
                          <p className="mt-1 text-xl font-semibold">{groupInfo.totalGroupLoans}</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Silver: skor ≥ 650 · Gold: skor ≥ 800
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">Kamu belum bergabung ke kelompok mana pun.</p>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Buat kelompok baru</label>
                        <div className="flex gap-2">
                          <Input
                            placeholder="Nama kelompok"
                            value={groupName}
                            onChange={(e) => setGroupName(e.target.value)}
                            className="h-10 rounded-xl flex-1"
                          />
                          <Button
                            onClick={handleCreateGroup}
                            disabled={!groupName || txState.status === 'pending'}
                            className="rounded-xl"
                          >
                            Buat
                          </Button>
                        </div>
                      </div>
                      <Separator />
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Gabung kelompok</label>
                        <div className="flex gap-2">
                          <Input
                            placeholder="ID kelompok"
                            value={joinGroupId}
                            onChange={(e) => setJoinGroupId(e.target.value)}
                            className="h-10 rounded-xl flex-1"
                          />
                          <Button
                            variant="outline"
                            onClick={handleJoinGroup}
                            disabled={!joinGroupId || txState.status === 'pending'}
                            className="rounded-xl"
                          >
                            Gabung
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </SectionCard>
              </div>

              <div className="space-y-6">
                <SectionCard
                  title="Vouch Aktif"
                  description="Jaminan peer-to-peer yang menguatkan profil kredit."
                >
                  {!wallet.isConnected ? (
                    <EmptyState
                      icon={<CheckCircle2 className="h-5 w-5" />}
                      title="Belum terhubung"
                      description="Hubungkan dompet untuk melihat dan memberikan vouch."
                    />
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-xl bg-muted/45 p-4 flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Vouch masuk aktif</p>
                          <p className="mt-1 text-2xl font-semibold">{activeVouchCount}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Skor vouch</p>
                          <p className="mt-1 text-2xl font-semibold">{compositeScore?.vouchScore ?? 0}</p>
                        </div>
                      </div>
                      <Separator />
                      <div className="space-y-3">
                        <p className="text-sm font-medium text-foreground">Berikan vouch ke alamat lain</p>
                        <div className="space-y-2">
                          <Input
                            placeholder="Alamat tujuan (0x...)"
                            value={vouchAddress}
                            onChange={(e) => setVouchAddress(e.target.value)}
                            className="h-10 rounded-xl"
                          />
                          <div className="flex gap-2">
                            <Input
                              placeholder="Jumlah ETH (min 0.001)"
                              value={vouchAmount}
                              onChange={(e) => setVouchAmount(e.target.value)}
                              className="h-10 rounded-xl flex-1"
                            />
                            <Button
                              onClick={handleVouch}
                              disabled={!vouchAddress || !vouchAmount || txState.status === 'pending'}
                              className="rounded-xl"
                            >
                              {txState.status === 'pending' ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : null}
                              Vouch
                            </Button>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          ETH yang di-stake akan hilang jika peminjam gagal bayar.
                        </p>
                      </div>
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  title="Catatan"
                  description="Penjelasan singkat tentang peran reputasi dalam aplikasi ini."
                >
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p>Reputasi terdiri dari tiga komponen: histori pembayaran (50%), skor vouch (30%), dan skor atestasi oracle (20%).</p>
                    <p>Bergabung ke kelompok kredit mempengaruhi premium APR: Bronze +8%, Silver +4%, Gold ±0%.</p>
                    <p>Vouch adalah jaminan sosial — anggota kelompok bisa stake ETH untuk mendukung peminjam lain.</p>
                  </div>
                </SectionCard>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="border-t border-border bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-sm text-muted-foreground sm:px-6 sm:flex-row sm:items-center sm:justify-between">
          <p>ModalIn untuk simulasi pinjaman mikro berbasis blockchain.</p>
          <p>{import.meta.env.VITE_NETWORK === "local" ? "Hardhat Local • Chain ID 31337" : "Ethereum Sepolia Testnet • Chain ID 11155111"}</p>
        </div>
      </footer>
    </div>
  );
}
