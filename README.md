# ModalIn

Platform pinjaman mikro berbasis reputasi on-chain untuk UMKM Indonesia.  
Menggunakan Soulbound Token (SBT) sebagai identitas kredit, kelompok kredit (guild) untuk accountability bersama, dan peer vouching sebagai jaminan sosial.

---

## Prasyarat

Pastikan sudah terinstal:

- **Node.js** v18+ — [nodejs.org](https://nodejs.org)
- **npm** v9+ (ikut serta saat install Node.js)
- **MetaMask** — ekstensi browser untuk interaksi dengan jaringan lokal

---

## Cara Menjalankan (Mode Lokal)

### 1. Clone repo dan install dependencies

```bash
git clone https://github.com/calvinkatoroy/blockchain-modalin.git
cd blockchain-modalin

# Install dependencies smart contract
cd blockchain-modalin
npm install

# Install dependencies frontend
cd ../modalin-frontend
npm install
```

### 2. Jalankan node Hardhat lokal

Buka terminal baru, lalu dari folder `blockchain-modalin/`:

```bash
cd blockchain-modalin
npm run node
```

Ini akan menjalankan blockchain lokal di `http://127.0.0.1:8545` (Chain ID: 31337).  
Catat beberapa private key akun yang ditampilkan — gunakan untuk MetaMask.

### 3. Deploy smart contracts

Buka terminal baru (node Hardhat harus tetap berjalan), dari folder `blockchain-modalin/`:

```bash
cd blockchain-modalin
npm run deploy:local
```

Script akan men-deploy semua kontrak dan menyalin alamat ke `modalin-frontend/src/abis/contract-addresses.json`.

### 4. Jalankan frontend

Dari folder `modalin-frontend/`:

```bash
cd modalin-frontend
npm run dev
```

Buka browser di `http://localhost:3000`.

---

## Setup MetaMask

1. Tambahkan jaringan baru di MetaMask:
   - **Nama**: Hardhat Local
   - **RPC URL**: `http://127.0.0.1:8545`
   - **Chain ID**: `31337`
   - **Symbol**: ETH

2. Import akun dari private key yang ditampilkan saat `npm run node` — gunakan minimal 2 akun (satu peminjam, satu pendana).

---

## Alur Demo

### Pinjam & Bayar
1. Hubungkan dompet (Akun #0 sebagai peminjam) — SBT otomatis dibuat.
2. Tab **Pinjam** → isi jumlah dan durasi → klik **Ajukan Pinjaman**.
3. Pindah ke Akun #1 (pendana) → Tab **Danai** → pilih pinjaman → masukkan jumlah → klik **Danai**.
4. Kembali ke Akun #0 → pinjaman status berubah jadi **Berjalan** → klik **Bayar Sekarang**.
5. Akun #1 → Tab **Danai** → **Tarik Dana** untuk mengambil pokok + bunga.

### Kelompok Kredit (Guild)
1. Tab **Reputasi** → bagian **Kelompok Kredit**.
2. Isi nama kelompok → klik **Buat** (Akun #0 jadi founder).
3. Di Akun #1: masukkan ID kelompok yang dibuat → klik **Gabung**.
4. Setelah ada transaksi dan klik **Perbarui Skor**, tier kelompok akan naik sesuai skor kolektif.
   - Bronze: skor < 650
   - Silver: skor ≥ 650
   - Gold: skor ≥ 800

### Vouch
1. Tab **Reputasi** → bagian **Vouch Aktif**.
2. Masukkan alamat peminjam yang ingin dijamin dan jumlah ETH (min 0.001).
3. Klik **Vouch** — ETH di-stake sebagai jaminan sosial.
4. Skor vouch peminjam akan meningkat dan terlihat di komposit reputasi.

---

## Struktur Folder

```
blockchain-modalin/
├── blockchain-modalin/      # Hardhat project (smart contracts)
│   ├── contracts/           # 6 kontrak Solidity
│   ├── scripts/             # deploy.js, testRunner.js, demo.js
│   └── test/                # ModalIn.test.js
└── modalin-frontend/        # React + Vite frontend
    └── src/
        ├── App.tsx
        ├── types.ts
        └── services/
            └── contractService.ts
```

---

## Kontrak yang Di-deploy

| Kontrak | Fungsi |
|---|---|
| SoulboundToken | Identitas kredit non-transferable (SBT) |
| GuildSBT | Kelompok kredit dengan tier Bronze/Silver/Gold |
| VouchRegistry | Peer vouching dengan stake ETH |
| ReputationEngine | Kalkulasi skor komposit (payment 50% + vouch 30%) |
| InterestRateModel | APR dinamis berdasarkan reputasi dan tier grup |
| LoanEscrow | Mekanisme pinjam-meminjam (escrow P2P) |
