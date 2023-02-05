#!/bin/bash

mkdir -p /home/circleci/.docker/buildx/instances
docker buildx create --name test --use
echo '{"Name":"test","Driver":"docker-container","Nodes":[{"Name":"test0","Endpoint":"unix:///var/run/docker.sock","Platforms":null,"Flags":null,"DriverOpts":{},"Files":null}],"Dynamic":false}' > /home/circleci/.docker/buildx/instances/default

npm run build
docker build -t orbsnetworkstaging/vm-lambda:$(cat .version) .
