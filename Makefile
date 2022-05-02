codegen:
	graph codegen $(subgraph)/subgraph.yaml -o $(subgraph)/generated

build:
	graph build $(subgraph)/subgraph.yaml -o $(subgraph)/build

deploy:
	graph deploy $(subgraph-name) $(subgraph)/subgraph.yaml --node https://api.thegraph.com/deploy/
