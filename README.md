# WebSocket vs WebRTC Comparison Tool

WebSocket と WebRTC (DataChannel) の通信遅延（RTT）とパケットロス耐性を比較するためのハイパフォーマンス・ベンチマークツールです。
サーバーサイドは C++ で実装されており、**uWebSockets** と **libdatachannel** を採用することで、言語ランタイムのオーバーヘッドを極限まで排除しています。

## 特徴
- **High Performance C++ Server**: `uWebSockets` (WebSocket) と `libdatachannel` (WebRTC) を使用した超低遅延実装。
- **Real-time Visualization**: Chart.js を使用してパケット毎のRTTをリアルタイムにグラフ化。
- **Unreliable Mode Support**: WebRTCの強みである非高信頼（Unreliable/Unordered）モードの挙動検証が可能。
- **Detailed Stats**: 平均値、中央値、送信済み/受信済みパケット数のリアルタイム表示。
- **Backpressure Control**: パケット詰まり発生時に送信をドロップするバックプレッシャー制御機能（オプション）。

## 必要要件 (Requirements)

- **OS**: Linux (Ubuntu 22.04 推奨)
- **Build Tools**: CMake (3.16+), GCC/Clang (C++17 support)
- **Libraries**:
    - OpenSSL (`libssl-dev`)
    - ZLib (`zlib1g-dev`)
    - Python 3 (SSL証明書生成用)

## セットアップ & ビルド手順

### 1. 依存パッケージのインストール
Ubuntu/Debian系の場合:
```bash
sudo apt update
sudo apt install build-essential cmake libssl-dev zlib1g-dev python3
```

### 2. リポジトリのクローン
```bash
git clone git@github.com:Raptor-zip/WebSocket-VS-WebRTC.git
cd WebSocket-VS-WebRTC
```

### 3. SSL証明書の生成
HTTPS/WSS および WebRTC の通信には SSL/TLS が必須です。以下のスクリプトで自己署名証明書を生成します。
```bash
python3 generate_cert.py
# -> cert.pem と key.pem が生成されます
```

### 4. C++サーバーのビルド
`uWebSockets` および `libdatachannel` は、CMake の `FetchContent` 機能により**ビルド時に自動的にダウンロード・コンパイルされます**。別途インストールする必要はありません。初めてのビルドには数分かかります。

```bash
cd cpp_server
mkdir build
cd build
cmake ..
cmake --build . -j4
```

## 実行方法

### サーバー起動
ビルドした実行ファイルを起動します。

```bash
# cpp_server/build ディレクトリ内で
./server
```

**オプション:**
- `--backpressure`: バックプレッシャー制御を有効にします。ネットワーク帯域が詰まった際（バッファが32KBを超えた際）に、古いパケットの再送待ちによる遅延増大を防ぐため、新規パケットの送信をドロップします。
  ```bash
  ./server --backpressure
  ```

### クライアント接続
PCまたはスマホのモダンブラウザ（Chrome推奨）で以下にアクセスします。
```
https://<サーバーのIPアドレス>:8080/
```
※ ローカルで試す場合は `https://localhost:8080/`
※ 自己署名証明書を使用しているため、初回アクセス時にセキュリティ警告が表示されます。「詳細設定」→「...にアクセスする（安全ではありません）」を選択して進んでください。

## ネットワーク遅延・ロスのシミュレーション (Linux)
`tc` (Traffic Control) コマンドを使用することで、人工的にパケットロスや遅延を発生させ、プロトコルごとの耐性をテストできます。

**インターフェース名の確認:**
```bash
ip link
# 例: wlp4s0, eth0, lo など
```

**遅延 10ms, パケットロス 1% を追加:**
```bash
sudo tc qdisc add dev wlp4s0 root netem delay 10ms loss 1%
```

**設定の変更 (ロス率を 10% に変更):**
```bash
sudo tc qdisc change dev wlp4s0 root netem loss 10%
```

**設定の削除 (元に戻す):**
```bash
sudo tc qdisc del dev wlp4s0 root
```
