# Compound Fork Subgraph

## Development

codegen

```
subgraph=moonwell make codegen
```

build

```
subgraph=moonwell make build
```

deploy

```
subgraph-name=0xbe1/moonwell-subgraph subgraph=moonwell make deploy
```

## Project Layout

### schema.graphql

Shared schema for all Compound forks.

### abis

Standard Compound abis.

### src

Shared logic among the forks.

### queries

Useful queries to run against a Compound fork subgraph.

### bastionprotocol/moonwell/etc

Protocol-specific subgraph definition, abis and implementations.

**Notice**: Some forks have different abis from Compound. For example, Moonwell:

1. renames cToken to mToken
1. rename supplyRatePerBlock to supplyRatePerTimestamp

Since cToken -> mToken is nothing more than a naming change, we keep using abis/Comptroller.json.

However, supplyRatePerBlock -> supplyRatePerTimestamp is actually a implementation change, so we use the specific CToken abi for moonwell.

That's why in moonwell/subgraph.yaml, we have below (note the dots!):

```yaml
- name: Comptroller
    file: ../abis/Comptroller.json
- name: CToken
    file: ./abis/CToken.json
```
