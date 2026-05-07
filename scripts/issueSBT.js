import hre from "hardhat";
import { ethers } from "ethers";

async function main() {
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const deployer = await provider.getSigner(0);

  // Address SBT dari deploy tadi
  const artifact = await hre.artifacts.readArtifact("SoulboundToken");
  const sbt = new ethers.Contract(
    "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    artifact.abi,
    deployer
  );

  // Address wallet MetaMask kamu (akun Hardhat #0)
  const target = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  const alreadyHas = await sbt.hasSBT(target);
  if (alreadyHas) {
    console.log(" Wallet ini sudah punya SBT!");
    return;
  }

  const tx = await sbt.issueSBT(target);
  await tx.wait();
  console.log(" SBT berhasil di-issue ke:", target);
  console.log(" Reputation score:", (await sbt.getReputationScore(target)).toString());
}

main().catch(console.error);