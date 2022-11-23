import "dotenv/config";
import "@nomiclabs/hardhat-web3";
import "hardhat-tracer";
import "hardhat-gas-reporter";
import {hardhatDefaultConfig} from "@defi.org/web3-candies/dist/hardhat";
import _ from "lodash";

export default _.merge(hardhatDefaultConfig(), {});