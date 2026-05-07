/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ethers } from 'ethers';
import {
  Wallet,
  TrendingUp,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Loan,
  CreditProfile,
  APRBreakdown,
  CompositeScore,
  WalletState,
  TxState,
  LOAN_STATUS_MAP,
} from './types';
import { cn } from '@/lib/utils';
import {
  connectWallet as connectWalletService,
  getCreditProfile,
  getBorrowerLoans,
  getLoan,
  requestLoan as requestLoanService,
  repayLoan as repayLoanService,
  fundLoan as fundLoanService,
  getAPRBreakdown,
  getCompositeScore,
  recalculateScore,
  weiToEth,
  bpsToPercent,
  getWalletBalance,
} from './services/contractService';
import { easService } from './services/easService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Konversi raw Loan dari kontrak ke format UI */
function formatLoan(raw: any): Loan {
  return {
    loanId:         raw.loanId.toString(),
    borrower:       raw.borrower,
    principal:      ethers.formatEther(raw.principal),
    interestAmount: ethers.formatEther(raw.interestAmount),
    totalDue:       ethers.formatEther(raw.totalDue),
    aprBasisPoints: Number(raw.aprBasisPoints),
    durationDays:   Number(raw.durationDays),
    fundedAt:       Number(raw.fundedAt),
    dueDate:        Number(raw.dueDate),
    amountRepaid:   ethers.formatEther(raw.amountRepaid),
    status:         LOAN_STATUS_MAP[Number(raw.status)],
    statusCode:     Number(raw.status),
  };
}

/** Konversi raw CreditProfile dari kontrak ke format UI */
function formatProfile(raw: any): CreditProfile {
  return {
    tokenId:             raw.tokenId.toString(),
    reputationScore:     Number(raw.reputationScore),
    totalLoansBorrowed:  Number(raw.totalLoansBorrowed),
    totalLoansRepaid:    Number(raw.totalLoansRepaid),
    totalAmountBorrowed: ethers.formatEther(raw.totalAmountBorrowed),
    totalAmountRepaid:   ethers.formatEther(raw.totalAmountRepaid),
    lastUpdated:         Number(raw.lastUpdated),
    isActive:            raw.isActive,
  };
}

/** Potong address menjadi format 0x1234...5678 */
function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Konversi basis points ke persentase string */
function bps(val: number) {
  return (val / 100).toFixed(2) + '%';
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Pending:  'bg-blue-50 text-blue-700 border-blue-200',
    Active:   'bg-emerald-50 text-emerald-700 border-emerald-200',
    Repaid:   'bg-slate-50 text-slate-700 border-slate-200',
    Defaulted:'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px] font-extrabold uppercase rounded-[2px]', map[status])}>
      {status}
    </Badge>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab]   = useState('borrow');
  const [wallet, setWallet]         = useState<WalletState>({ address: '', balance: '0', isConnected: false, chainId: 0 });
  const [profile, setProfile]       = useState<CreditProfile | null>(null);
  const [loans, setLoans]           = useState<Loan[]>([]);
  const [aprBreakdown, setAprBreakdown] = useState<APRBreakdown | null>(null);
  const [compositeScore, setCompositeScore] = useState<CompositeScore | null>(null);
  const [attestations, setAttestations] = useState<any[]>([]);

  // Form state
  const [loanPrincipal, setLoanPrincipal]   = useState('');
  const [loanDuration, setLoanDuration]     = useState('');
  const [fundAmount, setFundAmount]         = useState('');
  const [selectedLoan, setSelectedLoan]     = useState<Loan | null>(null);

  // TX state
  const [txState, setTxState]             = useState<TxState>({ status: 'idle' });
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isLoadingLoans, setIsLoadingLoans]   = useState(false);

  // ── Load data setelah wallet terhubung ────────────────────────────────────

  const loadUserData = useCallback(async (address: string) => {
    try {
      setIsLoadingLoans(true);

      // Profil kredit
      const rawProfile = await getCreditProfile(address);
      setProfile(formatProfile(rawProfile));

      // Semua loan ID milik borrower lalu fetch detail tiap loan
      const loanIds: bigint[] = await getBorrowerLoans(address);
      const loanDetails = await Promise.all(loanIds.map(id => getLoan(id)));
      setLoans(loanDetails.map(formatLoan));

      // APR breakdown
      const apr = await getAPRBreakdown(address);
      setAprBreakdown({
        base:               Number(apr.base),
        groupPremium:       Number(apr.groupPremium),
        reputationDiscount: Number(apr.reputationDiscount),
        finalAPR:           Number(apr.finalAPR),
      });

      // Composite score
      const cs = await getCompositeScore(address);
      setCompositeScore({
        paymentScore:   Number(cs.paymentScore),
        vouchScore:     Number(cs.vouchScore),
        attestScore:    Number(cs.attestScore),
        compositeScore: Number(cs.compositeScore),
      });

      // EAS attestations
      const atts = await easService.getAttestations(address);
      setAttestations(atts);

    } catch (err) {
      console.error('Gagal memuat data:', err);
    } finally {
      setIsLoadingLoans(false);
    }
  }, []);

  // ── Connect Wallet ────────────────────────────────────────────────────────

  const handleConnectWallet = async () => {
    try {
      const result = await connectWalletService();
      setWallet({ ...result, isConnected: true });
      await loadUserData(result.address);
    } catch (err: any) {
      console.error('Gagal connect wallet:', err.message);
    }
  };

  // Auto-detect account/chain change
  useEffect(() => {
    if (!window.ethereum) return;
    const onAccountChange = async (accounts: string[]) => {
      if (accounts.length === 0) {
        setWallet({ address: '', balance: '0', isConnected: false, chainId: 0 });
        setProfile(null);
        setLoans([]);
      } else {
        const balance = await getWalletBalance(accounts[0]);
        setWallet(prev => ({ ...prev, address: accounts[0], balance }));
        await loadUserData(accounts[0]);
      }
    };
    window.ethereum.on('accountsChanged', onAccountChange);
    window.ethereum.on('chainChanged', () => window.location.reload());
    return () => {
      window.ethereum?.removeAllListeners('accountsChanged');
      window.ethereum?.removeAllListeners('chainChanged');
    };
  }, [loadUserData]);

  // ── Recalculate Score ─────────────────────────────────────────────────────

  const handleRecalculate = async () => {
    if (!wallet.address) return;
    setIsRecalculating(true);
    try {
      await recalculateScore(wallet.address);
      await loadUserData(wallet.address);
    } catch (err) {
      console.error('Gagal recalculate:', err);
    } finally {
      setIsRecalculating(false);
    }
  };

  // ── Request Loan ──────────────────────────────────────────────────────────

  const handleRequestLoan = async () => {
    if (!loanPrincipal || !loanDuration) return;
    setTxState({ status: 'pending' });
    try {
      const { receipt, loanId } = await requestLoanService(loanPrincipal, Number(loanDuration));
      setTxState({ status: 'success', hash: receipt.hash });
      setLoanPrincipal('');
      setLoanDuration('');
      await loadUserData(wallet.address);
    } catch (err: any) {
      setTxState({ status: 'error', error: err.message });
    }
  };

  // ── Repay Loan ────────────────────────────────────────────────────────────

  const handleRepayLoan = async (loan: Loan) => {
    setTxState({ status: 'pending' });
    try {
      const receipt = await repayLoanService(BigInt(loan.loanId), loan.totalDue);
      setTxState({ status: 'success', hash: receipt.hash });
      await loadUserData(wallet.address);
    } catch (err: any) {
      setTxState({ status: 'error', error: err.message });
    }
  };

  // ── Fund Loan ─────────────────────────────────────────────────────────────

  const handleFundLoan = async (loanId: string) => {
    if (!fundAmount) return;
    setTxState({ status: 'pending' });
    try {
      const receipt = await fundLoanService(BigInt(loanId), fundAmount);
      setTxState({ status: 'success', hash: receipt.hash });
      setFundAmount('');
      await loadUserData(wallet.address);
    } catch (err: any) {
      setTxState({ status: 'error', error: err.message });
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Navigation */}
      <header className="h-[70px] border-b border-border flex items-center justify-between px-10 bg-white sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="font-serif text-2xl font-bold text-primary tracking-tight">
            Modal<span className="text-accent">In</span>
          </div>
          <Badge variant="outline" className="ml-2 text-[10px] font-mono uppercase tracking-widest bg-muted border-border">Beta</Badge>
        </div>

        <div className="hidden md:flex items-center space-x-8 text-[13px] font-semibold uppercase tracking-[0.1em]">
          {['borrow', 'lend', 'reputation'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'transition-colors hover:text-accent',
                activeTab === tab ? 'text-primary border-b-2 border-accent pb-1' : 'text-muted-foreground'
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4">
          {wallet.isConnected ? (
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-muted-foreground">{wallet.balance} ETH</span>
              <div className="bg-primary text-white px-4 py-2 rounded-[4px] text-xs font-mono">
                {shortAddress(wallet.address)}
              </div>
            </div>
          ) : (
            <Button
              onClick={handleConnectWallet}
              className="bg-primary hover:bg-primary/90 text-white rounded-[4px] px-6 uppercase text-[13px] font-bold tracking-widest h-10"
            >
              <Wallet className="w-4 h-4 mr-2" />
              Connect
            </Button>
          )}
        </div>
      </header>

      {/* TX Notification */}
      {txState.status !== 'idle' && (
        <div className={cn(
          'fixed bottom-6 right-6 z-50 p-4 rounded-[4px] border text-[12px] max-w-sm shadow-lg',
          txState.status === 'pending' && 'bg-blue-50 border-blue-200 text-blue-800',
          txState.status === 'success' && 'bg-emerald-50 border-emerald-200 text-emerald-800',
          txState.status === 'error'   && 'bg-red-50 border-red-200 text-red-800',
        )}>
          <div className="flex items-center gap-2 font-bold mb-1">
            {txState.status === 'pending' && <><Loader2 className="w-3 h-3 animate-spin" /> Memproses Transaksi...</>}
            {txState.status === 'success' && <><CheckCircle2 className="w-3 h-3" /> Transaksi Berhasil</>}
            {txState.status === 'error'   && <><AlertCircle className="w-3 h-3" /> Transaksi Gagal</>}
          </div>
          {txState.hash  && <p className="font-mono truncate text-[10px]">{txState.hash}</p>}
          {txState.error && <p className="truncate">{txState.error}</p>}
          {txState.status !== 'pending' && (
            <button onClick={() => setTxState({ status: 'idle' })} className="mt-2 underline text-[11px]">Tutup</button>
          )}
        </div>
      )}

      <main className="grid grid-cols-1 lg:grid-cols-[320px_1fr_300px] gap-[1px] bg-border min-h-[calc(100vh-70px)]">
        <AnimatePresence mode="wait">

          {/* ── BORROW TAB ───────────────────────────────────────────────────── */}
          {activeTab === 'borrow' && (
            <motion.div key="borrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="contents">

              {/* Left: Credit SBT */}
              <section className="bg-white p-8 border-r border-border">
                <h2 className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground mb-6 font-bold">My Credit SBT</h2>

                {!wallet.isConnected ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                    <Wallet className="w-10 h-10 text-muted-foreground" />
                    <p className="text-[12px] text-muted-foreground">Connect wallet untuk melihat profil kredit kamu</p>
                    <Button onClick={handleConnectWallet} className="bg-primary text-white rounded-[4px] text-[13px] uppercase font-bold tracking-widest h-10 px-6">
                      Connect Wallet
                    </Button>
                  </div>
                ) : profile ? (
                  <div className="flex flex-col items-center py-6">
                    <div className="relative w-[180px] h-[180px] rounded-full border-[8px] border-muted border-t-accent flex flex-col items-center justify-center mb-6">
                      <span className="text-5xl font-light text-primary">{profile.reputationScore}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {profile.reputationScore >= 800 ? 'Excellent' : profile.reputationScore >= 600 ? 'Good' : 'Fair'}
                      </span>
                    </div>

                    <div className="w-full space-y-0">
                      <div className="py-4 border-b border-muted flex justify-between items-center">
                        <span className="text-[13px] text-muted-foreground">Loans Borrowed</span>
                        <span className="text-[13px] font-bold text-primary">{profile.totalLoansBorrowed}</span>
                      </div>
                      <div className="py-4 border-b border-muted flex justify-between items-center">
                        <span className="text-[13px] text-muted-foreground">Total Borrowed</span>
                        <span className="text-[13px] font-bold text-primary">{Number(profile.totalAmountBorrowed).toFixed(4)} ETH</span>
                      </div>
                      <div className="py-4 border-b border-muted flex justify-between items-center">
                        <span className="text-[13px] text-muted-foreground">Total Repaid</span>
                        <span className="text-[13px] font-bold text-emerald-600">{Number(profile.totalAmountRepaid).toFixed(4)} ETH</span>
                      </div>
                      <div className="py-4 border-b border-muted flex justify-between items-center">
                        <span className="text-[13px] text-muted-foreground">Loans Repaid</span>
                        <span className="text-[13px] font-bold text-primary">{profile.totalLoansRepaid}</span>
                      </div>
                    </div>

                    <Button
                      className="w-full mt-10 bg-primary hover:bg-primary/90 text-white uppercase text-[13px] font-bold tracking-widest h-12 rounded-[4px]"
                      onClick={handleRecalculate}
                      disabled={isRecalculating}
                    >
                      {isRecalculating ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Update Reputation'}
                    </Button>
                  </div>
                ) : (
                  <div className="flex justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                )}
              </section>

              {/* Middle: Loan Management */}
              <section className="bg-white p-8">
                <h2 className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground mb-6 font-bold">Active Loans</h2>

                {isLoadingLoans ? (
                  <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                ) : loans.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground py-6">Belum ada pinjaman.</p>
                ) : (
                  <div className="space-y-4">
                    {loans.filter(l => l.status === 'Active' || l.status === 'Repaid').map((loan) => (
                      <Dialog key={loan.loanId}>
                        <DialogTrigger asChild>
                          <div
                            onClick={() => setSelectedLoan(loan)}
                            className={cn(
                              'bg-background p-5 border-l-4 border-primary transition-all cursor-pointer hover:shadow-md',
                              loan.status === 'Repaid' && 'opacity-60 border-l-border'
                            )}
                          >
                            <div className="flex justify-between items-center mb-3">
                              <span className="font-mono text-[12px] text-muted-foreground">LOAN-ID: #{loan.loanId}</span>
                              <StatusBadge status={loan.status} />
                            </div>
                            <div className="text-xl font-bold mb-1">{Number(loan.principal).toFixed(4)} ETH</div>
                            {loan.status === 'Active' && (
                              <div className="space-y-2 mt-3">
                                <Progress
                                  value={(Number(loan.amountRepaid) / Number(loan.totalDue)) * 100}
                                  className="h-1.5 bg-muted rounded-none"
                                />
                                <div className="flex justify-between text-[12px] text-muted-foreground">
                                  <span>Repaid: {Number(loan.amountRepaid).toFixed(4)} ETH</span>
                                  <span>Total: {Number(loan.totalDue).toFixed(4)} ETH</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px] rounded-none border-border">
                          <DialogHeader>
                            <DialogTitle className="text-[13px] font-bold uppercase tracking-widest">Loan Details #{loan.loanId}</DialogTitle>
                            <DialogDescription className="text-[12px]">Detail dan status pinjaman ini.</DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-2 gap-4 text-[12px]">
                              <div><p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Principal</p><p className="font-bold">{Number(loan.principal).toFixed(4)} ETH</p></div>
                              <div><p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">APR</p><p className="font-bold text-emerald-600">{bps(loan.aprBasisPoints)}</p></div>
                              <div><p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Duration</p><p className="font-bold">{loan.durationDays} Days</p></div>
                              <div><p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Total Due</p><p className="font-bold">{Number(loan.totalDue).toFixed(4)} ETH</p></div>
                              <div><p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Status</p><StatusBadge status={loan.status} /></div>
                            </div>
                            <Separator />
                            <div>
                              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Repayment Progress</p>
                              <div className="flex justify-between text-[11px] mb-1">
                                <span>{Number(loan.amountRepaid).toFixed(4)} ETH repaid</span>
                                <span>{((Number(loan.amountRepaid) / Number(loan.totalDue)) * 100).toFixed(0)}%</span>
                              </div>
                              <Progress value={(Number(loan.amountRepaid) / Number(loan.totalDue)) * 100} className="h-1.5 bg-muted rounded-none" />
                            </div>
                          </div>
                          <DialogFooter className="flex-col gap-2">
                            {loan.status === 'Active' && (
                              <Button
                                className="w-full bg-primary hover:bg-primary/90 text-white rounded-none uppercase text-[12px] font-bold tracking-widest"
                                onClick={() => handleRepayLoan(loan)}
                                disabled={txState.status === 'pending'}
                              >
                                {txState.status === 'pending' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Repay Full Amount'}
                              </Button>
                            )}
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    ))}
                  </div>
                )}

                {/* Request Loan Form */}
                <div className="mt-12">
                  <h2 className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground mb-6 font-bold">Request Micro-Loan</h2>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase text-muted-foreground">Principal (ETH)</label>
                      <Input
                        placeholder="0.00"
                        value={loanPrincipal}
                        onChange={e => setLoanPrincipal(e.target.value)}
                        className="border-border rounded-[4px] h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase text-muted-foreground">Duration (Days)</label>
                      <Input
                        type="number"
                        placeholder="30"
                        value={loanDuration}
                        onChange={e => setLoanDuration(e.target.value)}
                        className="border-border rounded-[4px] h-11"
                      />
                    </div>
                  </div>
                  <Button
                    className="w-full bg-primary hover:bg-primary/90 text-white uppercase text-[13px] font-bold tracking-widest h-12 rounded-[4px]"
                    onClick={handleRequestLoan}
                    disabled={!wallet.isConnected || !loanPrincipal || !loanDuration || txState.status === 'pending'}
                  >
                    {txState.status === 'pending' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit Request'}
                  </Button>
                  {!wallet.isConnected && (
                    <p className="text-[11px] text-muted-foreground text-center mt-2">Connect wallet terlebih dahulu</p>
                  )}
                </div>
              </section>

              {/* Right: APR Breakdown */}
              <section className="bg-white p-8 border-l border-border">
                <h2 className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground mb-6 font-bold">APR Model Breakdown</h2>
                <p className="text-[12px] text-muted-foreground leading-relaxed mb-6">
                  Suku bunga dihitung dinamis berdasarkan Soulbound Credit Profile kamu.
                </p>

                {aprBreakdown ? (
                  <div className="border border-border p-4 bg-white space-y-2">
                    <div className="flex justify-between text-[12px]">
                      <span>Base Market Rate</span>
                      <span>{bps(aprBreakdown.base)}</span>
                    </div>
                    <div className="flex justify-between text-[12px]">
                      <span>Group Risk Premium</span>
                      <span>+{bps(aprBreakdown.groupPremium)}</span>
                    </div>
                    <div className="flex justify-between text-[12px] text-emerald-600">
                      <span>Reputation Discount</span>
                      <span>-{bps(aprBreakdown.reputationDiscount)}</span>
                    </div>
                    <div className="pt-2 mt-2 border-t border-border flex justify-between text-[12px] font-bold text-primary">
                      <span>Final APR</span>
                      <span>{bps(aprBreakdown.finalAPR)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="border border-border p-4 text-[12px] text-muted-foreground text-center">
                    Connect wallet untuk melihat APR kamu
                  </div>
                )}
              </section>
            </motion.div>
          )}

          {/* ── LEND TAB ─────────────────────────────────────────────────────── */}
          {activeTab === 'lend' && (
            <motion.div key="lend" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="contents">

              {/* Left: Market Stats */}
              <section className="bg-white p-8 border-r border-border">
                <h2 className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground mb-6 font-bold">Market Stats</h2>
                <div className="space-y-6">
                  {[
                    { label: 'Total Loans', value: loans.length.toString(), unit: 'loans' },
                    { label: 'Active Loans', value: loans.filter(l => l.status === 'Active').length.toString(), unit: 'active' },
                    { label: 'Pending Funding', value: loans.filter(l => l.status === 'Pending').length.toString(), unit: 'pending' },
                  ].map(stat => (
                    <div key={stat.label} className="border border-border p-4">
                      <div className="text-[12px] text-muted-foreground mb-1">{stat.label}</div>
                      <div className="text-2xl font-bold text-primary">{stat.value} <span className="text-sm text-muted-foreground font-normal">{stat.unit}</span></div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Middle: Loan Marketplace */}
              <section className="bg-white p-8">
                <h2 className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground mb-6 font-bold">Loan Marketplace</h2>

                {loans.filter(l => l.status === 'Pending').length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">Tidak ada pinjaman yang menunggu pendanaan.</p>
                ) : (
                  <div className="space-y-4">
                    {loans.filter(l => l.status === 'Pending').map((loan) => (
                      <div key={loan.loanId} className="bg-background p-6 border-l-4 border-primary">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <span className="font-mono text-[12px] text-muted-foreground">LOAN-ID: #{loan.loanId}</span>
                            <div className="text-2xl font-bold mt-1">{Number(loan.principal).toFixed(4)} ETH</div>
                          </div>
                          <StatusBadge status={loan.status} />
                        </div>
                        <div className="grid grid-cols-2 gap-4 mb-4 text-[12px]">
                          <div><span className="text-muted-foreground">APR:</span> <span className="font-bold">{bps(loan.aprBasisPoints)}</span></div>
                          <div><span className="text-muted-foreground">Duration:</span> <span className="font-bold">{loan.durationDays} Days</span></div>
                        </div>
                        <div className="flex gap-2 mt-4">
                          <Input
                            placeholder="Jumlah ETH"
                            value={fundAmount}
                            onChange={e => setFundAmount(e.target.value)}
                            className="border-border rounded-[4px] h-10 text-[12px]"
                          />
                          <Button
                            className="bg-primary hover:bg-primary/90 text-white uppercase text-[12px] font-bold tracking-widest h-10 rounded-[4px] whitespace-nowrap px-4"
                            onClick={() => handleFundLoan(loan.loanId)}
                            disabled={!wallet.isConnected || !fundAmount || txState.status === 'pending'}
                          >
                            {txState.status === 'pending' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Fund'}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Right: Lender Info */}
              <section className="bg-white p-8 border-l border-border">
                <h2 className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground mb-6 font-bold">Lender Benefits</h2>
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-[13px] font-bold">Direct Impact</h3>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">Modal langsung mendukung UMKM Indonesia tanpa perantara.</p>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-[13px] font-bold">Reputation Protected</h3>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">Borrower diverifikasi oleh Soulbound Token dan sistem Guild Vouch.</p>
                  </div>
                </div>
              </section>
            </motion.div>
          )}

          {/* ── REPUTATION TAB ───────────────────────────────────────────────── */}
          {activeTab === 'reputation' && (
            <motion.div key="reputation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="contents">

              {/* Left: Identity */}
              <section className="bg-white p-8 border-r border-border">
                <h2 className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground mb-6 font-bold">ModalIn Identity</h2>
                {wallet.isConnected ? (
                  <div className="bg-primary text-white p-6 rounded-[4px] space-y-6 relative overflow-hidden">
                    <div className="relative z-10">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Borrower Address</div>
                      <div className="text-[12px] font-mono truncate mb-6">{wallet.address}</div>
                      <div className="flex justify-between items-end">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Reputation</div>
                          <div className="text-4xl font-bold text-accent">{profile?.reputationScore ?? '—'}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Balance</div>
                          <div className="text-[12px]">{Number(wallet.balance).toFixed(4)} ETH</div>
                        </div>
                      </div>
                    </div>
                    <div className="absolute top-0 right-0 w-24 h-24 bg-accent/10 rounded-full -mr-12 -mt-12 blur-2xl" />
                  </div>
                ) : (
                  <div className="text-[12px] text-muted-foreground text-center py-16">Connect wallet untuk melihat identitas</div>
                )}

                {compositeScore && (
                  <div className="mt-8 space-y-3">
                    <h3 className="text-[11px] font-bold uppercase text-muted-foreground">Composite Score Breakdown</h3>
                    {[
                      { label: 'Payment Score', value: compositeScore.paymentScore },
                      { label: 'Vouch Score', value: compositeScore.vouchScore },
                      { label: 'Attest Score', value: compositeScore.attestScore },
                    ].map(item => (
                      <div key={item.label} className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-muted-foreground">{item.label}</span>
                          <span className="font-bold">{item.value}</span>
                        </div>
                        <Progress value={item.value / 10} className="h-1 bg-muted rounded-none" />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Middle: EAS Attestations */}
              <section className="bg-white p-8">
                <h2 className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground mb-6 font-bold">Verified Attestations (EAS)</h2>
                {attestations.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">Belum ada attestation.</p>
                ) : (
                  <div className="space-y-4">
                    {attestations.map((att, i) => (
                      <div key={i} className="flex items-center justify-between p-4 border border-muted hover:border-accent transition-colors">
                        <div className="flex items-center gap-4">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          <div>
                            <div className="text-[13px] font-bold">{att.data?.businessName ?? att.schema.slice(0, 16)}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {att.attester} • {new Date(att.time).toLocaleDateString('id-ID')}
                            </div>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] uppercase font-bold border-emerald-200 text-emerald-700">Verified</Badge>
                      </div>
                    ))}
                  </div>
                )}
                <Button className="w-full mt-8 bg-primary hover:bg-primary/90 text-white uppercase text-[13px] font-bold tracking-widest h-12 rounded-[4px]">
                  Request New Attestation
                </Button>
              </section>

              {/* Right: Guild */}
              <section className="bg-white p-8 border-l border-border">
                <h2 className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground mb-6 font-bold">Guild Reputation</h2>
                <p className="text-[12px] text-muted-foreground">Fitur guild akan tampil setelah kamu bergabung ke kelompok kredit.</p>
                <Button
                  variant="outline"
                  className="w-full mt-8 border-border text-primary uppercase text-[13px] font-bold tracking-widest h-12 rounded-[4px] hover:bg-muted"
                  onClick={() => setActiveTab('borrow')}
                >
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Lihat Dashboard
                </Button>
              </section>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-border py-8">
        <div className="max-w-7xl mx-auto px-10 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-[11px] text-muted-foreground uppercase tracking-widest">© 2024 ModalIn Protocol. Built for Indonesian UMKMs.</p>
          <div className="flex items-center gap-6">
            <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1.5 uppercase">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" /> Hardhat Local
            </span>
            <span className="text-[10px] font-mono text-muted-foreground uppercase">v0.4.2-alpha</span>
          </div>
        </div>
      </footer>
    </div>
  );
}