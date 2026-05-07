import { Loan, CreditProfile } from './types';

export const MOCK_PROFILE: CreditProfile = {
  reputationScore: 785,
  totalLoans: 15.5, // ETH
  totalRepaid: 12.2,
  lastUpdated: Date.now() - 86400000 * 5,
};

export const MOCK_LOANS: Loan[] = [
  {
    loanId: 1,
    borrower: '0x1234...5678',
    principal: 0.5,
    interestAmount: 0.06,
    totalDue: 0.56,
    aprBasisPoints: 1200,
    durationDays: 30,
    fundedAt: Date.now() - 86400000 * 10,
    dueDate: Date.now() + 86400000 * 20,
    amountRepaid: 0.2,
    status: 'Active',
  },
  {
    loanId: 2,
    borrower: '0x8765...4321',
    principal: 1.2,
    interestAmount: 0.18,
    totalDue: 1.38,
    aprBasisPoints: 1500,
    durationDays: 60,
    fundedAt: 0,
    dueDate: 0,
    amountRepaid: 0,
    status: 'Requested',
  },
  {
    loanId: 3,
    borrower: '0xABCD...EFGH',
    principal: 0.25,
    interestAmount: 0.02,
    totalDue: 0.27,
    aprBasisPoints: 800,
    durationDays: 14,
    fundedAt: Date.now() - 86400000 * 30,
    dueDate: Date.now() - 86400000 * 16,
    amountRepaid: 0.27,
    status: 'Repaid',
  },
];
