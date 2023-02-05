#!/bin/bash

docker buildx use --default default
npm run build
docker build -t orbsnetworkstaging/vm-lambda:$(cat .version) .
