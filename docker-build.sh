#!/bin/bash

ls /home/circleci/
ls /home/circleci/.docker
ls /home/circleci/.docker/buildx
ls /home/circleci/.docker/buildx/instances

npm run build
docker build -t orbsnetworkstaging/vm-lambda:$(cat .version) .
