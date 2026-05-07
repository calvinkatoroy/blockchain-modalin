// scripts/deploy.js
import hre from "hardhat";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const deployer = await provider.getSigner(0);

  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await provider.getBalance(deployer.address)), "ETH");

  // Helper: deploy contract by name
  async function deployContract(name, ...args) {
    const artifact = await hre.artifacts.readArtifact(name);
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    return contract;
  }

  // 1. Deploy SoulboundToken
  console.log("\n[1/6] Deploying SoulboundToken...");
  const sbt = await deployContract("SoulboundToken");
  console.log("  SoulboundToken deployed to:", await sbt.getAddress());

  // 2. Deploy GuildSBT
  console.log("[2/6] Deploying GuildSBT...");
  const guild = await deployContract("GuildSBT");
  console.log("  GuildSBT deployed to:", await guild.getAddress());

  // 3. Deploy VouchRegistry
  console.log("[3/6] Deploying VouchRegistry...");
  const vouchRegistry = await deployContract("VouchRegistry");
  console.log("  VouchRegistry deployed to:", await vouchRegistry.getAddress());

  // 4. Deploy ReputationEngine
  console.log("[4/6] Deploying ReputationEngine...");
  const repEngine = await deployContract(
    "ReputationEngine",
    await sbt.getAddress(),
    await guild.getAddress(),
    await vouchRegistry.getAddress()
  );
  console.log("  ReputationEngine deployed to:", await repEngine.getAddress());

  // 5. Deploy InterestRateModel
  console.log("[5/6] Deploying InterestRateModel...");
  const rateModel = await deployContract(
    "InterestRateModel",
    await sbt.getAddress(),
    await guild.getAddress()
  );
  console.log("  InterestRateModel deployed to:", await rateModel.getAddress());

  // 6. Deploy LoanEscrow
  console.log("[6/6] Deploying LoanEscrow...");
  const escrow = await deployContract(
    "LoanEscrow",
    await sbt.getAddress(),
    await guild.getAddress(),
    await rateModel.getAddress(),
    await vouchRegistry.getAddress()
  );
  console.log("  LoanEscrow deployed to:", await escrow.getAddress());

  // Wire up permissions
  console.log("\n[Setup] Wiring contract permissions...");
  await sbt.setAuthorizedUpdater(await repEngine.getAddress(), true);
  await sbt.setAuthorizedUpdater(await escrow.getAddress(), true);
  console.log("  SoulboundToken: authorized ReputationEngine + LoanEscrow");

  await guild.setAuthorizedUpdater(await repEngine.getAddress(), true);
  await guild.setAuthorizedUpdater(await escrow.getAddress(), true);
  console.log("  GuildSBT: authorized ReputationEngine + LoanEscrow");

  await vouchRegistry.setLoanEscrow(await escrow.getAddress());
  console.log("  VouchRegistry: LoanEscrow set as slasher");

  await sbt.setAuthorizedUpdater(deployer.address, true);
  console.log("  SoulboundToken: deployer authorized as issuer");

  console.log("\n=== Deployment Complete ===");
  const deployedAddresses = {
    SoulboundToken: await sbt.getAddress(),
    GuildSBT: await guild.getAddress(),
    VouchRegistry: await vouchRegistry.getAddress(),
    ReputationEngine: await repEngine.getAddress(),
    InterestRateModel: await rateModel.getAddress(),
    LoanEscrow: await escrow.getAddress(),
  };
  console.log(deployedAddresses);

  // Export ABI and Addresses to Frontend
  const frontendAbisDir = path.join(__dirname, "../../modalin-frontend/src/abis");
  if (!fs.existsSync(frontendAbisDir)) {
    fs.mkdirSync(frontendAbisDir, { recursive: true });
  }

  const contractNames = [
    "SoulboundToken", 
    "GuildSBT", 
    "VouchRegistry", 
    "ReputationEngine", 
    "InterestRateModel", 
    "LoanEscrow"
  ];

  for (const name of contractNames) {
    const artifact = await hre.artifacts.readArtifact(name);
    fs.writeFileSync(
      path.join(frontendAbisDir, `${name}.json`),
      JSON.stringify(artifact.abi, null, 2)
    );
  }

  fs.writeFileSync(
    path.join(frontendAbisDir, "contract-addresses.json"),
    JSON.stringify(deployedAddresses, null, 2)
  );

  console.log(`\n Contract ABIs and Addresses exported to ${frontendAbisDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});