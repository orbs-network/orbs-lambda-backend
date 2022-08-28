#!/bin/bash

docker login -u $DOCKER_HUB_LOGIN -p $DOCKER_HUB_PASSWORD

export VERSION=$(cat .version)

docker push orbsnetworkstaging/keepers:$VERSION

if [[ $CIRCLE_BRANCH == "master" ]] ;
then
  docker tag orbsnetworkstaging/keepers:$VERSION orbsnetworkstaging/keepers:experimental
  docker push orbsnetworkstaging/keepers:experimental
fi
