codegen:
	yarn codegen $(subgraph)/subgraph.yaml -o $(subgraph)/generated

build:
	yarn build $(subgraph)/subgraph.yaml -o $(subgraph)/build
