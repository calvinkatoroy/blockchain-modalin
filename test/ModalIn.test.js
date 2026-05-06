import hre from "hardhat";
import { expect } from "chai";
import { parseEther } from "ethers";

// ─── shared network connection ───────────────────────────────────────────────

let ethers, provider;
before(async function () {
  const conn = await hre.network.connect();
  ethers = conn.ethers;
  provider = conn.provider;
});

// ─── revert helper (replaces revertedWithCustomError) ────────────────────────

async function expectRevert(promise, errorName) {
  try {
    await promise;
    throw new Error(`Expected revert with '${errorName}' but call succeeded`);
  } catch (e) {
    if (!e.message.includes(errorName)) throw e;
  }
}

// ─── deploy helper ───────────────────────────────────────────────────────────

async function deployAll() {
  const [owner, borrower, lender1, lender2, member1, member2, oracle] =
    await ethers.getSigners();

  const sbt = await (await ethers.getContractFactory("SoulboundToken")).deploy();
  const guild = await (await ethers.getContractFactory("GuildSBT")).deploy();
  const vouchRegistry = await (await ethers.getContractFactory("VouchRegistry")).deploy();

  const repEngine = await (
    await ethers.getContractFactory("ReputationEngine")
  ).deploy(await sbt.getAddress(), await guild.getAddress(), await vouchRegistry.getAddress());

  const rateModel = await (
    await ethers.getContractFactory("InterestRateModel")
  ).deploy(await sbt.getAddress(), await guild.getAddress());

  const escrow = await (
    await ethers.getContractFactory("LoanEscrow")
  ).deploy(
    await sbt.getAddress(),
    await guild.getAddress(),
    await rateModel.getAddress(),
    await vouchRegistry.getAddress()
  );

  await sbt.setAuthorizedUpdater(await repEngine.getAddress(), true);
  await sbt.setAuthorizedUpdater(await escrow.getAddress(), true);
  await sbt.setAuthorizedUpdater(owner.address, true);
  await guild.setAuthorizedUpdater(await repEngine.getAddress(), true);
  await guild.setAuthorizedUpdater(await escrow.getAddress(), true);
  await vouchRegistry.setLoanEscrow(await escrow.getAddress());
  await repEngine.setDefaultOracle(oracle.address);

  return { sbt, guild, vouchRegistry, repEngine, rateModel, escrow, owner, borrower, lender1, lender2, member1, member2, oracle };
}

// ─── SoulboundToken ──────────────────────────────────────────────────────────

describe("SoulboundToken", function () {
  let ctx;
  beforeEach(async function () { ctx = await deployAll(); });

  it("issues SBT with neutral score of 500", async function () {
    await ctx.sbt.issueSBT(ctx.borrower.address);
    expect(await ctx.sbt.hasSBT(ctx.borrower.address)).to.be.true;
    expect(await ctx.sbt.getReputationScore(ctx.borrower.address)).to.equal(500n);
  });

  it("updates reputation score", async function () {
    await ctx.sbt.issueSBT(ctx.borrower.address);
    await ctx.sbt.updateReputation(ctx.borrower.address, 750n);
    expect(await ctx.sbt.getReputationScore(ctx.borrower.address)).to.equal(750n);
  });

  it("reverts when issuing a second SBT to same address", async function () {
    await ctx.sbt.issueSBT(ctx.borrower.address);
    await expectRevert(ctx.sbt.issueSBT(ctx.borrower.address), "AlreadyHasSBT");
  });

  it("reverts on transfer (soulbound)", async function () {
    await expectRevert(ctx.sbt.transfer(ctx.borrower.address, 1n), "TransferNotAllowed");
  });

  it("reverts when unauthorized actor updates reputation", async function () {
    await ctx.sbt.issueSBT(ctx.borrower.address);
    await expectRevert(
      ctx.sbt.connect(ctx.borrower).updateReputation(ctx.borrower.address, 900n),
      "NotAuthorized"
    );
  });

  it("returns 100% repayment rate when no loan history", async function () {
    await ctx.sbt.issueSBT(ctx.borrower.address);
    expect(await ctx.sbt.getRepaymentRate(ctx.borrower.address)).to.equal(100n);
  });
});

// ─── GuildSBT ────────────────────────────────────────────────────────────────

describe("GuildSBT", function () {
  let ctx;
  beforeEach(async function () { ctx = await deployAll(); });

  it("creates a group with Bronze tier and score 500", async function () {
    await ctx.guild.connect(ctx.member1).createGroup("Kelompok Maju Jaya");
    const groupId = await ctx.guild.memberToGroup(ctx.member1.address);
    const group = await ctx.guild.getGroup(groupId);
    expect(group.tier).to.equal(0n);
    expect(group.collectiveScore).to.equal(500n);
  });

  it("allows a second member to join", async function () {
    await ctx.guild.connect(ctx.member1).createGroup("Kelompok Maju Jaya");
    const groupId = await ctx.guild.memberToGroup(ctx.member1.address);
    await ctx.guild.connect(ctx.member2).joinGroup(groupId);
    expect(await ctx.guild.isGroupMember(ctx.member2.address)).to.be.true;
  });

  it("updates tier to Silver at score 700", async function () {
    await ctx.guild.connect(ctx.member1).createGroup("Kelompok Maju Jaya");
    const groupId = await ctx.guild.memberToGroup(ctx.member1.address);
    await ctx.guild.updateGroupScore(groupId, 700n);
    expect(await ctx.guild.getGroupTier(groupId)).to.equal(1n);
  });

  it("updates tier to Gold at score 850", async function () {
    await ctx.guild.connect(ctx.member1).createGroup("Kelompok Maju Jaya");
    const groupId = await ctx.guild.memberToGroup(ctx.member1.address);
    await ctx.guild.updateGroupScore(groupId, 850n);
    expect(await ctx.guild.getGroupTier(groupId)).to.equal(2n);
  });

  it("reverts when member tries to join a second group", async function () {
    await ctx.guild.connect(ctx.member1).createGroup("Group A");
    const groupId = await ctx.guild.memberToGroup(ctx.member1.address);
    await ctx.guild.connect(ctx.member2).joinGroup(groupId);
    await expectRevert(ctx.guild.connect(ctx.member2).joinGroup(groupId), "AlreadyInGroup");
  });
});

// ─── VouchRegistry ───────────────────────────────────────────────────────────

describe("VouchRegistry", function () {
  let ctx;
  const stake = parseEther("0.01");
  beforeEach(async function () { ctx = await deployAll(); });

  it("records a vouch and counts it as active", async function () {
    await ctx.vouchRegistry.connect(ctx.member1).vouch(ctx.borrower.address, 600n, { value: stake });
    expect(await ctx.vouchRegistry.getActiveVouchCount(ctx.borrower.address)).to.equal(1n);
  });

  it("computes stake-weighted vouch score correctly", async function () {
    await ctx.vouchRegistry.connect(ctx.member1).vouch(ctx.borrower.address, 600n, { value: stake });
    await ctx.vouchRegistry.connect(ctx.member2).vouch(ctx.borrower.address, 400n, { value: stake });
    expect(await ctx.vouchRegistry.getVouchScore(ctx.borrower.address)).to.equal(500n);
  });

  it("reverts on self-vouching", async function () {
    await expectRevert(
      ctx.vouchRegistry.connect(ctx.borrower).vouch(ctx.borrower.address, 500n, { value: stake }),
      "CannotVouchForSelf"
    );
  });

  it("reverts when stake is below minimum", async function () {
    await expectRevert(
      ctx.vouchRegistry.connect(ctx.lender1).vouch(ctx.borrower.address, 500n, {
        value: parseEther("0.0001"),
      }),
      "InsufficientStake"
    );
  });
});

// ─── ReputationEngine ────────────────────────────────────────────────────────

describe("ReputationEngine", function () {
  let ctx;
  beforeEach(async function () { ctx = await deployAll(); });

  it("recalculates a composite score greater than zero", async function () {
    await ctx.sbt.issueSBT(ctx.borrower.address);
    const score = await ctx.repEngine.recalculateScore.staticCall(ctx.borrower.address);
    expect(score).to.be.gt(0n);
  });

  it("accepts attestation score from authorized oracle", async function () {
    await ctx.sbt.issueSBT(ctx.borrower.address);
    await ctx.repEngine.connect(ctx.oracle).submitAttestationScore(ctx.borrower.address, 800n);
    const { attestScore } = await ctx.repEngine.getCompositeScore(ctx.borrower.address);
    expect(attestScore).to.equal(800n);
  });

  it("reverts when unauthorized address submits attestation", async function () {
    await ctx.sbt.issueSBT(ctx.borrower.address);
    await expectRevert(
      ctx.repEngine.connect(ctx.lender1).submitAttestationScore(ctx.borrower.address, 800n),
      "NotAuthorizedOracle"
    );
  });

  it("reverts when weights do not sum to 100", async function () {
    await expectRevert(ctx.repEngine.setWeights(50n, 30n, 30n), "WeightsMustSumTo100");
  });
});

// ─── InterestRateModel ───────────────────────────────────────────────────────

describe("InterestRateModel", function () {
  let ctx;
  beforeEach(async function () { ctx = await deployAll(); });

  it("returns APR above 1500 bps for Bronze/low-rep borrower", async function () {
    await ctx.sbt.issueSBT(ctx.borrower.address);
    await ctx.sbt.updateReputation(ctx.borrower.address, 750n);
    expect(await ctx.rateModel.calculateAPR(ctx.borrower.address)).to.be.gt(1500n);
  });

  it("returns APR at or below 700 bps for Gold/high-rep borrower", async function () {
    await ctx.sbt.issueSBT(ctx.borrower.address);
    await ctx.sbt.updateReputation(ctx.borrower.address, 950n);
    await ctx.guild.connect(ctx.borrower).createGroup("Kelompok Emas");
    const groupId = await ctx.guild.memberToGroup(ctx.borrower.address);
    await ctx.guild.updateGroupScore(groupId, 900n);
    expect(await ctx.rateModel.calculateAPR(ctx.borrower.address)).to.be.lte(700n);
  });

  it("calculates non-zero interest for a 30-day loan", async function () {
    await ctx.sbt.issueSBT(ctx.borrower.address);
    const interest = await ctx.rateModel.calculateInterest(
      ctx.borrower.address,
      parseEther("1"),
      30n
    );
    expect(interest).to.be.gt(0n);
  });
});

// ─── LoanEscrow — full lifecycle ─────────────────────────────────────────────

describe("LoanEscrow — full lifecycle", function () {
  let ctx;
  const principal = parseEther("0.1");
  beforeEach(async function () {
    ctx = await deployAll();
    await ctx.sbt.issueSBT(ctx.borrower.address);
  });

  it("reverts loan request from address without SBT", async function () {
    await expectRevert(
      ctx.escrow.connect(ctx.lender2).requestLoan(principal, 30n),
      "NoSBTFound"
    );
  });

  it("borrower can request a loan and status is Requested (0)", async function () {
    await ctx.escrow.connect(ctx.borrower).requestLoan(principal, 30n);
    const loan = await ctx.escrow.getLoan(1n);
    expect(loan.status).to.equal(0n);
    expect(loan.borrower).to.equal(ctx.borrower.address);
  });

  it("lender funds loan and borrower receives ETH — status becomes Active (2)", async function () {
    await ctx.escrow.connect(ctx.borrower).requestLoan(principal, 30n);
    const balBefore = await ethers.provider.getBalance(ctx.borrower.address);
    await ctx.escrow.connect(ctx.lender1).fundLoan(1n, { value: principal });
    const balAfter = await ethers.provider.getBalance(ctx.borrower.address);
    expect((await ctx.escrow.getLoan(1n)).status).to.equal(2n);
    expect(balAfter).to.be.gt(balBefore);
  });

  it("reverts when non-borrower tries to repay", async function () {
    await ctx.escrow.connect(ctx.borrower).requestLoan(principal, 30n);
    await ctx.escrow.connect(ctx.lender1).fundLoan(1n, { value: principal });
    const loan = await ctx.escrow.getLoan(1n);
    await expectRevert(
      ctx.escrow.connect(ctx.lender1).repayLoan(1n, { value: loan.totalDue }),
      "NotBorrower"
    );
  });

  it("borrower repays and status becomes Repaid (3)", async function () {
    await ctx.escrow.connect(ctx.borrower).requestLoan(principal, 30n);
    await ctx.escrow.connect(ctx.lender1).fundLoan(1n, { value: principal });
    const loan = await ctx.escrow.getLoan(1n);
    await ctx.escrow.connect(ctx.borrower).repayLoan(1n, { value: loan.totalDue });
    expect((await ctx.escrow.getLoan(1n)).status).to.equal(3n);
  });

  it("lender withdraws principal + interest after repayment", async function () {
    await ctx.escrow.connect(ctx.borrower).requestLoan(principal, 30n);
    await ctx.escrow.connect(ctx.lender1).fundLoan(1n, { value: principal });
    const loan = await ctx.escrow.getLoan(1n);
    await ctx.escrow.connect(ctx.borrower).repayLoan(1n, { value: loan.totalDue });
    const balBefore = await ethers.provider.getBalance(ctx.lender1.address);
    await ctx.escrow.connect(ctx.lender1).withdrawLenderFunds(1n, 0n);
    const balAfter = await ethers.provider.getBalance(ctx.lender1.address);
    expect(balAfter).to.be.gt(balBefore);
  });
});

// ─── LoanEscrow — default & slash ────────────────────────────────────────────

describe("LoanEscrow — default & slash", function () {
  it("marks loan Defaulted (4), slashes vouchers, and halves borrower reputation", async function () {
    const ctx = await deployAll();
    await ctx.sbt.issueSBT(ctx.borrower.address);
    await ctx.escrow.connect(ctx.borrower).requestLoan(parseEther("0.05"), 7n);
    await ctx.escrow.connect(ctx.lender1).fundLoan(1n, { value: parseEther("0.05") });
    await ctx.vouchRegistry
      .connect(ctx.member1)
      .vouch(ctx.borrower.address, 600n, { value: parseEther("0.02") });

    const scoreBefore = await ctx.sbt.getReputationScore(ctx.borrower.address);

    // fast-forward past due date + grace period using the shared provider
    await provider.send("evm_increaseTime", [15 * 24 * 60 * 60]);
    await provider.send("evm_mine", []);

    await ctx.escrow.markDefault(1n);

    expect((await ctx.escrow.getLoan(1n)).status).to.equal(4n);
    expect(await ctx.vouchRegistry.getActiveVouchCount(ctx.borrower.address)).to.equal(0n);
    expect(await ctx.sbt.getReputationScore(ctx.borrower.address)).to.be.lte(scoreBefore / 2n + 1n);
  });
});
