FROM node:16-alpine

# standard working directory
WORKDIR /opt/orbs

RUN apk add --no-cache python3 make g++ git

# install your app
COPY package*.json ./
RUN npm install

COPY dist ./dist

COPY ./entrypoint.sh /opt/orbs/service

# install healthcheck based on status.json
COPY ./healthcheck.sh ./
COPY ./healthcheck.js ./

HEALTHCHECK CMD /opt/orbs/healthcheck.sh

# for debugging locally
CMD /opt/orbs/service