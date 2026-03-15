// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IWorkspaceRegistry.sol";

/**
 * @title IPRegistry
 * @notice Registry for intellectual property associated with workspace tasks
 * @dev Tracks IP registrations with license types, used by MilestoneEscrow to gate final payment
 */
contract IPRegistry {

    // ============ Enums ============

    enum LicenseType { MIT, Apache2, Proprietary, WorkForHire, Custom }

    // ============ Structs ============

    struct IPRegistration {
        uint256 id;
        bytes32 workspaceId;
        bytes32 taskId;
        address creator;
        LicenseType licenseType;
        string licenseCid;
        uint256 createdAt;
    }

    // ============ State Variables ============

    IWorkspaceRegistry public immutable workspaceRegistry;

    // Registration ID counter
    uint256 private _nextRegistrationId;

    // Registration ID => IPRegistration
    mapping(uint256 => IPRegistration) private _registrations;

    // Task ID => Registration ID (one IP registration per task)
    mapping(bytes32 => uint256) private _taskRegistrations;

    // Track whether a task has any IP registered (separate from ID mapping since ID 0 is valid)
    mapping(bytes32 => bool) private _taskHasIP;

    // Workspace ID => array of registration IDs
    mapping(bytes32 => uint256[]) private _workspaceRegistrations;

    // ============ Events ============

    event IPRegistered(
        uint256 indexed registrationId,
        bytes32 indexed workspaceId,
        bytes32 indexed taskId,
        address creator
    );

    // ============ Constructor ============

    constructor(address _workspaceRegistry) {
        workspaceRegistry = IWorkspaceRegistry(_workspaceRegistry);
    }

    // ============ External Functions ============

    /**
     * @notice Register IP for a task
     * @param workspaceId The workspace this IP belongs to
     * @param taskId The task this IP is associated with
     * @param licenseType The license type
     * @param licenseCid IPFS CID of the license document
     */
    function registerIP(
        bytes32 workspaceId,
        bytes32 taskId,
        uint8 licenseType,
        string calldata licenseCid
    ) external returns (uint256) {
        require(workspaceRegistry.isMember(workspaceId, msg.sender), "IPRegistry: not a member");
        require(licenseType <= uint8(LicenseType.Custom), "IPRegistry: invalid license type");
        require(bytes(licenseCid).length > 0, "IPRegistry: empty license CID");
        require(!_taskHasIP[taskId], "IPRegistry: task already has IP registered");

        uint256 registrationId = _nextRegistrationId++;

        _registrations[registrationId] = IPRegistration({
            id: registrationId,
            workspaceId: workspaceId,
            taskId: taskId,
            creator: msg.sender,
            licenseType: LicenseType(licenseType),
            licenseCid: licenseCid,
            createdAt: block.timestamp
        });

        _taskRegistrations[taskId] = registrationId;
        _taskHasIP[taskId] = true;
        _workspaceRegistrations[workspaceId].push(registrationId);

        emit IPRegistered(registrationId, workspaceId, taskId, msg.sender);
        return registrationId;
    }

    // ============ View Functions ============

    /**
     * @notice Get IP registration for a task
     * @param taskId The task ID
     * @return The IP registration
     */
    function getIPForTask(bytes32 taskId) external view returns (IPRegistration memory) {
        require(_taskHasIP[taskId], "IPRegistry: no IP for task");
        return _registrations[_taskRegistrations[taskId]];
    }

    /**
     * @notice Check if a task has IP registered
     * @param taskId The task ID
     * @return True if IP is registered for the task
     */
    function hasIPRegistered(bytes32 taskId) external view returns (bool) {
        return _taskHasIP[taskId];
    }

    /**
     * @notice Get all IP registration IDs for a workspace
     * @param workspaceId The workspace ID
     * @return Array of registration IDs
     */
    function getWorkspaceIP(bytes32 workspaceId) external view returns (uint256[] memory) {
        return _workspaceRegistrations[workspaceId];
    }

    /**
     * @notice Get an IP registration by ID
     * @param registrationId The registration ID
     * @return The IP registration
     */
    function getRegistration(uint256 registrationId) external view returns (IPRegistration memory) {
        require(_registrations[registrationId].createdAt != 0, "IPRegistry: not found");
        return _registrations[registrationId];
    }
}
