FROM node:16-alpine

# standard working directory
WORKDIR /opt/orbs

RUN apk add --no-cache python3 make g++

# install your app
COPY package*.json ./
RUN npm install

# install healthcheck based on status.json
COPY ./healthcheck.sh ./
COPY ./healthcheck.js ./
HEALTHCHECK CMD /opt/orbs/healthcheck.sh

COPY dist ./dist
CMD [ "npm", "start" ]