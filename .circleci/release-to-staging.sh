#!/bin/bash

docker login -u $DOCKER_HUB_LOGIN -p $DOCKER_HUB_PASSWORD

export VERSION=$(cat .version)

docker push orbsnetworkstaging/orbs-lambda-backend:$VERSION

if [[ $CIRCLE_BRANCH == "master" ]] ;
then
  docker tag orbsnetworkstaging/orbs-lambda-backend:$VERSION orbsnetworkstaging/orbs-lambda-backend:experimental
  docker push orbsnetworkstaging/orbs-lambda-backend:experimental
fi
