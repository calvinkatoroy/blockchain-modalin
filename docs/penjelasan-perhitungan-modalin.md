# Penjelasan Perhitungan ModalIn

Dokumen ini merangkum bagaimana skor reputasi, APR, bunga pinjaman, penalti default, dan distribusi dana dihitung pada implementasi smart contract ModalIn saat ini.

## 1. Alur besar sistem

Urutan logika utama:

1. Pengguna terhubung dengan wallet.
2. Jika belum punya SBT, frontend memanggil `selfRegister()` agar profil kredit dibuat otomatis.
3. Borrower mengajukan pinjaman.
4. `InterestRateModel` menghitung APR dan bunga berdasarkan reputasi dan grup.
5. Lender mendanai pinjaman.
6. Jika pinjaman lunas, lender menarik principal + bunga proporsional.
7. Jika pinjaman gagal bayar, vouch dislash dan skor reputasi borrower diturunkan.

## 2. Skor reputasi

Sumber: [ReputationEngine.sol](../blockchain-modalin/contracts/ReputationEngine.sol)

Skor reputasi akhir dihitung dengan rumus:

```text
Final Score = Raw Score - Decay Penalty
Raw Score = (50 * Payment Score + 30 * Vouch Score + 20 * Attest Score) / 100
```

Bobot default:

- Payment Score: 50%
- Vouch Score: 30%
- Attest Score: 20%

Semua skor menggunakan skala `0 - 1000`.

### 2.1 Payment Score

Payment score berasal dari repayment rate:

```text
Repayment Rate = (totalLoansRepaid * 100) / totalLoansBorrowed
Payment Score = Repayment Rate * 10
```

Catatan penting:

- Jika borrower belum pernah pinjam, `Repayment Rate = 100`.
- Artinya borrower baru langsung punya `Payment Score = 1000`.

Contoh:

- Belum pernah pinjam: repayment rate `100%` -> payment score `1000`
- 3 pinjaman, 2 lunas: repayment rate `66%` -> payment score `660`
- 5 pinjaman, 5 lunas: repayment rate `100%` -> payment score `1000`

### 2.2 Vouch Score

Sumber: [VouchRegistry.sol](../blockchain-modalin/contracts/VouchRegistry.sol)

Vouch score adalah rata-rata tertimbang berdasarkan stake:

```text
Vouch Score = sum(vouchScore * stakeAmount) / sum(stakeAmount)
```

Maknanya:

- Semakin besar stake seorang voucher, semakin besar pengaruhnya.
- Jika tidak ada vouch aktif, nilainya `0`.

Contoh 1:

- Voucher A: skor `800`, stake `1 ETH`
- Voucher B: skor `600`, stake `1 ETH`

```text
Vouch Score = (800*1 + 600*1) / (1+1) = 700
```

Contoh 2:

- Voucher A: skor `900`, stake `2 ETH`
- Voucher B: skor `500`, stake `1 ETH`

```text
Vouch Score = (900*2 + 500*1) / 3 = 766
```

### 2.3 Attest Score

`attestationScores[borrower]` disimpan di `ReputationEngine` dan hanya bisa diisi oleh oracle.

Rumusnya tidak diolah lagi; nilai ini langsung dipakai sebagai `Attest Score`.

Catatan penting untuk presentasi:

- Di frontend saat ini memang ada data mock attestations untuk tampilan.
- Tetapi skor attestasi yang benar-benar dipakai smart contract tetap `0` jika belum ada oracle yang memanggil `submitAttestationScore(...)`.

Jadi:

- UI attestations bisa terlihat ada.
- Tetapi `Attest Score` on-chain bisa tetap `0`.

### 2.4 Decay Penalty

Jika borrower tidak aktif lebih dari `180 hari`, skor akan berkurang:

```text
Decay Penalty = jumlah_periode_180_hari * 10
```

Contoh:

- Tidak aktif 200 hari -> penalty `10`
- Tidak aktif 370 hari -> penalty `20`

### 2.5 Contoh perhitungan reputasi

#### Skenario A: borrower baru, belum ada vouch, belum ada attest

- Payment Score = `1000`
- Vouch Score = `0`
- Attest Score = `0`

```text
Raw Score = (50*1000 + 30*0 + 20*0) / 100
          = 500
Final Score = 500
```

Ini cocok dengan desain awal SBT yang juga memulai skor di sekitar titik netral.

#### Skenario B: borrower sudah pernah lunas, ada vouch

- Payment Score = `1000`
- Vouch Score = `700`
- Attest Score = `0`

```text
Raw Score = (50*1000 + 30*700 + 20*0) / 100
          = (50000 + 21000) / 100
          = 710
Final Score = 710
```

#### Skenario C: borrower kuat di semua sisi

- Payment Score = `1000`
- Vouch Score = `800`
- Attest Score = `900`

```text
Raw Score = (50*1000 + 30*800 + 20*900) / 100
          = (50000 + 24000 + 18000) / 100
          = 920
Final Score = 920
```

#### Skenario D: skor bagus tapi tidak aktif lama

- Raw Score = `920`
- Tidak aktif `370 hari`
- Decay penalty = `20`

```text
Final Score = 920 - 20 = 900
```

## 3. Tier grup

Sumber: [GuildSBT.sol](../blockchain-modalin/contracts/GuildSBT.sol)

Tier grup ditentukan oleh `collectiveScore`:

- Bronze: `< 650`
- Silver: `650 - 799`
- Gold: `>= 800`

Skor grup biasanya diperbarui oleh `ReputationEngine` sebagai rata-rata skor reputasi anggota:

```text
Group Score = total skor reputasi semua anggota / jumlah anggota
```

Contoh:

- Anggota 1: `700`
- Anggota 2: `800`
- Anggota 3: `900`

```text
Group Score = (700 + 800 + 900) / 3 = 800
```

Maka tier grup = `Gold`.

## 4. Perhitungan APR

Sumber: [InterestRateModel.sol](../blockchain-modalin/contracts/InterestRateModel.sol)

Rumus APR:

```text
APR = Base Rate + Group Risk Premium - Reputation Discount
```

Semua satuan APR memakai basis points:

- `100 bps = 1%`
- `1200 bps = 12%`

Parameter default saat ini:

- Base Rate = `1200 bps` = `12%`
- Bronze / no group premium = `800 bps` = `8%`
- Silver premium = `400 bps` = `4%`
- Gold premium = `0 bps`
- Max reputation discount = `600 bps` = `6%`
- Min APR = `600 bps` = `6%`
- Max APR = `3600 bps` = `36%`

### 4.1 Reputation Discount

Diskon reputasi linear:

```text
Reputation Discount = (score * 600) / 1000
```

Contoh:

- Score `500` -> discount `300 bps` = `3%`
- Score `800` -> discount `480 bps` = `4.8%`
- Score `1000` -> discount `600 bps` = `6%`

### 4.2 Group Risk Premium

Aturan premium grup:

- Tidak punya grup -> dianggap risiko tertinggi -> `800 bps`
- Bronze -> `800 bps`
- Silver -> `400 bps`
- Gold -> `0 bps`

### 4.3 Contoh APR per skenario

#### Skenario A: borrower baru, belum punya grup, skor 500

- Base rate = `1200`
- Group premium = `800`
- Reputation discount = `(500 * 600) / 1000 = 300`

```text
APR = 1200 + 800 - 300 = 1700 bps = 17%
```

#### Skenario B: borrower skor 700, grup Silver

- Base rate = `1200`
- Group premium = `400`
- Reputation discount = `(700 * 600) / 1000 = 420`

```text
APR = 1200 + 400 - 420 = 1180 bps = 11.8%
```

#### Skenario C: borrower skor 900, grup Gold

- Base rate = `1200`
- Group premium = `0`
- Reputation discount = `(900 * 600) / 1000 = 540`

```text
APR = 1200 + 0 - 540 = 660 bps = 6.6%
```

#### Skenario D: borrower skor 1000, grup Gold

- Base rate = `1200`
- Group premium = `0`
- Reputation discount = `600`

```text
APR = 1200 - 600 = 600 bps = 6%
```

Ini tepat menyentuh `minAPR`.

## 5. Perhitungan bunga pinjaman

Sumber: [InterestRateModel.sol](../blockchain-modalin/contracts/InterestRateModel.sol)

Rumus bunga:

```text
Interest = principal * APR(bps) * durationDays / (365 * 10000)
```

Contoh:

- Principal = `1 ETH`
- APR = `1700 bps` = `17%`
- Durasi = `30 hari`

```text
Interest = 1 * 1700 * 30 / (365 * 10000)
         = 0.01397 ETH
```

Total tagihan:

```text
Total Due = Principal + Interest
          = 1 + 0.01397
          = 1.01397 ETH
```

Contoh lain:

- Principal = `0.5 ETH`
- APR = `1180 bps`
- Durasi = `60 hari`

```text
Interest = 0.5 * 1180 * 60 / (365 * 10000)
         = 0.009698 ETH
Total Due = 0.509698 ETH
```

## 6. Lifecycle pinjaman

Sumber: [LoanEscrow.sol](../blockchain-modalin/contracts/LoanEscrow.sol)

Status pinjaman:

1. `Requested`
2. `Funded`
3. `Active`
4. `Repaid`
5. `Defaulted`

### 6.1 Saat request loan

Kontrak langsung menghitung:

- APR borrower
- interest amount
- total due

Jadi angka pinjaman sudah “fixed” sejak awal request.

### 6.2 Saat fully funded

Ketika total dana lender sudah mencapai `principal`:

- loan jadi `Active`
- dana dikirim ke borrower
- `recordLoan()` dipanggil ke SBT
- jika borrower ada di grup, `recordGroupLoan()` dipanggil

## 7. Default dan penalti

Sumber: [LoanEscrow.sol](../blockchain-modalin/contracts/LoanEscrow.sol)

Pinjaman bisa di-default-kan jika:

```text
block.timestamp > dueDate + 7 hari
```

Saat default:

1. Semua voucher borrower di-slash.
2. Skor reputasi borrower dipotong setengah.
3. Jika borrower punya grup, skor grup dikurangi `100`.

### 7.1 Dampak default ke reputasi borrower

Rumus:

```text
newScore = currentScore / 2
```

Contoh:

- Score sebelum default `800`
- Score setelah default `400`

### 7.2 Dampak default ke grup

Rumus:

```text
newGroupScore = max(oldGroupScore - 100, 0)
```

Contoh:

- Group score `780` -> jadi `680`
- Group score `90` -> jadi `0`

### 7.3 Dampak default ke voucher

Semua stake voucher aktif di borrower tersebut menjadi `0` dan tidak bisa ditarik lagi.

Contoh:

- Voucher A stake `0.2 ETH`
- Voucher B stake `0.3 ETH`

Jika borrower default:

- stake A hilang
- stake B hilang

Ini adalah mekanisme social collateral.

## 8. Distribusi dana ke lender

Sumber: [LoanEscrow.sol](../blockchain-modalin/contracts/LoanEscrow.sol)

### 8.1 Jika pinjaman lunas

Platform fee:

```text
Platform Fee = interestAmount * 1%
```

Bunga yang dibagikan:

```text
Distributable Interest = interestAmount - platformFee
```

Bagian bunga per lender:

```text
Interest Share = distributableInterest * contribution / principal
Payout = contribution + interestShare
```

Contoh:

- Principal pinjaman `1 ETH`
- Interest total `0.1 ETH`
- Platform fee `1% dari interest = 0.001 ETH`
- Interest untuk lender = `0.099 ETH`

Lender A mendanai `0.6 ETH`, lender B `0.4 ETH`

Maka:

```text
Bagian A = 0.099 * 0.6 / 1 = 0.0594 ETH
Payout A = 0.6 + 0.0594 = 0.6594 ETH

Bagian B = 0.099 * 0.4 / 1 = 0.0396 ETH
Payout B = 0.4 + 0.0396 = 0.4396 ETH
```

### 8.2 Jika pinjaman default

Saat default, lender hanya menerima bagian proporsional dari dana yang sempat berhasil kembali:

```text
Payout = amountRepaid * contribution / principal
```

Contoh:

- Principal `1 ETH`
- Baru terbayar `0.25 ETH`
- Lender A kontribusi `0.6 ETH`
- Lender B kontribusi `0.4 ETH`

Maka:

```text
Payout A = 0.25 * 0.6 = 0.15 ETH
Payout B = 0.25 * 0.4 = 0.10 ETH
```

## 9. Penjelasan singkat yang aman untuk presentasi

Versi ringkas yang bisa dipakai:

1. Borrower otomatis dibuatkan Soulbound Token saat pertama connect jika belum punya profil.
2. Reputasi dihitung dari histori pembayaran, dukungan sosial melalui vouch, dan data attestasi.
3. Semakin baik reputasi dan tier grup, semakin rendah APR.
4. Jika borrower gagal bayar, bukan hanya borrower yang terkena dampak, tetapi juga para voucher dan grupnya.
5. Dengan begitu, sistem mendorong akuntabilitas individual dan kolektif.

## 10. Catatan implementasi saat ini

Beberapa hal yang penting disampaikan jujur saat demo:

- Borrower baru mendapatkan payment score tinggi karena repayment rate default untuk user tanpa histori adalah `100%`.
- Attestation yang tampil di frontend saat ini bersifat mock UI, belum otomatis menjadi skor attestasi on-chain.
- Tidak punya grup diperlakukan sama seperti tier Bronze untuk perhitungan premium risiko.
- Auto-register saat connect wallet memicu transaksi `selfRegister()` hanya jika akun belum punya SBT.

## 11. Skenario demo lengkap dari awal sampai akhir

Bagian ini adalah satu alur penuh yang bisa langsung kamu pakai saat presentasi.

Tujuan skenario ini:

1. Menunjukkan kondisi awal borrower baru.
2. Menunjukkan pinjaman pertama dan pelunasannya.
3. Menunjukkan apa yang berubah setelah reputasi dihitung ulang.
4. Menunjukkan pinjaman kedua dan kenapa APR bisa turun.

Supaya jelas, kita pakai asumsi berikut:

- Borrower baru saja connect dan otomatis mendapat SBT.
- Borrower belum punya grup.
- Borrower belum punya attest score on-chain.
- Borrower belum punya vouch aktif.
- Jadi kondisi awal ini benar-benar sama seperti tampilan aplikasi default saat pertama masuk.

### 11.1 Kondisi awal sebelum pinjam

Data awal borrower:

- Total loan borrowed = `0`
- Total loan repaid = `0`
- Attest score = `0`
- Vouch score = `0`
- Tidak punya grup -> premium grup = Bronze / no group

#### Langkah 1: hitung payment score awal

Karena borrower belum pernah pinjam, kontrak menganggap repayment rate = `100%`.

$$
\text{Repayment Rate} = 100
$$

$$
\text{Payment Score} = \text{Repayment Rate} \times 10
$$

$$
\text{Payment Score} = 100 \times 10 = 1000
$$

#### Langkah 2: hitung reputasi awal

Rumus reputasi:

$$
\text{Raw Score} =
\frac{
(50 \times \text{Payment Score}) +
(30 \times \text{Vouch Score}) +
(20 \times \text{Attest Score})
}{100}
$$

Substitusi:

$$
\text{Raw Score} =
\frac{
(50 \times 1000) +
(30 \times 0) +
(20 \times 0)
}{100}
$$

$$
\text{Raw Score} =
\frac{
50000 + 0 + 0
}{100}
= 500
$$

Karena belum ada decay:

$$
\text{Final Score} = 500
$$

Jadi sebelum pinjam:

- Reputation score borrower = `500`

#### Langkah 3: hitung APR awal

Rumus APR:

$$
\text{APR} = \text{Base Rate} + \text{Group Premium} - \text{Reputation Discount}
$$

Dengan:

- Base Rate = `1200` bps
- Group Premium = `800` bps karena tidak punya grup
- Reputation score = `500`

Rumus discount:

$$
\text{Reputation Discount} =
\frac{
\text{Score} \times 600
}{1000}
$$

Substitusi:

$$
\text{Reputation Discount} =
\frac{
500 \times 600
}{1000}
= 300
$$

Maka:

$$
\text{APR} = 1200 + 800 - 300 = 1700 \text{ bps}
$$

Konversi:

$$
1700 \text{ bps} = 17.00\%
$$

Jadi sebelum pinjaman pertama:

- Reputation score = `500`
- APR = `17.00%`

### 11.2 Pinjaman pertama

Sekarang borrower mengajukan pinjaman pertama:

- Principal = `1 ETH`
- Durasi = `30 hari`
- APR = `1700 bps`

#### Langkah 4: hitung bunga pinjaman pertama

Rumus bunga:

$$
\text{Interest} =
\frac{
\text{Principal} \times \text{APR} \times \text{Duration Days}
}{
365 \times 10000
}
$$

Substitusi:

$$
\text{Interest} =
\frac{
1 \times 1700 \times 30
}{
365 \times 10000
}
$$

$$
\text{Interest} =
\frac{51000}{3650000}
= 0.01397 \text{ ETH}
$$

#### Langkah 5: hitung total tagihan

$$
\text{Total Due} = \text{Principal} + \text{Interest}
$$

$$
\text{Total Due} = 1 + 0.01397 = 1.01397 \text{ ETH}
$$

Jadi pinjaman pertama:

- Pinjam `1 ETH`
- Bunga `0.01397 ETH`
- Total bayar `1.01397 ETH`

### 11.3 Saat pinjaman pertama aktif

Ketika pinjaman fully funded lalu masuk status `Active`, kontrak memanggil:

- `recordLoan(borrower, principal)`

Akibatnya profil borrower berubah:

- `totalLoansBorrowed` naik dari `0` menjadi `1`
- `totalAmountBorrowed` naik dari `0` menjadi `1 ETH`

Tetapi:

- `totalLoansRepaid` masih `0`
- reputasi belum otomatis berubah kalau belum dipanggil `recalculateScore()`

Ini penting saat presentasi:

- Setelah pinjaman dibuat aktif, histori pinjaman bertambah.
- Namun skor akhir biasanya baru terlihat berubah setelah fungsi recalculation dijalankan.

### 11.4 Saat pinjaman pertama dilunasi

Borrower membayar penuh:

$$
1.01279 \text{ ETH}
$$

Kontrak lalu memanggil:

- `recordRepayment(borrower, principal)`

Akibatnya profil berubah:

- `totalLoansBorrowed = 1`
- `totalLoansRepaid = 1`
- `totalAmountBorrowed = 1 ETH`
- `totalAmountRepaid = 1 ETH`

Catatan penting:

- Yang dicatat ke SBT untuk repayment adalah `principal`, bukan `principal + interest`.
- Jadi histori repayment di profil dipakai untuk reputasi, bukan untuk menghitung total bunga lender.

### 11.5 Reputasi setelah pinjaman pertama lunas

Sekarang kita hitung ulang skor reputasi.

#### Langkah 6: hitung repayment rate baru

$$
\text{Repayment Rate} =
\frac{
\text{totalLoansRepaid} \times 100
}{
\text{totalLoansBorrowed}
}
$$

Substitusi:

$$
\text{Repayment Rate} =
\frac{
1 \times 100
}{1}
= 100
$$

#### Langkah 7: hitung payment score baru

$$
\text{Payment Score} = 100 \times 10 = 1000
$$

Ternyata tetap `1000`.

Ini juga penting saat presentasi:

- Karena pinjaman pertama lunas penuh, borrower tetap punya histori pembayaran sempurna.
- Jadi payment score tidak turun, tetap maksimum.

#### Langkah 8: hitung reputasi baru

Karena vouch score dan attest score belum berubah:

- Payment Score = `1000`
- Vouch Score = `0`
- Attest Score = `0`

Maka:

$$
\text{Raw Score} =
\frac{
(50 \times 1000) +
(30 \times 0) +
(20 \times 0)
}{100}
= 500
$$

Jadi hasilnya tetap:

$$
\text{Final Score} = 500
$$

Kesimpulan penting:

- Pada skenario ini, setelah pinjaman pertama lunas, skor tidak naik karena dari awal payment score sudah maksimum.
- Artinya sistem saat ini lebih terasa berubah jika ada perubahan di:
  - vouch score,
  - attest score,
  - grup,
  - atau jika borrower mengalami gagal bayar.

### 11.6 Pinjaman kedua setelah borrower bergabung ke grup Silver

Agar presentasi kamu menarik dan terlihat ada perubahan angka yang nyata, kita lanjutkan dengan satu perubahan tambahan yang memang berpengaruh besar:

- Setelah pinjaman pertama lunas, borrower bergabung ke grup dengan tier `Silver`.

Dalam implementasi saat ini, perubahan tier grup memengaruhi APR melalui `Group Premium`.

Sebelumnya:

- No group premium = `800 bps`

Sekarang:

- Silver premium = `400 bps`

Reputation score tetap `500`, jadi discount tetap:

$$
\text{Reputation Discount} =
\frac{
500 \times 600
}{1000}
= 300
$$

#### Langkah 9: hitung APR pinjaman kedua

$$
\text{APR Baru} = 1200 + 400 - 300
$$

$$
\text{APR Baru} = 1300 \text{ bps} = 13.00\%
$$

Bandingkan:

- APR pertama = `17.00%`
- APR kedua = `13.00%`

Penurunan APR:

$$
17.00\% - 13.00\% = 4\%
$$

Atau setara:

$$
1700 \text{ bps} - 1300 \text{ bps} = 400 \text{ bps}
$$

Jadi penurunan ini murni karena borrower sekarang ada di grup Silver.

### 11.7 Pinjaman kedua

Sekarang borrower mengajukan pinjaman kedua:

- Principal = `1.5 ETH`
- Durasi = `60 hari`
- APR = `1300 bps`

#### Langkah 10: hitung bunga pinjaman kedua

$$
\text{Interest} =
\frac{
1.5 \times 1300 \times 60
}{
365 \times 10000
}
$$

$$
\text{Interest} =
\frac{117000}{3650000}
= 0.03205 \text{ ETH}
$$

#### Langkah 11: hitung total tagihan pinjaman kedua

$$
\text{Total Due} = 1.5 + 0.03205 = 1.53205 \text{ ETH}
$$

Jadi pinjaman kedua:

- Pinjam `1.5 ETH`
- Bunga `0.03205 ETH`
- Total bayar `1.53205 ETH`

### 11.8 Apa yang berubah dari pinjaman pertama ke pinjaman kedua

#### Sebelum pinjaman pertama

- Reputation score = `500`
- APR = `17.00%`
- Principal = `1 ETH`
- Duration = `30 hari`
- Interest = `0.01397 ETH`
- Total due = `1.01397 ETH`

#### Sebelum pinjaman kedua

- Reputation score = `500`
- Grup berubah menjadi `Silver`
- APR turun jadi `13.00%`
- Principal = `1.5 ETH`
- Duration = `60 hari`
- Interest = `0.03205 ETH`
- Total due = `1.53205 ETH`

### 11.9 Narasi presentasi yang bisa langsung dipakai

Kamu bisa menjelaskan seperti ini:

1. Awalnya borrower baru connect dan otomatis mendapat SBT.
2. Karena borrower belum punya histori, payment score langsung 1000, tetapi karena belum ada vouch dan attest score maka reputasi awalnya tetap 500.
3. Karena borrower belum punya grup, premium risikonya tinggi, sehingga APR pinjaman pertama adalah 17.00%.
4. Borrower meminjam 1 ETH selama 30 hari, sehingga total bunganya 0.01397 ETH.
5. Setelah pinjaman lunas, histori pembayaran borrower menjadi 1 dari 1, jadi payment score tetap sempurna.
6. Namun skor total belum naik karena dari awal payment score memang sudah maksimum dan belum ada perubahan attest score.
7. Setelah borrower masuk grup Silver, premium risiko turun 400 bps.
8. Akibatnya APR pinjaman kedua turun dari 17.00% menjadi 13.00%.
9. Ini menunjukkan bahwa di sistem ini, grup dan reputasi sosial benar-benar memengaruhi biaya pinjaman.

### 11.10 Jika kamu ingin demo angka yang benar-benar naik di reputasi

Pada implementasi sekarang, skor reputasi paling mudah berubah naik jika:

1. Ada `attest score` on-chain yang di-submit oracle.
2. Vouch score meningkat.
3. Borrower bergabung ke grup yang lebih sehat, lalu reputasi grup ikut diperbarui.

Contoh cepat:

Jika setelah pinjaman pertama lunas borrower mendapat `attest score = 500`, maka:

$$
\text{Raw Score Baru} =
\frac{
(50 \times 1000) +
(30 \times 0) +
(20 \times 500)
}{100}
$$

$$
\text{Raw Score Baru} =
\frac{
50000 + 0 + 10000
}{100}
= 600
$$

Maka reputation score naik:

- Dari `500`
- Menjadi `600`

Discount reputasi juga naik:

$$
\text{Discount Baru} =
\frac{
600 \times 600
}{1000}
= 360
$$

Kalau borrower masih di grup Silver:

$$
\text{APR} = 1200 + 400 - 360 = 1240 \text{ bps}
$$

$$
1240 \text{ bps} = 12.40\%
$$

Ini bisa jadi penutup presentasi yang bagus:

- histori pembayaran menjaga skor tetap sehat,
- attest score menaikkan reputasi,
- dan APR turun lebih jauh sebagai insentif.

### 11.11 Checklist demo yang benar-benar sesuai aplikasi saat ini

Kalau kamu ingin mencoba persis seperti sistem yang ada sekarang, urutan paling aman adalah:

1. Connect sebagai borrower baru.
2. Pastikan skor awal `500` dan APR awal `17.00%`.
3. Ajukan pinjaman `1 ETH` selama `30 hari`.
4. Danai pinjaman dari akun lender sampai status aktif.
5. Lakukan repayment penuh.
6. Klik `Perbarui Skor` dan lihat bahwa skor tetap `500`.
7. Masuk ke grup `Silver` secara manual.
8. Ajukan pinjaman kedua `1.5 ETH` selama `60 hari`.
9. Periksa bahwa APR turun menjadi `13.00%`.

Kalau ingin demo skor reputasi benar-benar naik:

1. Tambahkan `attest score` on-chain.
2. Atau tambahkan vouch aktif.
3. Lalu klik `Perbarui Skor`.
