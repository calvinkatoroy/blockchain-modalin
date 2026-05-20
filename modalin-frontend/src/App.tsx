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
  CreditProfile,
  LOAN_STATUS_MAP,
  Loan,
  TxState,
  WalletState,
} from './types';
import {
  connectWallet as connectWalletService,
  fundLoan as fundLoanService,
  getAPRBreakdown,
  getBorrowerLoans,
  getCompositeScore,
  getCreditProfile,
  getLoan,
  getLoanContributions,
  getWalletBalance,
  hasSBT,
  recalculateScore,
  repayLoan as repayLoanService,
  requestLoan as requestLoanService,
  selfRegister,
  withdrawLenderFunds,
} from './services/contractService';
import { easService } from './services/easService';

type TabKey = 'borrow' | 'lend' | 'reputation';

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
  const [attestations, setAttestations] = useState<any[]>([]);
  const [loanPrincipal, setLoanPrincipal] = useState('');
  const [loanDuration, setLoanDuration] = useState('');
  const [fundAmounts, setFundAmounts] = useState<Record<string, string>>({});
  const [txState, setTxState] = useState<TxState>({ status: 'idle' });
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isLoadingLoans, setIsLoadingLoans] = useState(false);

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
          const data = await easService.getAttestations(address);
          setAttestations(data);
        } catch {
          setAttestations([]);
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
    const receipt = await selfRegister();
    if (!silent) {
      setTxState({ status: 'success', hash: receipt.hash });
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
        setAttestations([]);
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
      setTxState({ status: 'error', error: error.reason ?? error.message });
    } finally {
      setIsRecalculating(false);
    }
  };

  const handleRequestLoan = async () => {
    if (!loanPrincipal || !loanDuration) return;

    setTxState({ status: 'pending' });
    try {
      const { receipt } = await requestLoanService(loanPrincipal, Number(loanDuration));
      setTxState({ status: 'success', hash: receipt.hash });
      setLoanPrincipal('');
      setLoanDuration('');
      await loadUserData(wallet.address);
    } catch (error: any) {
      setTxState({ status: 'error', error: error.reason ?? error.message });
    }
  };

  const handleRepayLoan = async (loan: Loan) => {
    setTxState({ status: 'pending' });

    try {
      const receipt = await repayLoanService(BigInt(loan.loanId), loan.totalDue);
      setTxState({ status: 'success', hash: receipt.hash });
      await loadUserData(wallet.address);
    } catch (error: any) {
      setTxState({ status: 'error', error: error.reason ?? error.message });
    }
  };

  const handleFundLoan = async (loanId: string) => {
    const amount = fundAmounts[loanId];
    if (!amount) return;

    setTxState({ status: 'pending' });
    try {
      const receipt = await fundLoanService(BigInt(loanId), amount);
      setTxState({ status: 'success', hash: receipt.hash });
      setFundAmounts((prev) => ({ ...prev, [loanId]: '' }));
      await loadUserData(wallet.address);
    } catch (error: any) {
      setTxState({ status: 'error', error: error.reason ?? error.message });
    }
  };

  const handleWithdraw = async (loanId: string) => {
    setTxState({ status: 'pending' });

    try {
      const contributions = await getLoanContributions(BigInt(loanId));
      const myIndex = contributions.findIndex(
        (item: any) => item.lender.toLowerCase() === wallet.address.toLowerCase() && !item.withdrawn
      );

      if (myIndex === -1) throw new Error('Tidak ada dana yang bisa ditarik.');

      const receipt = await withdrawLenderFunds(BigInt(loanId), myIndex);
      setTxState({ status: 'success', hash: receipt.hash });
      await loadUserData(wallet.address);
    } catch (error: any) {
      setTxState({ status: 'error', error: error.reason ?? error.message });
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
                      disabled={!wallet.isConnected || !loanPrincipal || !loanDuration || txState.status === 'pending'}
                      className="h-11 w-full rounded-xl"
                    >
                      {txState.status === 'pending' ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Ajukan Pinjaman
                    </Button>

                    {!wallet.isConnected ? (
                      <p className="text-sm text-muted-foreground">Hubungkan dompet terlebih dahulu.</p>
                    ) : null}
                  </div>
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
                  description="Gambaran cepat kondisi pinjaman pada jaringan lokal."
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

                <SectionCard title="Panduan Singkat" description="Urutan dasar untuk mencoba fitur pendanaan di mode demo.">
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p>1. Pindah ke akun pendana di MetaMask.</p>
                    <p>2. Pilih pinjaman yang statusnya masih menunggu dana.</p>
                    <p>3. Isi jumlah pendanaan lalu klik tombol danai.</p>
                    <p>4. Setelah peminjam melunasi, tarik kembali dana beserta bunganya.</p>
                  </div>
                </SectionCard>
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
                        { label: 'Skor pembayaran', value: compositeScore.paymentScore },
                        { label: 'Skor vouch', value: compositeScore.vouchScore },
                        { label: 'Skor attestasi', value: compositeScore.attestScore },
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
              </div>

              <div className="space-y-6">
                <SectionCard
                  title="Attestasi Terverifikasi"
                  description="Contoh data dukungan reputasi dari layanan eksternal."
                >
                  {attestations.length === 0 ? (
                    <EmptyState
                      icon={<CheckCircle2 className="h-5 w-5" />}
                      title="Belum ada attestasi"
                      description="Data attestasi akan muncul di sini setelah tersedia."
                    />
                  ) : (
                    <div className="space-y-3">
                      {attestations.map((attestation, index) => (
                        <div key={index} className="rounded-xl border border-border p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-foreground">
                                {attestation.data?.businessName ?? 'Attestasi'}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                Diterbitkan oleh {attestation.attester}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                Tanggal {new Date(attestation.time).toLocaleDateString('id-ID')}
                              </p>
                            </div>
                            <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">
                              Terverifikasi
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  title="Catatan"
                  description="Penjelasan singkat tentang peran reputasi dalam aplikasi ini."
                >
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p>Reputasi digunakan untuk membantu menentukan APR dan kelayakan pinjaman.</p>
                    <p>Semakin baik histori pembayaran dan dukungan attestasi, semakin sehat profil kreditnya.</p>
                    <p>Tampilan ini disederhanakan agar fokus pada informasi yang paling penting.</p>
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
          <p>Jaringan lokal Hardhat • Chain ID 31337</p>
        </div>
      </footer>
    </div>
  );
}
