#!/bin/bash

docker buildx use --default
npm run build
docker build -t orbsnetworkstaging/vm-lambda:$(cat .version) .
