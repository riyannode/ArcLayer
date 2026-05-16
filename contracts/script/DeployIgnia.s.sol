// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {Ignia} from "../src/Ignia.sol";

/**
 * @notice Deploy Ignia prediction market to Arc Testnet.
 *         Usage:
 *           export PRIVATE_KEY=0x...
 *           forge script script/DeployIgnia.s.sol:DeployIgnia \
 *             --rpc-url https://testnet-rpc.arc.io \
 *             --broadcast --verify
 */
contract DeployIgnia is Script {
    // Arc Testnet USDC
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address oracle = vm.envOr("ORACLE_ADDRESS", msg.sender);

        vm.startBroadcast(deployerKey);

        Ignia ignia = new Ignia(ARC_USDC, oracle);

        vm.stopBroadcast();

        // Log deployed address
        // solhint-disable-next-line no-console
        console.log("Ignia deployed at:", address(ignia));
        console.log("Oracle:", oracle);
        console.log("USDC:", ARC_USDC);
    }
}
