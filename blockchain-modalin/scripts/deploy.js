// scripts/deploy.js

import hre from "hardhat";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import "dotenv/config";

// Setup path untuk ES Module (menggantikan __dirname di CommonJS)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  let deployer;
  if (process.env.PRIVATE_KEY) {
    deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  } else {
    deployer = await provider.getSigner(0);
  }

  console.log("Deploying contracts with account:", deployer.address);
  console.log(
    "Account balance:",
    ethers.formatEther(await provider.getBalance(deployer.address)),
    "ETH"
  );

  async function deployContract(name, ...args) {
    const artifact = await hre.artifacts.readArtifact(name);
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    return contract;
  }

  // =========================
  // 1. Deploy Smart Contracts
  // =========================

  console.log("\n[1/6] Deploying SoulboundToken...");
  const sbt = await deployContract("SoulboundToken");
  console.log("  Deployed at:", await sbt.getAddress());

  console.log("[2/6] Deploying GuildSBT...");
  const guild = await deployContract("GuildSBT");
  console.log("  Deployed at:", await guild.getAddress());

  console.log("[3/6] Deploying VouchRegistry...");
  const vouchRegistry = await deployContract("VouchRegistry");
  console.log("  Deployed at:", await vouchRegistry.getAddress());

  console.log("[4/6] Deploying ReputationEngine...");
  const repEngine = await deployContract(
    "ReputationEngine",
    await sbt.getAddress(),
    await guild.getAddress(),
    await vouchRegistry.getAddress()
  );
  console.log("  Deployed at:", await repEngine.getAddress());

  console.log("[5/6] Deploying InterestRateModel...");
  const rateModel = await deployContract(
    "InterestRateModel",
    await sbt.getAddress(),
    await guild.getAddress()
  );
  console.log("  Deployed at:", await rateModel.getAddress());

  console.log("[6/6] Deploying LoanEscrow...");
  const escrow = await deployContract(
    "LoanEscrow",
    await sbt.getAddress(),
    await guild.getAddress(),
    await rateModel.getAddress(),
    await vouchRegistry.getAddress()
  );
  console.log("  Deployed at:", await escrow.getAddress());

  // =========================
  // 2. Setup koneksi antar contract (permissions & dependencies)
  // =========================

  console.log("\n[Setup] Configuring contract permissions...");

  // Izinkan contract tertentu untuk update data SoulboundToken
  await sbt.setAuthorizedUpdater(await repEngine.getAddress(), true);
  await sbt.setAuthorizedUpdater(await escrow.getAddress(), true);

  // Izinkan contract tertentu untuk update GuildSBT
  await guild.setAuthorizedUpdater(await repEngine.getAddress(), true);
  await guild.setAuthorizedUpdater(await escrow.getAddress(), true);

  // Set LoanEscrow sebagai kontrak utama di VouchRegistry
  await vouchRegistry.setLoanEscrow(await escrow.getAddress());

  // Deployer juga diberi akses sebagai issuer awal
  await sbt.setAuthorizedUpdater(deployer.address, true);

  // Redistribusi weight: hapus attestasi (butuh oracle), fokus payment + vouch
  // Payment 70% + Vouch 30% = 100% → score bisa naik dari repayment saja
  await repEngine.setWeights(70, 30, 0);

  console.log("Permissions setup completed");

  // =========================
  // 3. Simpan hasil deployment
  // =========================

  const deployedAddresses = {
    SoulboundToken: await sbt.getAddress(),
    GuildSBT: await guild.getAddress(),
    VouchRegistry: await vouchRegistry.getAddress(),
    ReputationEngine: await repEngine.getAddress(),
    InterestRateModel: await rateModel.getAddress(),
    LoanEscrow: await escrow.getAddress(),
  };

  console.log("\nDeployment Complete:");
  console.log(deployedAddresses);

  // =========================
  // 4. Export ABI + Address ke frontend
  // =========================

  // Folder tujuan di frontend
  const frontendAbisDir = path.join(
    __dirname,
    "../../modalin-frontend/src/abis"
  );

  // Buat folder jika belum ada
  if (!fs.existsSync(frontendAbisDir)) {
    fs.mkdirSync(frontendAbisDir, { recursive: true });
  }

  // List semua contract untuk export ABI
  const contractNames = [
    "SoulboundToken",
    "GuildSBT",
    "VouchRegistry",
    "ReputationEngine",
    "InterestRateModel",
    "LoanEscrow",
  ];

  // Simpan ABI masing-masing contract ke file JSON
  for (const name of contractNames) {
    const artifact = await hre.artifacts.readArtifact(name);

    fs.writeFileSync(
      path.join(frontendAbisDir, `${name}.json`),
      JSON.stringify(artifact.abi, null, 2)
    );
  }

  // Simpan address semua contract ke satu file
  fs.writeFileSync(
    path.join(frontendAbisDir, "contract-addresses.json"),
    JSON.stringify(deployedAddresses, null, 2)
  );

  console.log(
    `\nABI dan contract address berhasil diekspor ke: ${frontendAbisDir}`
  );
}

// Error handling jika deployment gagal
main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});