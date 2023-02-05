#!/bin/bash

mkdir -p /home/circleci/.docker/buildx/instances

npm run build
docker build -t orbsnetworkstaging/vm-lambda:$(cat .version) .
