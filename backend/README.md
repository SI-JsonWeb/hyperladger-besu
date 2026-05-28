# NestJS Backend for DoubleFinancingPreventer

This backend is a small NestJS REST API for integrating with the Besu/Quorum `DoubleFinancingPreventer` smart contract.

## Layout

```text
src/main.ts                     HTTP entrypoint
src/config                      Environment and deployment-file config
src/blockchain                  ethers contract adapter
src/assets                      REST handlers and application service
```

## Install

```bash
npm install
```

The backend reads the ABI from `../smart_contracts/contracts/DoubleFinancingPreventer.json`.

## Build

```bash
make build
```

## Run

Start the Quorum network first, then provide a signer key:

```bash
export PRIVATE_KEY=replace-with-dev-private-key
make run
```

If `CONTRACT_ADDRESS` is not set, the backend reads `../smart_contracts/deployments/deployment.json`.

## Example Requests

```bash
curl http://localhost:8080/health
```

```bash
curl -X POST http://localhost:8080/assets \
  -H 'Content-Type: application/json' \
  --data '{"assetId":"1001"}'
```

```bash
curl http://localhost:8080/assets/1001
```

```bash
curl -X POST http://localhost:8080/assets/1001/financing \
  -H 'Content-Type: application/json' \
  --data '{"amountWei":"500000000000000000000"}'
```

```bash
curl http://localhost:8080/accounts/flagged
```
