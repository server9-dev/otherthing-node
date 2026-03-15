// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgreementRegistry {
    function hasSignedRequired(bytes32 workspaceId, address user) external view returns (bool);
}
