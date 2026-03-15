// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IWorkspaceRegistry {
    function isMember(bytes32 workspaceId, address user) external view returns (bool);
    function getWorkspace(bytes32 workspaceId) external view returns (
        bytes32 id,
        string memory name,
        string memory description,
        address owner,
        uint256 createdAt,
        bool isPublic,
        uint256 memberCount
    );
    function getMember(bytes32 workspaceId, address member) external view returns (
        address memberAddress,
        uint256 joinedAt,
        uint8 role,
        bool exists
    );
}
