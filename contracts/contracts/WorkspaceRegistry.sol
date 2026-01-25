// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title WorkspaceRegistry
 * @notice Decentralized workspace management - replaces centralized orchestrator
 * @dev Handles workspace creation, membership, and invite codes on-chain
 */
contract WorkspaceRegistry is Ownable, ReentrancyGuard {

    // ============ Enums ============

    enum MemberRole { Member, Admin, Owner }

    // ============ Structs ============

    struct Workspace {
        bytes32 id;
        string name;
        string description;
        address owner;
        uint256 createdAt;
        bool isPublic;
        bytes32 inviteCodeHash;  // keccak256 hash of invite code
        uint256 memberCount;
        bool exists;
    }

    struct Member {
        address memberAddress;
        uint256 joinedAt;
        MemberRole role;
        bool exists;
    }

    struct WorkspaceInfo {
        bytes32 id;
        string name;
        string description;
        address owner;
        uint256 createdAt;
        bool isPublic;
        uint256 memberCount;
    }

    // ============ State Variables ============

    // Workspace ID => Workspace
    mapping(bytes32 => Workspace) public workspaces;

    // Workspace ID => Member Address => Member
    mapping(bytes32 => mapping(address => Member)) public workspaceMembers;

    // Workspace ID => Array of member addresses
    mapping(bytes32 => address[]) private workspaceMemberList;

    // User Address => Array of workspace IDs they belong to
    mapping(address => bytes32[]) private userWorkspaces;

    // Track workspace count
    uint256 public workspaceCount;

    // All workspace IDs for enumeration
    bytes32[] private allWorkspaceIds;

    // ============ Events ============

    event WorkspaceCreated(
        bytes32 indexed workspaceId,
        string name,
        address indexed owner,
        bool isPublic
    );

    event MemberJoined(
        bytes32 indexed workspaceId,
        address indexed member,
        MemberRole role
    );

    event MemberLeft(
        bytes32 indexed workspaceId,
        address indexed member
    );

    event MemberRoleChanged(
        bytes32 indexed workspaceId,
        address indexed member,
        MemberRole newRole
    );

    event InviteCodeUpdated(bytes32 indexed workspaceId);

    event WorkspaceUpdated(
        bytes32 indexed workspaceId,
        string name,
        string description
    );

    // ============ Errors ============

    error WorkspaceNotFound();
    error WorkspaceAlreadyExists();
    error AlreadyMember();
    error NotMember();
    error NotAuthorized();
    error InvalidInviteCode();
    error WorkspaceIsPrivate();
    error CannotLeaveAsOwner();
    error InvalidName();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ External Functions ============

    /**
     * @notice Create a new workspace
     * @param name Workspace name
     * @param description Workspace description
     * @param isPublic Whether anyone can join without invite code
     * @param inviteCode Optional invite code for private workspaces (will be hashed)
     * @return workspaceId The ID of the created workspace
     */
    function createWorkspace(
        string memory name,
        string memory description,
        bool isPublic,
        string memory inviteCode
    ) external nonReentrant returns (bytes32 workspaceId) {
        if (bytes(name).length == 0 || bytes(name).length > 100) {
            revert InvalidName();
        }

        // Generate unique workspace ID
        workspaceId = keccak256(abi.encodePacked(
            msg.sender,
            name,
            block.timestamp,
            workspaceCount
        ));

        if (workspaces[workspaceId].exists) {
            revert WorkspaceAlreadyExists();
        }

        // Hash invite code if provided
        bytes32 inviteHash = bytes32(0);
        if (!isPublic && bytes(inviteCode).length > 0) {
            inviteHash = keccak256(abi.encodePacked(inviteCode));
        }

        // Create workspace
        workspaces[workspaceId] = Workspace({
            id: workspaceId,
            name: name,
            description: description,
            owner: msg.sender,
            createdAt: block.timestamp,
            isPublic: isPublic,
            inviteCodeHash: inviteHash,
            memberCount: 1,
            exists: true
        });

        // Add owner as first member
        workspaceMembers[workspaceId][msg.sender] = Member({
            memberAddress: msg.sender,
            joinedAt: block.timestamp,
            role: MemberRole.Owner,
            exists: true
        });

        workspaceMemberList[workspaceId].push(msg.sender);
        userWorkspaces[msg.sender].push(workspaceId);
        allWorkspaceIds.push(workspaceId);
        workspaceCount++;

        emit WorkspaceCreated(workspaceId, name, msg.sender, isPublic);
        emit MemberJoined(workspaceId, msg.sender, MemberRole.Owner);

        return workspaceId;
    }

    /**
     * @notice Join a public workspace
     * @param workspaceId The workspace to join
     */
    function joinPublicWorkspace(bytes32 workspaceId) external nonReentrant {
        Workspace storage workspace = workspaces[workspaceId];

        if (!workspace.exists) revert WorkspaceNotFound();
        if (!workspace.isPublic) revert WorkspaceIsPrivate();
        if (workspaceMembers[workspaceId][msg.sender].exists) revert AlreadyMember();

        _addMember(workspaceId, msg.sender, MemberRole.Member);
    }

    /**
     * @notice Join a workspace using an invite code
     * @param workspaceId The workspace to join
     * @param inviteCode The invite code
     */
    function joinWithInviteCode(
        bytes32 workspaceId,
        string memory inviteCode
    ) external nonReentrant {
        Workspace storage workspace = workspaces[workspaceId];

        if (!workspace.exists) revert WorkspaceNotFound();
        if (workspaceMembers[workspaceId][msg.sender].exists) revert AlreadyMember();

        // Verify invite code
        bytes32 providedHash = keccak256(abi.encodePacked(inviteCode));
        if (workspace.inviteCodeHash != providedHash) {
            revert InvalidInviteCode();
        }

        _addMember(workspaceId, msg.sender, MemberRole.Member);
    }

    /**
     * @notice Leave a workspace
     * @param workspaceId The workspace to leave
     */
    function leaveWorkspace(bytes32 workspaceId) external nonReentrant {
        Workspace storage workspace = workspaces[workspaceId];

        if (!workspace.exists) revert WorkspaceNotFound();
        if (!workspaceMembers[workspaceId][msg.sender].exists) revert NotMember();
        if (workspace.owner == msg.sender) revert CannotLeaveAsOwner();

        _removeMember(workspaceId, msg.sender);
    }

    /**
     * @notice Set or update the invite code for a workspace
     * @param workspaceId The workspace to update
     * @param newInviteCode The new invite code
     */
    function setInviteCode(
        bytes32 workspaceId,
        string memory newInviteCode
    ) external {
        Workspace storage workspace = workspaces[workspaceId];

        if (!workspace.exists) revert WorkspaceNotFound();
        if (!_isAdminOrOwner(workspaceId, msg.sender)) revert NotAuthorized();

        workspace.inviteCodeHash = keccak256(abi.encodePacked(newInviteCode));

        emit InviteCodeUpdated(workspaceId);
    }

    /**
     * @notice Update workspace details
     * @param workspaceId The workspace to update
     * @param name New name
     * @param description New description
     * @param isPublic New public status
     */
    function updateWorkspace(
        bytes32 workspaceId,
        string memory name,
        string memory description,
        bool isPublic
    ) external {
        Workspace storage workspace = workspaces[workspaceId];

        if (!workspace.exists) revert WorkspaceNotFound();
        if (workspace.owner != msg.sender) revert NotAuthorized();
        if (bytes(name).length == 0 || bytes(name).length > 100) revert InvalidName();

        workspace.name = name;
        workspace.description = description;
        workspace.isPublic = isPublic;

        emit WorkspaceUpdated(workspaceId, name, description);
    }

    /**
     * @notice Change a member's role
     * @param workspaceId The workspace
     * @param member The member to update
     * @param newRole The new role
     */
    function setMemberRole(
        bytes32 workspaceId,
        address member,
        MemberRole newRole
    ) external {
        Workspace storage workspace = workspaces[workspaceId];

        if (!workspace.exists) revert WorkspaceNotFound();
        if (workspace.owner != msg.sender) revert NotAuthorized();
        if (!workspaceMembers[workspaceId][member].exists) revert NotMember();
        if (newRole == MemberRole.Owner) revert NotAuthorized(); // Can't make someone else owner

        workspaceMembers[workspaceId][member].role = newRole;

        emit MemberRoleChanged(workspaceId, member, newRole);
    }

    /**
     * @notice Remove a member from workspace (admin/owner only)
     * @param workspaceId The workspace
     * @param member The member to remove
     */
    function removeMember(bytes32 workspaceId, address member) external {
        Workspace storage workspace = workspaces[workspaceId];

        if (!workspace.exists) revert WorkspaceNotFound();
        if (!_isAdminOrOwner(workspaceId, msg.sender)) revert NotAuthorized();
        if (!workspaceMembers[workspaceId][member].exists) revert NotMember();
        if (member == workspace.owner) revert NotAuthorized(); // Can't remove owner

        _removeMember(workspaceId, member);
    }

    /**
     * @notice Transfer workspace ownership
     * @param workspaceId The workspace
     * @param newOwner The new owner address
     */
    function transferOwnership(
        bytes32 workspaceId,
        address newOwner
    ) external {
        Workspace storage workspace = workspaces[workspaceId];

        if (!workspace.exists) revert WorkspaceNotFound();
        if (workspace.owner != msg.sender) revert NotAuthorized();

        // New owner must be a member
        if (!workspaceMembers[workspaceId][newOwner].exists) revert NotMember();

        // Update old owner role to Admin
        workspaceMembers[workspaceId][msg.sender].role = MemberRole.Admin;

        // Update new owner
        workspace.owner = newOwner;
        workspaceMembers[workspaceId][newOwner].role = MemberRole.Owner;

        emit MemberRoleChanged(workspaceId, msg.sender, MemberRole.Admin);
        emit MemberRoleChanged(workspaceId, newOwner, MemberRole.Owner);
    }

    // ============ View Functions ============

    /**
     * @notice Get workspace information
     * @param workspaceId The workspace ID
     * @return info Workspace information
     */
    function getWorkspace(bytes32 workspaceId) external view returns (WorkspaceInfo memory info) {
        Workspace storage workspace = workspaces[workspaceId];
        if (!workspace.exists) revert WorkspaceNotFound();

        return WorkspaceInfo({
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            owner: workspace.owner,
            createdAt: workspace.createdAt,
            isPublic: workspace.isPublic,
            memberCount: workspace.memberCount
        });
    }

    /**
     * @notice Get all members of a workspace
     * @param workspaceId The workspace ID
     * @return members Array of member addresses
     */
    function getWorkspaceMembers(bytes32 workspaceId) external view returns (address[] memory) {
        if (!workspaces[workspaceId].exists) revert WorkspaceNotFound();
        return workspaceMemberList[workspaceId];
    }

    /**
     * @notice Get member details
     * @param workspaceId The workspace ID
     * @param member The member address
     * @return Member struct
     */
    function getMember(
        bytes32 workspaceId,
        address member
    ) external view returns (Member memory) {
        if (!workspaces[workspaceId].exists) revert WorkspaceNotFound();
        return workspaceMembers[workspaceId][member];
    }

    /**
     * @notice Check if address is a member of workspace
     * @param workspaceId The workspace ID
     * @param user The address to check
     * @return bool True if member
     */
    function isMember(bytes32 workspaceId, address user) external view returns (bool) {
        return workspaceMembers[workspaceId][user].exists;
    }

    /**
     * @notice Get all workspaces a user belongs to
     * @param user The user address
     * @return workspaceIds Array of workspace IDs
     */
    function getUserWorkspaces(address user) external view returns (bytes32[] memory) {
        return userWorkspaces[user];
    }

    /**
     * @notice Get all public workspaces
     * @return infos Array of workspace info
     */
    function getPublicWorkspaces() external view returns (WorkspaceInfo[] memory) {
        uint256 publicCount = 0;

        // Count public workspaces
        for (uint256 i = 0; i < allWorkspaceIds.length; i++) {
            if (workspaces[allWorkspaceIds[i]].isPublic) {
                publicCount++;
            }
        }

        // Build array
        WorkspaceInfo[] memory infos = new WorkspaceInfo[](publicCount);
        uint256 idx = 0;

        for (uint256 i = 0; i < allWorkspaceIds.length; i++) {
            Workspace storage ws = workspaces[allWorkspaceIds[i]];
            if (ws.isPublic) {
                infos[idx] = WorkspaceInfo({
                    id: ws.id,
                    name: ws.name,
                    description: ws.description,
                    owner: ws.owner,
                    createdAt: ws.createdAt,
                    isPublic: ws.isPublic,
                    memberCount: ws.memberCount
                });
                idx++;
            }
        }

        return infos;
    }

    /**
     * @notice Verify an invite code without joining
     * @param workspaceId The workspace ID
     * @param inviteCode The invite code to verify
     * @return valid True if invite code is valid
     */
    function verifyInviteCode(
        bytes32 workspaceId,
        string memory inviteCode
    ) external view returns (bool valid) {
        Workspace storage workspace = workspaces[workspaceId];
        if (!workspace.exists) return false;

        bytes32 providedHash = keccak256(abi.encodePacked(inviteCode));
        return workspace.inviteCodeHash == providedHash;
    }

    // ============ Internal Functions ============

    function _addMember(
        bytes32 workspaceId,
        address member,
        MemberRole role
    ) internal {
        workspaceMembers[workspaceId][member] = Member({
            memberAddress: member,
            joinedAt: block.timestamp,
            role: role,
            exists: true
        });

        workspaceMemberList[workspaceId].push(member);
        userWorkspaces[member].push(workspaceId);
        workspaces[workspaceId].memberCount++;

        emit MemberJoined(workspaceId, member, role);
    }

    function _removeMember(bytes32 workspaceId, address member) internal {
        // Remove from member mapping
        delete workspaceMembers[workspaceId][member];

        // Remove from member list
        address[] storage members = workspaceMemberList[workspaceId];
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i] == member) {
                members[i] = members[members.length - 1];
                members.pop();
                break;
            }
        }

        // Remove from user's workspaces
        bytes32[] storage userWs = userWorkspaces[member];
        for (uint256 i = 0; i < userWs.length; i++) {
            if (userWs[i] == workspaceId) {
                userWs[i] = userWs[userWs.length - 1];
                userWs.pop();
                break;
            }
        }

        workspaces[workspaceId].memberCount--;

        emit MemberLeft(workspaceId, member);
    }

    function _isAdminOrOwner(bytes32 workspaceId, address user) internal view returns (bool) {
        Member storage member = workspaceMembers[workspaceId][user];
        return member.exists && (member.role == MemberRole.Admin || member.role == MemberRole.Owner);
    }
}
