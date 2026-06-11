## Run Besu 26.6.0 from Docker to generate key pairs and genesis  
```
docker run --rm -v $(pwd)/network:/opt/besu/data hyperledger/besu:26.6.0 operator generate-blockchain-config --config-file=/opt/besu/data/qbftConfigFile.json --to=/opt/besu/data/networkFiles --private-key-file-name=key
```  

## Run Besu 26.6.0 to generate extra data  
```
docker run --rm -v ${PWD}/network/dc1:/data hyperledger/besu:26.6.0 rlp encode --from=/data/dc1-validator-nodes.json --type=QBFT_EXTRA_DATA
```  

## Create external network  
```
docker network create --driver bridge --subnet 172.22.0.0/16 besu-shared
```  
