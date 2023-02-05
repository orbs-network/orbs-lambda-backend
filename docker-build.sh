#!/bin/bash

mkdir -p /home/circleci/.docker/buildx/instances
touch /home/circleci/.docker/buildx/instances/default
docker buildx create --use

npm run build
docker build -t orbsnetworkstaging/vm-lambda:$(cat .version) .
