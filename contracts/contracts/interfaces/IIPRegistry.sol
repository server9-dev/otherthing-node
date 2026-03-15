// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IIPRegistry {
    function hasIPRegistered(bytes32 taskId) external view returns (bool);
}
