# Archive Standby Validator Implementation

This document records the archive standby validator experiment implemented on top of the static-peer disaster recovery lab.

## Branch And Commit Baseline

The previous lab was committed before this experiment:

```text
34c67ba Replace admin peer management with static peers
```

The archive standby validator work was then implemented on:

```text
archive-standby-validators
```

## Design Summary

The network now has validators and archive/read nodes in both simulated data centers.

Normal mode:

```text
DC1:
  V1  besu-dc1-node1       validator       RPC 8545
  V2  besu-dc1-node2       validator       RPC 8546
  A1  besu-dc1-archive1    archive/read    RPC 8551
  A2  besu-dc1-archive2    archive/read    RPC 8552

DC2:
  V3  besu-dc2-node3       validator       RPC 8547
  V4  besu-dc2-node4       validator       RPC 8548
  A3  besu-dc2-archive3    archive/read    RPC 8553
  A4  besu-dc2-archive4    archive/read    RPC 8554
```

Failover mode when DC1 is down:

```text
DC2:
  V3  besu-dc2-node3       validator, key V3
  V4  besu-dc2-node4       validator, key V4
  A3  besu-dc2-archive3    validator, key V1
  A4  besu-dc2-archive4    validator, key V2
```

`A3` and `A4` keep their own RPC ports during promotion. They do not take `V1` or `V2` ports.

## Key Safety Rule

These pairs must not run together:

```text
besu-dc1-node1 and besu-dc2-archive3 using the V1 key
besu-dc1-node2 and besu-dc2-archive4 using the V2 key
```

The risk is duplicate QBFT validator identity, not Docker port conflict.

## Archive Storage

Archive nodes use:

```text
--sync-mode=FULL
--data-storage-format=FOREST
```

`FOREST` was chosen because these nodes are intended for archive/read behavior. `A3` and `A4` reuse the same persistent data volumes when switching between archive mode and validator mode.

## RPC API Modes

Archive/read mode:

```text
ETH,NET,WEB3
```

Validator mode:

```text
ETH,NET,QBFT,WEB3
```

`ADMIN` remains disabled everywhere. The implementation does not use `admin_addPeer`.

## Static Peers

All nodes use static peer files:

```text
--static-nodes-file=/opt/besu/static-nodes.json
```

New static peer directories were added for archive mode and promoted-validator mode:

```text
network/static-peers/dc1-archive1/static-nodes.json
network/static-peers/dc1-archive2/static-nodes.json
network/static-peers/dc2-archive3-archive/static-nodes.json
network/static-peers/dc2-archive4-archive/static-nodes.json
network/static-peers/dc2-archive3-validator/static-nodes.json
network/static-peers/dc2-archive4-validator/static-nodes.json
```

`A3` and `A4` need separate static peer files for archive mode and validator mode because their enode identity changes when their private key changes.

## Ansible Behavior

The main controller is:

```text
network/ansible/playbooks/failover.yml
```

Failover flow:

1. Check DC1 RPC on `localhost:8545`.
2. If DC1 is down, inspect `A3` and `A4` mode labels.
3. Stop `besu-dc1-node1` and `besu-dc1-node2`.
4. Remove archive-mode `A3` and `A4` containers.
5. Recreate `A3` with the `V1` key and validator APIs.
6. Recreate `A4` with the `V2` key and validator APIs.
7. Wait for RPC ports `8553` and `8554`.
8. Log the failover event.

Failback flow:

1. Detect both DC1 validator RPC endpoints are back.
2. Remove validator-mode `A3` and `A4` containers.
3. Start `V1` and `V2` through DC1 Docker Compose.
4. Start `A3` and `A4` through DC2 Docker Compose so they return to archive/read mode.
5. Wait for RPC endpoints.
6. Log the handback event.

Partial DC1 recovery is treated as still failed. For example, if `V2` wakes up but `V1` is still down, the controller keeps failover mode active and stops both DC1 validators. This prevents `V2` and `A4-as-V2` from running with the same validator key at the same time.

The mode labels are:

```text
besu.dr.mode=archive
besu.dr.mode=validator
```

These labels make repeated cron runs idempotent.

## Cron

Cron was paused during the container redesign and restored after verification.

Current cron entry:

```cron
* * * * * cd /home/webbacillus/10_projects/05_hyperladger_besu/hyperladger-besu/network && LC_ALL=C.utf8 LANG=C.utf8 /home/webbacillus/.local/bin/ansible-playbook ansible/playbooks/failover.yml -i ansible/inventory.yml >> /tmp/besu-failover.log 2>&1
```

## Verification Performed

Static verification:

```text
docker compose config       passed for DC1
docker compose config       passed for DC2
ansible-playbook --syntax-check passed
grep for ADMIN/admin_addPeer found no matches in ansible, dc1, or dc2
```

Normal mode verification:

```text
V1-V4 healthy
A1-A4 healthy
A3/A4 mode labels are archive
A3 QBFT method returns Method not enabled
ADMIN method returns Method not enabled
healthy Ansible controller run makes zero changes
```

Failover verification:

```text
DC1 stopped
A3 and A4 promoted to validator mode
A3/A4 mode labels are validator
A3/A4 have 3 peers
QBFT API is enabled on promoted A3/A4
ADMIN remains disabled
blocks advanced while DC1 was down
```

Failback verification:

```text
DC1 restarted
A3/A4 validator containers removed
A3/A4 restarted in archive mode
QBFT disabled again on A3/A4
healthy Ansible controller run makes zero changes
cron restored
```

## Current Observed Runtime State

At the time of the latest manual status check, the network was in failover mode:

```text
besu-dc1-node1       stopped
besu-dc1-node2       stopped
besu-dc2-node3       running
besu-dc2-node4       running
besu-dc2-archive3    running, validator mode
besu-dc2-archive4    running, validator mode
```

The validator query failed on `localhost:8545` because `V1` was stopped. The same query worked on `A3` at port `8553`.

Block height observed from `V3`:

```text
0x323c
```

Peer count observed from `V3`:

```text
0x5
```

## Useful Commands

Check validators from `V1` when DC1 is up:

```bash
curl -s -X POST http://localhost:8545 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":1}'
```

Check validators from promoted `A3` during failover:

```bash
curl -s -X POST http://localhost:8553 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":1}'
```

Check A3/A4 mode labels:

```bash
docker inspect -f '{{ index .Config.Labels "besu.dr.mode" }}' besu-dc2-archive3
docker inspect -f '{{ index .Config.Labels "besu.dr.mode" }}' besu-dc2-archive4
```

Run the controller manually:

```bash
LC_ALL=C.utf8 LANG=C.utf8 /home/webbacillus/.local/bin/ansible-playbook ansible/playbooks/failover.yml -i ansible/inventory.yml
```
