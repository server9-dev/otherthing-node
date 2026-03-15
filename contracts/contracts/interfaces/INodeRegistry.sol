// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface INodeRegistry {
    function isNodeEligible(bytes32 nodeId) external view returns (bool);
    function getNode(bytes32 nodeId) external view returns (
        address owner,
        uint256 stakedAmount,
        uint256 pendingRewards,
        uint256 totalEarned,
        uint256 totalComputeSeconds,
        uint256 reputation,
        uint256 registeredAt,
        uint256 lastActiveAt,
        bool isActive,
        bool isSlashed
    );
}
